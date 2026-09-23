// Made by MrDuck
//! Local filtering HTTP proxy — the network-layer enforcement point for the
//! privacy engine (roadmap item #2: "privacy applied to real traffic").
//!
//! WebView2 routes all tab traffic through `--proxy-server=http://127.0.0.1:P`
//! (see `liveprivacy::init_browser_args`). For every request the proxy:
//!   1. checks site overrides (§10A.9) — allowed hosts pass untouched;
//!   2. asks the live `PrivacySnap` whether the target host is a tracker /
//!      ad / malicious domain and serves a local block page otherwise;
//!   3. enforces HTTPS-only by 307-upgrading plain http:// requests;
//!   4. strips third-party Cookie headers and applies the Referer policy on
//!      plain HTTP (for HTTPS the in-page shim from `cmd::pages` covers it);
//!   5. optionally routes the connection through the external chain
//!      configured in the Network section (HTTP-CONNECT / SOCKS5 hops);
//!   6. resolves domain names itself in Custom/DNS-over-HTTPS modes
//!      (`resolver.rs`) — behind an HTTP proxy the engine never resolves,
//!      so profile DNS is meaningful ONLY at this layer.
//!
//! Blocking is purely host-based (CONNECT authority / Host header) — no TLS
//! interception, no certificates, nothing leaves the machine. HTTPS tunnels
//! are allowed or denied whole.
//!
//! Threading: blocking std::TcpListener + one thread per connection. A
//! desktop browser keeps dozens of connections alive at worst — cheap.

use crate::network::liveprivacy::{route_snapshot, LiveFilter, PrivacySnap, UpHop};
use crate::util::encode_base64;
use apb_privacy::TrackerCategory;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, TcpListener, TcpStream};
use std::sync::Arc;
use std::time::Duration;

const PORT_RANGE: std::ops::RangeInclusive<u16> = 47790..=47799;
const HEAD_CAP: usize = 64 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(30);

/// Bind the loopback listener and start the accept thread.
/// Returns the chosen port (None = every candidate port was busy).
pub fn spawn(filter: Arc<LiveFilter>) -> Option<u16> {
    let listener = PORT_RANGE
        .clone()
        .filter_map(|p| TcpListener::bind(("127.0.0.1", p)).ok())
        .next()?;
    let port = listener.local_addr().ok()?.port();
    std::thread::Builder::new()
        .name("apb-proxy-accept".into())
        .spawn(move || accept_loop(listener, filter))
        .ok()?;
    Some(port)
}

fn accept_loop(listener: TcpListener, filter: Arc<LiveFilter>) {
    for conn in listener.incoming() {
        if let Ok(stream) = conn {
            let f = filter.clone();
            let _ = std::thread::Builder::new()
                .name("apb-proxy-conn".into())
                .spawn(move || handle_conn(stream, f));
        }
    }
}

fn handle_conn(mut client: TcpStream, filter: Arc<LiveFilter>) {
    let _ = client.set_nodelay(true);
    let _ = client.set_read_timeout(Some(IO_TIMEOUT));
    let _ = client.set_write_timeout(Some(IO_TIMEOUT));

    let head = match read_head(&mut client) {
        Some(h) => h,
        None => return,
    };
    let head_str = String::from_utf8_lossy(&head).into_owned();
    let first = head_str.lines().next().unwrap_or("").trim().to_string();
    let mut parts = first.split_whitespace();
    let method = parts.next().unwrap_or("").to_ascii_uppercase();

    if method == "CONNECT" {
        // CONNECT host:port HTTP/1.1
        let authority = parts.next().unwrap_or("");
        let host = authority
            .rsplit_once(':')
            .map(|(h, _)| h.to_string())
            .unwrap_or_else(|| authority.to_string());
        if let Some(cat) = classify_block(&filter, &host) {
            let _ = client.write_all(block_response(&host, &cat).as_bytes());
            return;
        }
        let upstream = match open_connection(authority.trim(), &host) {
            Ok(u) => u,
            Err(e) => {
                let body = format!("APB proxy: не удалось соединиться ({e})");
                let _ = client.write_all(
                    format!(
                        "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .as_bytes(),
                );
                return;
            }
        };
        if client.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n").is_err() {
            return;
        }
        tunnel(client, upstream);
    } else {
        // Absolute-form request: GET http://host/path HTTP/1.1
        let url_part = parts.next().unwrap_or("");
        let host = extract_http_host(&head_str, url_part);
        let host_port = http_target(&host);
        if let Some(cat) = classify_block(&filter, &host) {
            let _ = client.write_all(block_response(&host, &cat).as_bytes());
            return;
        }
        let snap = filter.get();
        // HTTPS-only (§10A.14): upgrade plain http:// to https:// with 307.
        if snap.policy.https_only && upgradable(&host) {
            let target = url_part.replacen("http://", "https://", 1);
            let target = strip_default_port(&target);
            let resp = format!(
                "HTTP/1.1 307 Temporary Redirect\r\nLocation: {target}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            let _ = client.write_all(resp.as_bytes());
            return;
        }
        // Cookie / Referer enforcement for plain HTTP (HTTPS is covered by
        // the injected in-page shim — see cmd::pages).
        let rewritten = rewrite_head(&head, &host, &snap);

        let route_host = bare_host(&host).to_lowercase();
        match route_snapshot().resolve(&route_host) {
            None => {
                let Some(mut upstream) =
                    host_port.as_ref().and_then(|t| connect_target(t).ok())
                else {
                    return;
                };
                let _ = upstream.set_nodelay(true);
                if upstream.write_all(&rewritten).is_err() {
                    return;
                }
                tunnel(client, upstream);
            }
            Some(hops) => {
                // Through the external chain we speak origin-form directly to
                // the origin server (the chain is just a transport).
                let target = match host_port.as_deref() {
                    Some(t) => t.to_string(),
                    None => return,
                };
                let Ok(mut upstream) = chain_connect(hops, &target) else { return };
                let _ = upstream.set_nodelay(true);
                let origin_form = to_origin_form(&rewritten);
                if upstream.write_all(&origin_form).is_err() {
                    return;
                }
                tunnel(client, upstream);
            }
        }
    }
}

/// Blind bidirectional copy until either side closes.
fn tunnel(a: TcpStream, b: TcpStream) {
    let mut a = a;
    let mut b = b;
    let Ok(mut a2) = a.try_clone() else { return };
    let Ok(mut b2) = b.try_clone() else { return };
    let up = std::thread::spawn(move || {
        let _ = std::io::copy(&mut a2, &mut b2);
        let _ = b2.shutdown(std::net::Shutdown::Write);
    });
    let _ = std::io::copy(&mut b, &mut a);
    let _ = a.shutdown(std::net::Shutdown::Both);
    let _ = up.join();
}

// ---------------------------------------------------------------------------
// Connection establishment: direct or through the configured chain
// ---------------------------------------------------------------------------

/// Open a connection to `authority` ("host:port") — direct for LAN/IP and
/// unconfigured hosts, otherwise hop-by-hop through the external chain.
fn open_connection(authority: &str, bare_target_host: &str) -> Result<TcpStream, String> {
    let route = route_snapshot();
    if !worth_checking(bare_target_host) {
        return connect_target(authority).map_err(|e| e.to_string());
    }
    match route.resolve(&bare_target_host.to_lowercase()) {
        None => connect_target(authority).map_err(|e| e.to_string()),
        Some(hops) => chain_connect(hops, authority),
    }
}

/// Connect to `authority` ("host:port") honoring the profile resolver
/// (`resolver.rs`): domain names in Custom/Doh modes are resolved by APB's
/// own DNS stack instead of the system one. IP literals, System/DoT mode and
/// resolution failures fall back to the system stack inside `TcpStream::connect`.
fn connect_target(authority: &str) -> std::io::Result<TcpStream> {
    let (h, p) = split_host_port(authority);
    if h.parse::<IpAddr>().is_ok() || !crate::network::resolver::active() {
        return TcpStream::connect(authority);
    }
    match crate::network::resolver::resolve(&h) {
        Some(ip) => TcpStream::connect((ip, p)),
        None => TcpStream::connect((h.as_str(), p)),
    }
}

/// Establish a raw tunnel to `target_authority` walking `hops` in order:
/// each hop is reached through the tunnel built so far (multi-hop chaining).
fn chain_connect(hops: &[UpHop], target_authority: &str) -> Result<TcpStream, String> {
    if hops.is_empty() {
        return Err("пустая цепочка".into());
    }
    let mut sock = TcpStream::connect(hops[0].addr()).map_err(|e| format!("hop 1: {e}"))?;
    let _ = sock.set_nodelay(true);
    let _ = sock.set_read_timeout(Some(IO_TIMEOUT));
    let _ = sock.set_write_timeout(Some(IO_TIMEOUT));
    for (i, hop) in hops.iter().enumerate() {
        let next = if i + 1 < hops.len() { hops[i + 1].addr() } else { target_authority.to_string() };
        match hop {
            UpHop::Http { auth, .. } => http_hop_connect(&mut sock, &next, auth.as_ref())?,
            UpHop::Socks5 { auth, .. } => socks5_hop_connect(&mut sock, &next, auth.as_ref())?,
        }
    }
    Ok(sock)
}

fn http_hop_connect(
    sock: &mut TcpStream,
    authority: &str,
    auth: Option<&(String, String)>,
) -> Result<(), String> {
    let mut req = format!(
        "CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\nProxy-Connection: keep-alive\r\n"
    );
    if let Some((u, p)) = auth {
        req.push_str(&format!(
            "Proxy-Authorization: Basic {}\r\n",
            encode_base64(format!("{u}:{p}").as_bytes())
        ));
    }
    req.push_str("\r\n");
    sock.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    // Read the response head; success is any "HTTP/x NNN 200".
    let head = read_head(sock).ok_or_else(|| "нет ответа от HTTP-прокси".to_string())?;
    let text = String::from_utf8_lossy(&head);
    let status_ok = text
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .map(|c| c == "200")
        .unwrap_or(false);
    if status_ok {
        Ok(())
    } else {
        Err(format!("HTTP-прокси отклонил CONNECT: {}", text.lines().next().unwrap_or("")))
    }
}

fn socks5_hop_connect(
    sock: &mut TcpStream,
    authority: &str,
    auth: Option<&(String, String)>,
) -> Result<(), String> {
    let want_auth = auth.is_some();
    let greeting: &[u8] =
        if want_auth { &[0x05, 0x02, 0x00, 0x02] } else { &[0x05, 0x01, 0x00] };
    sock.write_all(greeting).map_err(|e| e.to_string())?;
    let mut resp = [0u8; 2];
    sock.read_exact(&mut resp).map_err(|e| e.to_string())?;
    if resp[0] != 0x05 {
        return Err("это не SOCKS5-прокси".into());
    }
    match resp[1] {
        0x00 => {}
        0x02 => {
            let Some((user, pass)) = auth else {
                return Err("SOCKS5 требует авторизацию".into());
            };
            let mut msg = vec![0x01, user.len() as u8];
            msg.extend_from_slice(user.as_bytes());
            msg.push(pass.len() as u8);
            msg.extend_from_slice(pass.as_bytes());
            sock.write_all(&msg).map_err(|e| e.to_string())?;
            let mut st = [0u8; 2];
            sock.read_exact(&mut st).map_err(|e| e.to_string())?;
            if st[1] != 0x00 {
                return Err("SOCKS5: неверные учётные данные".into());
            }
        }
        other => return Err(format!("SOCKS5: неподдерживаемый метод 0x{other:02x}")),
    }
    // Request: CONNECT by hostname (ATYP=domain — no local DNS leak).
    let (host, port) = split_host_port(authority);
    let mut req = vec![0x05, 0x01, 0x00, 0x03, host.len() as u8];
    req.extend_from_slice(host.as_bytes());
    req.extend_from_slice(&port.to_be_bytes());
    sock.write_all(&req).map_err(|e| e.to_string())?;
    let mut head = [0u8; 4];
    sock.read_exact(&mut head).map_err(|e| e.to_string())?;
    if head[1] != 0x00 {
        return Err(format!("SOCKS5: ошибка соединения (код {})", head[1]));
    }
    // Drain BND.ADDR/BND.PORT depending on the reply address type.
    let skip = match head[3] {
        0x01 => 4 + 2,
        0x03 => {
            let mut l = [0u8; 1];
            sock.read_exact(&mut l).map_err(|e| e.to_string())?;
            l[0] as usize + 2
        }
        0x04 => 16 + 2,
        _ => 0,
    };
    let mut rest = vec![0u8; skip];
    sock.read_exact(&mut rest).map_err(|e| e.to_string())?;
    Ok(())
}

fn split_host_port(authority: &str) -> (String, u16) {
    match authority.rsplit_once(':') {
        Some((h, p)) if p.chars().all(|c| c.is_ascii_digit()) && !p.is_empty() => {
            (h.trim_matches(['[', ']']).to_string(), p.parse().unwrap_or(80))
        }
        _ => (authority.trim_matches(['[', ']']).to_string(), 80),
    }
}

// ---------------------------------------------------------------------------
// Head reading helpers
// ---------------------------------------------------------------------------

/// Read bytes up to and including the CRLFCRLF terminator (capped).
fn read_head(stream: &mut TcpStream) -> Option<Vec<u8>> {
    let mut buf = Vec::with_capacity(8 * 1024);
    let mut chunk = [0u8; 4096];
    loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if find_head_end(&buf).is_some() {
            return Some(buf);
        }
        if buf.len() > HEAD_CAP {
            return None;
        }
    }
}

fn find_head_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n").map(|i| i + 4)
}

fn extract_http_host(head: &str, url_part: &str) -> String {
    // Prefer the authority from the absolute URL.
    if let Some(rest) = url_part.strip_prefix("http://") {
        let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
        if !authority.is_empty() {
            return authority.split('@').next_back().unwrap_or(authority).to_string();
        }
    }
    // Fallback: Host header.
    for line in head.lines().skip(1) {
        if let Some(v) = line.strip_prefix("Host:") {
            return v.trim().split('@').next_back().unwrap_or_else(|| v.trim()).to_string();
        }
    }
    String::new()
}

fn http_target(host: &str) -> Option<String> {
    let host = host.trim();
    if host.is_empty() {
        return None;
    }
    match host.rsplit_once(':') {
        Some((h, p)) if p.chars().all(|c| c.is_ascii_digit()) && !p.is_empty() => {
            Some(format!("{h}:{p}"))
        }
        _ => Some(format!("{host}:80")),
    }
}

// ---------------------------------------------------------------------------
// Enforcement decisions
// ---------------------------------------------------------------------------

/// Full decision pipeline: overrides first (§10A.9), then policy-gated rule
/// matching (which also records block statistics). LAN/IP/localhost always
/// pass.
fn classify_block(filter: &Arc<LiveFilter>, host: &str) -> Option<TrackerCategory> {
    let host = normalize_host(host);
    if !worth_checking(&host) {
        return None;
    }
    let snap = filter.get();
    let p = &snap.policy;
    if !(p.block_trackers || p.block_ads || p.block_malicious_domains) {
        return None;
    }
    if snap.override_allows(&host) {
        return None;
    }
    snap.blocker.inspect(&host, p)
}

/// Never touch loopback/LAN/IP-literal targets — trackers don't live there,
/// and false positives on the local network would be infuriating.
fn worth_checking(host: &str) -> bool {
    if host.is_empty() || host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return false;
    }
    if host.parse::<Ipv4Addr>().is_ok() || host.parse::<Ipv6Addr>().is_ok() {
        return false;
    }
    true
}

fn normalize_host(host: &str) -> String {
    host.trim().trim_matches(['[', ']']).to_lowercase()
}

/// HTTPS-only must not break LAN services or IP-literal hosts.
fn upgradable(host: &str) -> bool {
    worth_checking(host)
}

fn strip_default_port(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("https://") {
        let authority_end = rest.find(['/', '?', '#']);
        let (authority, tail) = match authority_end {
            Some(i) => (&rest[..i], &rest[i..]),
            None => (rest, ""),
        };
        if let Some((h, p)) = authority.rsplit_once(':') {
            if p == "80" || p == "443" {
                return format!("https://{h}{tail}");
            }
        }
    }
    url.to_string()
}

/// Rewrite request headers of a plain-HTTP request per the active policy:
/// drop the Cookie header on cross-site requests when third-party cookies
/// are blocked, and enforce the Referer policy. Returns new head bytes.
fn rewrite_head(head: &[u8], target_host: &str, snap: &Arc<PrivacySnap>) -> Vec<u8> {
    use apb_privacy::ReferrerPolicy as RP;
    let pol = &snap.policy;
    let cookie_check = pol.block_third_party_cookies;
    let ref_enforce = !matches!(pol.referrer, RP::Default);
    if !cookie_check && !ref_enforce {
        return head.to_vec();
    }
    let end = find_head_end(head).unwrap_or(head.len());
    let text = String::from_utf8_lossy(&head[..end]).into_owned();
    let target = normalize_host(target_host);

    // Determine whether this request is cross-site (Referer/Origin vs Host).
    let mut origin_host = String::new();
    for line in text.lines() {
        if let Some(v) = strip_header_name(line, "Referer:") {
            origin_host = host_of_url(v.trim());
            break;
        } else if let Some(v) = strip_header_name(line, "Origin:") {
            origin_host = host_of_url(v.trim());
        }
    }
    let cross_site = !origin_host.is_empty() && origin_host != target;

    let mut out = String::with_capacity(text.len() + 32);
    for line in text.lines() {
        if cookie_check && cross_site && strip_header_name(line, "Cookie:").is_some() {
            continue; // third-party cookie stripped at the network layer
        }
        if ref_enforce && strip_header_name(line, "Referer:").is_some() {
            let value =
                strip_header_name(line, "Referer:").unwrap_or("").trim().to_string();
            let keep_value = match pol.referrer {
                RP::Default => true,
                RP::NeverCrossOrigin | RP::SameOriginOnly => !cross_site,
                RP::StrictOriginWhenCrossOrigin => false,
            };
            if keep_value {
                out.push_str(&format!("Referer: {value}\r\n"));
            } else if matches!(pol.referrer, RP::StrictOriginWhenCrossOrigin) && cross_site {
                // Cross-origin: downgrade to the origin only.
                let o = origin_only(&value);
                if !o.is_empty() {
                    out.push_str(&format!("Referer: {o}\r\n"));
                }
            } // else: referer dropped entirely
            continue;
        }
        out.push_str(line);
        out.push_str("\r\n");
    }
    // Reassemble head + any bytes beyond it (pipelined body start).
    let mut buf = out.into_bytes();
    buf.extend_from_slice(&head[end..]);
    buf
}

/// Host without port/brackets — the key space routes and overrides use.
fn bare_host(host: &str) -> &str {
    host.trim_matches(['[', ']']).split(':').next().unwrap_or(host)
}

fn strip_header_name<'a>(line: &'a str, name: &str) -> Option<&'a str> {
    if line.len() >= name.len() && line[..name.len()].eq_ignore_ascii_case(name) {
        Some(&line[name.len()..])
    } else {
        None
    }
}

/// Extract the host part of a URL or origin string.
fn host_of_url(value: &str) -> String {
    let v = value.rsplit("://").next().unwrap_or(value);
    normalize_host(v.split(['/', '?', '#', ':']).next().unwrap_or(""))
}

/// scheme://host/ form of a URL (origin-only Referer downgrade).
fn origin_only(url: &str) -> String {
    let (scheme, rest) = match url.split_once("://") {
        Some((s, r)) => (s, r),
        None => return String::new(),
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    format!("{scheme}://{host}/")
}

/// Absolute-form → origin-form request line (for tunneled connections where
/// we speak straight to the origin server).
fn to_origin_form(head: &[u8]) -> Vec<u8> {
    let end = find_head_end(head).unwrap_or(head.len());
    let text = String::from_utf8_lossy(&head[..end]).into_owned();
    let mut lines = text.lines();
    let first = lines.next().unwrap_or("").to_string();
    let mut it = first.split_whitespace();
    let method = it.next().unwrap_or("GET").to_string();
    let target = it.next().unwrap_or("/").to_string();
    let version = it.next().unwrap_or("HTTP/1.1").to_string();
    let path = match target.find("://") {
        Some(idx) => {
            let after_scheme = &target[idx + 3..];
            let slash = after_scheme.find('/');
            match slash.map(|i| &after_scheme[i..]) {
                Some(p) => p.to_string(),
                None => "/".to_string(),
            }
        }
        None => target,
    };
    let mut out = format!("{method} {path} {version}\r\n");
    for line in lines {
        out.push_str(line);
        out.push_str("\r\n");
    }
    let mut buf = out.into_bytes();
    buf.extend_from_slice(&head[end..]);
    buf
}

// ---------------------------------------------------------------------------
// Block page
// ---------------------------------------------------------------------------

fn category_label(cat: &TrackerCategory) -> &'static str {
    match cat {
        TrackerCategory::Analytics => "аналитика / трекеры",
        TrackerCategory::Advertising => "рекламная сеть",
        TrackerCategory::Social => "социальный трекер",
        TrackerCategory::Fingerprinting => "fingerprinting-скрипт",
        TrackerCategory::Malicious => "опасный домен",
    }
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Local dark-themed block page served instead of a blank error.
fn block_page(host: &str, cat: &TrackerCategory) -> String {
    let h = escape_html(&normalize_host(host));
    let c = category_label(cat);
    format!(
        r#"<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Заблокировано — APB</title>
<style>html,body{{margin:0;height:100%;background:#0d0e12;color:#e8eaf0;font:15px/1.55 system-ui,"Segoe UI",sans-serif}}
body{{display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}}
.card{{max-width:520px;background:#15171e;border:1px solid #262a35;border-radius:16px;padding:36px 40px;text-align:center;box-shadow:0 18px 60px rgba(0,0,0,.45)}}
.shield{{font-size:44px;margin-bottom:10px}}h1{{margin:0 0 10px;font-size:20px;font-weight:600}}
b{{color:#ff6575}}.sub{{color:#9aa1af;font-size:13px;margin-top:18px}}
.kbd{{background:#1d2029;border:1px solid #2c313f;border-radius:6px;padding:1px 7px}}</style></head>
<body><div class="card"><div class="shield">🛡</div>
<h1>Запрос заблокирован</h1>
<p>Домен <b>{h}</b> определён как <b>{c}</b><br>и заблокирован фильтром приватности APB.</p>
<p class="sub">Разрешить сайт: Настройки → «🛡 Приватность» → «Исключения сайтов»<br>(домен и все его поддомены начнут пропускаться сразу).</p>
</div></body></html>"#
    )
}

fn block_response(host: &str, cat: &TrackerCategory) -> String {
    let body = block_page(host, cat);
    format!(
        "HTTP/1.1 403 Forbidden\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
}

// Made by MrDuck
