// Made by MrDuck
//! Profile DNS resolver — the REAL enforcement point for the Network
//! section's DNS settings.
//!
//! Why this module exists: every tab webview runs behind the local filtering
//! proxy (`--proxy-server=http://127.0.0.1:P`). A browser behind an HTTP
//! proxy does not resolve hostnames itself — it sends `CONNECT host:port`
//! and the PROXY resolves. Engine-level DoH flags therefore never see tab
//! traffic, and "custom DNS servers" previously did nothing at all.
//!
//! This resolver is used by the proxy whenever it would otherwise fall back
//! to the system resolver:
//!   * `System` mode  → passthrough (system getaddrinfo), as before;
//!   * `Custom` mode  → hand-rolled UDP DNS queries (port 53) to the
//!     configured servers, first working server wins;
//!   * `Doh` mode     → HTTPS JSON API (RFC 8484-style `?name=&type=` with
//!     `application/dns-json`, as served by Cloudflare/Google/Quad9/AdGuard)
//!     via the shared ureq agent (rustls TLS);
//!   * `Dot` mode     → NOT supported by the std-only stack (raw TLS stream);
//!     falls back to system resolution with an honest status note in the UI.
//!
//! The snapshot is swappable at runtime (`apply` on profile switch and
//! `save_network_settings`), reads are lock-free Arc clones, results are
//! cached in-memory (positive/negative TTL) when `cache_enabled` is set.

use apb_network::{DnsConfig, DnsMode};
use std::collections::HashMap;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, Instant};

const POSITIVE_TTL: Duration = Duration::from_secs(60);
const NEGATIVE_TTL: Duration = Duration::from_secs(8);
const CACHE_CAP: usize = 1024;
const UDP_TIMEOUT: Duration = Duration::from_secs(2);
const DOH_TIMEOUT: Duration = Duration::from_secs(4);

// ---------------------------------------------------------------------------
// Snapshot (swapped by liveprivacy::sync_from_state)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct DnsSnap {
    pub mode: DnsMode,
    /// Parsed custom server IPs (Custom mode).
    pub servers: Vec<IpAddr>,
    /// DoH endpoint URL (Doh mode).
    pub doh_url: String,
    pub cache_enabled: bool,
}

impl Default for DnsSnap {
    fn default() -> Self {
        Self { mode: DnsMode::System, servers: Vec::new(), doh_url: String::new(), cache_enabled: true }
    }
}

impl DnsSnap {
    fn from_config(cfg: &DnsConfig) -> Self {
        Self {
            mode: cfg.mode,
            servers: cfg.custom_servers.iter().filter_map(|s| s.parse().ok()).collect(),
            doh_url: cfg.doh_url.clone(),
            cache_enabled: cfg.cache_enabled,
        }
    }
}

static DNS: OnceLock<RwLock<Arc<DnsSnap>>> = OnceLock::new();

fn dns_cell() -> &'static RwLock<Arc<DnsSnap>> {
    DNS.get_or_init(|| RwLock::new(Arc::new(DnsSnap::default())))
}

/// Swap the active DNS configuration (call after any settings mutation).
pub fn apply(cfg: &DnsConfig) {
    let snap = Arc::new(DnsSnap::from_config(cfg));
    *dns_cell().write().unwrap_or_else(|e| e.into_inner()) = snap;
}

/// Whether the resolver intercepts lookups at all (anything but System).
pub fn active() -> bool {
    dns_cell().read().unwrap_or_else(|e| e.into_inner()).mode != DnsMode::System
}

// ---------------------------------------------------------------------------
// Public resolve API (called from the proxy data plane)
// ---------------------------------------------------------------------------

/// Resolve a bare hostname through the configured DNS mode. Returns `None`
/// when the caller should fall back to the system resolver (System/DoT mode,
/// IP-literal input, or resolution failure — fail-open keeps the web usable;
/// the negative result is cached briefly either way).
pub fn resolve(host: &str) -> Option<IpAddr> {
    let host = host.trim().trim_matches(['[', ']']).to_ascii_lowercase();
    if host.is_empty() || host.parse::<IpAddr>().is_ok() {
        return None; // IP literals need no resolution
    }
    if !active() {
        return None;
    }
    let snap = dns_cell().read().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(hit) = cache_get(&host, snap.cache_enabled) {
        return hit;
    }
    let started = Instant::now();
    let result = match snap.mode {
        DnsMode::Custom => resolve_custom(&snap.servers, &host),
        DnsMode::Doh => resolve_doh(&snap.doh_url, &host),
        _ => None, // DoT unsupported → honest system fallback (see module doc)
    };
    crate::features::debug::append_backend_log(&format!(
        "resolver: {} -> {:?} ({}, {}ms)",
        host,
        result,
        match snap.mode {
            DnsMode::Custom => "custom".to_string(),
            DnsMode::Doh => format!("doh {}", snap.doh_url),
            other => format!("{other:?}"),
        },
        started.elapsed().as_millis()
    ));
    cache_put(&host, result, snap.cache_enabled);
    result
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

struct Entry {
    expires: Instant,
    ip: Option<IpAddr>,
}

static CACHE: OnceLock<std::sync::Mutex<HashMap<String, Entry>>> = OnceLock::new();

fn cache() -> &'static std::sync::Mutex<HashMap<String, Entry>> {
    CACHE.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn cache_get(host: &str, enabled: bool) -> Option<Option<IpAddr>> {
    if !enabled {
        return None;
    }
    let map = cache().lock().unwrap_or_else(|e| e.into_inner());
    match map.get(host) {
        Some(e) if e.expires > Instant::now() => Some(e.ip),
        _ => None,
    }
}

fn cache_put(host: &str, ip: Option<IpAddr>, enabled: bool) {
    if !enabled {
        return;
    }
    let mut map = cache().lock().unwrap_or_else(|e| e.into_inner());
    if map.len() >= CACHE_CAP {
        map.clear(); // crude but bounded; entries repopulate within seconds
    }
    map.insert(
        host.to_string(),
        Entry { expires: Instant::now() + if ip.is_some() { POSITIVE_TTL } else { NEGATIVE_TTL }, ip },
    );
}

// ---------------------------------------------------------------------------
// Custom mode: hand-rolled UDP DNS (A/AAAA)
// ---------------------------------------------------------------------------

fn resolve_custom(servers: &[IpAddr], host: &str) -> Option<IpAddr> {
    if servers.is_empty() {
        return None;
    }
    let query_v4 = build_query(host, 1);
    for server in servers {
        // Prefer A; retry AAAA only if the server answered but had no A.
        if let Some(ip) = udp_query(*server, &query_v4, 1) {
            return Some(ip);
        }
        if let Some(ip) = udp_query(*server, &build_query(host, 28), 28) {
            return Some(ip);
        }
    }
    None
}

/// Send one encoded DNS query over UDP and decode the first address of
/// `want_type` from the answer section.
fn udp_query(server: IpAddr, query: &[u8], want_type: u16) -> Option<IpAddr> {
    let sock = UdpSocket::bind(if server.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" }).ok()?;
    let _ = sock.set_read_timeout(Some(UDP_TIMEOUT));
    let _ = sock.set_write_timeout(Some(UDP_TIMEOUT));
    sock.connect(SocketAddr::new(server, 53)).ok()?;
    sock.send(query).ok()?;
    let mut buf = vec![0u8; 4096];
    let n = sock.recv(&mut buf).ok()?;
    parse_answer_id(&buf[..n], query).and_then(|_| parse_first_addr(&buf[..n], want_type))
}

static QUERY_ID: AtomicU32 = AtomicU32::new(0x9a7b);

/// Build a recursive A/AAAA query packet for `name`.
fn build_query(name: &str, qtype: u16) -> Vec<u8> {
    let id = (QUERY_ID.fetch_add(0x9E37, Ordering::Relaxed) ^ (name.len() as u32)) as u16;
    let mut out = Vec::with_capacity(17 + name.len());
    out.extend_from_slice(&id.to_be_bytes()); // ID
    out.extend_from_slice(&[0x01, 0x00]); // RD=1
    out.extend_from_slice(&[0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]); // counts
    for label in name.trim_end_matches('.').split('.') {
        let bytes = label.as_bytes();
        if bytes.is_empty() || bytes.len() > 63 {
            return Vec::new(); // invalid name → empty packet fails cleanly
        }
        out.push(bytes.len() as u8);
        out.extend_from_slice(bytes);
    }
    out.push(0); // root label
    out.extend_from_slice(&qtype.to_be_bytes());
    out.extend_from_slice(&1u16.to_be_bytes()); // IN
    out
}

/// The response must carry the same transaction ID as the query.
fn parse_answer_id(resp: &[u8], query: &[u8]) -> Option<()> {
    if resp.len() < 12 || query.len() < 2 || resp[0] != query[0] || resp[1] != query[1] {
        return None;
    }
    Some(())
}

/// Skip a (possibly compressed) domain name starting at `pos`; returns the
/// offset just past it within THIS message (pointers are jumped, not chased —
/// we only ever skip names, never read them).
fn skip_name(buf: &[u8], pos: usize) -> Option<usize> {
    let mut p = pos;
    loop {
        let len = *buf.get(p)?;
        if len & 0xC0 == 0xC0 {
            return if p + 2 <= buf.len() { Some(p + 2) } else { None };
        }
        p += 1;
        if len == 0 {
            return Some(p);
        }
        p += len as usize;
        if p > buf.len() {
            return None;
        }
    }
}

fn parse_first_addr(resp: &[u8], want_type: u16) -> Option<IpAddr> {
    if resp.len() < 12 || resp[3] & 0x0F != 0 {
        return None; // truncated header or non-zero RCODE
    }
    let qd = u16::from_be_bytes([resp[4], resp[5]]) as usize;
    let an = u16::from_be_bytes([resp[6], resp[7]]) as usize;
    let mut pos = 12;
    for _ in 0..qd {
        pos = skip_name(resp, pos)?;
        pos += 4; // QTYPE + QCLASS
    }
    for _ in 0..an {
        pos = skip_name(resp, pos)?;
        if pos + 10 > resp.len() {
            return None;
        }
        let rtype = u16::from_be_bytes([resp[pos], resp[pos + 1]]);
        let rdlen = u16::from_be_bytes([resp[pos + 8], resp[pos + 9]]) as usize;
        pos += 10;
        if rtype == want_type && pos + rdlen <= resp.len() {
            match want_type {
                1 if rdlen == 4 => {
                    let o = &resp[pos..pos + 4];
                    return Some(IpAddr::V4(Ipv4Addr::new(o[0], o[1], o[2], o[3])));
                }
                28 if rdlen == 16 => {
                    let mut o = [0u8; 16];
                    o.copy_from_slice(&resp[pos..pos + 16]);
                    return Some(IpAddr::V6(Ipv6Addr::from(o)));
                }
                _ => {}
            }
        }
        pos += rdlen;
    }
    None
}

// ---------------------------------------------------------------------------
// DoH mode: RFC 8484 wireformat over HTTPS (application/dns-message)
// ---------------------------------------------------------------------------

static DOH_AGENT: OnceLock<ureq::Agent> = OnceLock::new();

fn doh_agent() -> &'static ureq::Agent {
    DOH_AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .timeout(DOH_TIMEOUT)
            .user_agent("APB-DNS/1")
            .build()
    })
}

fn resolve_doh(url: &str, host: &str) -> Option<IpAddr> {
    if !url.starts_with("https://") {
        return None;
    }
    // RFC 8484 binary wireformat via POST — spoken by EVERY major provider
    // (AdGuard included). The JSON API (?name=&type=) exists only on some
    // and returns HTML/errors elsewhere, which looked like "everything is
    // blocked" in the first implementation.
    let query = build_query(host, 1);
    if query.len() < 12 {
        return None;
    }
    let mut body = Vec::with_capacity(512);
    doh_agent()
        .post(url)
        .set("Content-Type", "application/dns-message")
        .set("Accept", "application/dns-message")
        .send_bytes(&query)
        .ok()?
        .into_reader()
        .read_to_end(&mut body)
        .ok()?;
    // Prefer A; retry AAAA against the same server when no A record came.
    parse_answer_id(&body, &query).and_then(|_| parse_first_addr(&body, 1))
        .or_else(|| {
            let q6 = build_query(host, 28);
            let mut b6 = Vec::new();
            doh_agent()
                .post(url)
                .set("Content-Type", "application/dns-message")
                .set("Accept", "application/dns-message")
                .send_bytes(&q6)
                .ok()?
                .into_reader()
                .read_to_end(&mut b6)
                .ok()?;
            parse_answer_id(&b6, &q6).and_then(|_| parse_first_addr(&b6, 28))
        })
}

// ---------------------------------------------------------------------------
// Honest status line for the privacy overview (#enforceHint)
// ---------------------------------------------------------------------------

pub fn describe(cfg: &DnsConfig) -> String {
    match cfg.mode {
        DnsMode::System => "DNS системный (резолвит локальный прокси)".to_string(),
        DnsMode::Custom => {
            let list: Vec<String> =
                cfg.custom_servers.iter().take(3).map(|s| s.to_string()).collect();
            format!(
                "Custom DNS активен: {} — прокси резолвит через них{}",
                list.join(", "),
                if cfg.custom_servers.len() > 3 { "…" } else { "" }
            )
        }
        DnsMode::Doh if cfg.doh_url.starts_with("https://") =>
            format!("DoH secure · {} — прокси резолвит через DoH", cfg.doh_url),
        DnsMode::Doh => "DoH выбран, но URL не задан — работает системный DNS".to_string(),
        DnsMode::Dot => format!(
            "DoT ({}) локальным резолвером не поддержан — используется системный DNS",
            cfg.dot_server
        ),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_response(qid: u16, rcode: u8, answers: &[(u16, Vec<u8>)]) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(&qid.to_be_bytes());
        b.extend_from_slice(&[0x81, 0x80]);
        b.extend_from_slice(&[0, 1, 0, answers.len() as u8, 0, 0, 0, 0]);
        // question: example.com A IN
        b.extend_from_slice(&[7, b'e', b'x', b'a', b'm', b'p', b'l', b'e']);
        b.extend_from_slice(&[3, b'c', b'o', b'm', 0, 0, 1, 0, 1]);
        for (rtype, rdata) in answers {
            b.extend_from_slice(&[0xC0, 0x0C]); // pointer to question name
            b.extend_from_slice(&rtype.to_be_bytes());
            b.extend_from_slice(&1u16.to_be_bytes());
            b.extend_from_slice(&60u32.to_be_bytes());
            b.extend_from_slice(&(rdata.len() as u16).to_be_bytes());
            b.extend_from_slice(rdata);
        }
        assert_eq!(rcode, 0);
        b
    }

    #[test]
    fn query_builds_and_parses_back() {
        let q = build_query("a.example.org", 1);
        assert!(q.len() > 17);
        assert_eq!((q[2] & 0x80) != 0, false); // QR=0 (query)
        assert_eq!(q[2] & 0x01, 1); // RD set
        // Walk labels back out of the question section.
        let mut p = 12;
        let mut labels = Vec::new();
        loop {
            let l = q[p];
            p += 1;
            if l == 0 {
                break;
            }
            labels.push(String::from_utf8(q[p..p + l as usize].to_vec()).unwrap());
            p += l as usize;
        }
        assert_eq!(labels.join("."), "a.example.org");
        assert_eq!(u16::from_be_bytes([q[p], q[p + 1]]), 1); // QTYPE=A
    }

    #[test]
    fn parses_a_and_aaaa_answers_with_compression() {
        let q = build_query("example.com", 1);
        let resp = sample_response(q[0] as u16 * 256 + q[1] as u16, 0, &[(1, vec![93, 184, 215, 14])]);
        assert_eq!(parse_first_addr(&resp, 1), Some("93.184.215.14".parse().unwrap()));

        let q6 = build_query("example.com", 28);
        let mut ip6 = [0u8; 16];
        ip6[15] = 0x11;
        let resp6 = sample_response(
            q6[0] as u16 * 256 + q6[1] as u16,
            0,
            &[(28, ip6.to_vec()), (1, vec![1, 2, 3, 4])],
        );
        assert_eq!(parse_first_addr(&resp6, 28), Some(IpAddr::V6(Ipv6Addr::from(ip6))));
        assert_eq!(parse_first_addr(&resp6, 1), Some("1.2.3.4".parse().unwrap()));
    }

    #[test]
    fn rejects_mismatched_id_and_error_rcode() {
        let q = build_query("example.com", 1);
        let good = sample_response(u16::from_be_bytes([q[0], q[1]]), 0, &[]);
        let mut bad = good.clone();
        bad[0] ^= 0xFF;
        assert_eq!(parse_answer_id(&bad, &q), None);

        let mut servfail = sample_response(u16::from_be_bytes([q[0], q[1]]), 0, &[]);
        servfail[3] |= 0x02; // RCODE=SERVFAIL
        assert_eq!(parse_first_addr(&servfail, 1), None);
    }

    #[test]
    fn cache_respects_enable_flag_and_ttl() {
        let key = "cache-test.invalid";
        cache_put(key, Some("127.0.0.1".parse().unwrap()), false);
        assert_eq!(cache_get(key, false), None); // disabled → no read

        cache_put(key, Some("127.0.0.1".parse().unwrap()), true);
        assert_eq!(cache_get(key, true), Some(Some("127.0.0.1".parse().unwrap())));

        cache_put("neg.invalid", None, true);
        assert_eq!(cache_get("neg.invalid", true), Some(None));
    }

    #[test]
    fn describe_reports_honest_states() {
        let mut c = DnsConfig::default();
        assert!(describe(&c).contains("системн"));
        c.mode = DnsMode::Custom;
        c.custom_servers = vec!["1.1.1.1".into()];
        assert!(describe(&c).starts_with("Custom DNS активен"));
        c.mode = DnsMode::Dot;
        c.dot_server = "dns.example:853".into();
        assert!(describe(&c).contains("не поддержан"));
    }

    // ---- live-network smokes: `cargo test resolver -- --ignored` ----

    #[test]
    #[ignore = "requires network"]
    fn smoke_custom_udp_vs_cloudflare() {
        let ip = resolve_custom(&["1.1.1.1".parse().unwrap()], "example.com");
        assert!(ip.is_some(), "UDP DNS to 1.1.1.1 failed");
    }

    #[test]
    #[ignore = "requires network"]
    fn smoke_doh_wireformat_vs_cloudflare() {
        let ip = resolve_doh("https://cloudflare-dns.com/dns-query", "example.com");
        assert!(ip.is_some(), "DoH wireformat query failed");
    }

    #[test]
    #[ignore = "requires network"]
    fn smoke_doh_wireformat_vs_adguard() {
        // The provider the user actually wants — RFC 8484 wireformat only.
        let ip = resolve_doh("https://dns.adguard-dns.com/dns-query", "yandex.ru");
        assert!(ip.is_some(), "AdGuard DoH failed to resolve a clean domain");
    }
}

// Made by MrDuck
