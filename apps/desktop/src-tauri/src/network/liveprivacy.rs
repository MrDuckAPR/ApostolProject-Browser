// Made by MrDuck
//! Live privacy filter shared between command handlers, the WebView2 tab
//! factory and the local filtering proxy.
//!
//! Why a separate structure instead of `AppState`: request handling runs on
//! hot paths (every network request of every tab through the proxy). Locking
//! the big `SharedState` mutex there risks UI-thread stalls, so the filter
//! keeps an atomically swappable snapshot (`policy` + its own
//! `TrackerBlocker` with built-in rules, user lists and block statistics).
//! Snapshots are rebuilt whenever the profile switches or privacy settings
//! change — cheap, lock-free reads for the data plane.

use apb_network::ProxyType;
use apb_privacy::{CustomList, PrivacyLevel, PrivacyPolicy, TrackerBlocker};
use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock, RwLock};

/// Immutable settings snapshot used by the data plane.
pub struct PrivacySnap {
    pub policy: PrivacyPolicy,
    pub blocker: TrackerBlocker,
    /// Per-site exceptions (§10A.9): host suffix -> `allow_trackers`.
    /// A matching `true` exempts the host (and its subdomains) from the
    /// network-layer blocker. Applied BEFORE rule matching in the proxy.
    pub overrides: BTreeMap<String, bool>,
}

impl PrivacySnap {
    /// Allow-everything snapshot used until the profile system boots.
    pub fn allow_all() -> Self {
        let mut policy = PrivacyPolicy::for_level(PrivacyLevel::Standard);
        policy.block_trackers = false;
        policy.block_ads = false;
        policy.block_malicious_domains = false;
        Self { policy, blocker: TrackerBlocker::new(), overrides: BTreeMap::new() }
    }

    /// Full snapshot: effective policy (+ emergency merge done by caller),
    /// a blocker loaded with the profile's custom lists and its site
    /// exceptions map.
    pub fn build(
        policy: PrivacyPolicy,
        lists: &[CustomList],
        overrides: BTreeMap<String, bool>,
    ) -> Self {
        let mut blocker = TrackerBlocker::new();
        for l in lists {
            blocker.add_custom_list(&l.text, l.category);
        }
        Self { policy, blocker, overrides }
    }

    /// Whether `host` (or any of its parent domains) has an explicit
    /// allow-trackers exception.
    pub fn override_allows(&self, host: &str) -> bool {
        let mut rest = host;
        loop {
            if let Some(true) = self.overrides.get(rest) {
                return true;
            }
            match rest.find('.') {
                Some(i) => rest = &rest[i + 1..],
                None => return false,
            }
        }
    }
}

/// Atomically swappable snapshot holder. Reads are wait-free clones of an Arc.
#[derive(Default)]
pub struct LiveFilter(RwLock<Option<Arc<PrivacySnap>>>);

impl LiveFilter {
    pub fn get(&self) -> Arc<PrivacySnap> {
        self.0
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .unwrap_or_else(|| Arc::new(PrivacySnap::allow_all()))
    }

    pub fn set(&self, snap: PrivacySnap) {
        *self.0.write().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(snap));
    }
}

// ---------------------------------------------------------------------------
// Unified WebView2 browser arguments
// ---------------------------------------------------------------------------
//
// All webviews of one user-data folder MUST be created with IDENTICAL
// environment options (WebView2 refuses otherwise), so the shell window and
// every tab share this exact string, computed once at startup.

const DEFAULT_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

static BROWSER_ARGS: OnceLock<String> = OnceLock::new();

/// Must be called once before the first webview is created (shell window
/// setup). DNS settings are intentionally NOT forwarded to the engine here:
/// behind an HTTP proxy WebView2 never resolves hostnames itself (it sends
/// CONNECT host:port), so engine-level DoH flags would be dead code —
/// profile DNS is owned by `crate::resolver` instead.
pub fn init_browser_args(proxy_port: Option<u16>, allow_autoplay: bool) {
    // Автозапуск медиа: по умолчанию блокируем (видео не стартуют сами).
    // Экспериментальная настройка «Разрешить автозапуск» снимает флаг —
    // Chromium вернётся к своему дефолту (muted-автоплей + звук по клику).
    let autoplay = if allow_autoplay {
        "--autoplay-policy=no-user-gesture-required"
    } else {
        "--autoplay-policy=user-gesture-required"
    };
    let mut args = format!("{DEFAULT_ARGS} {autoplay}");
    if let Some(port) = proxy_port {
        args.push_str(&format!(" --proxy-server=http://127.0.0.1:{port}"));
    }
    // WebRTC leak protection: UDP candidates outside a proxy are forbidden.
    // This is a static engine-level switch (browser args cannot change after
    // startup), so it applies to every profile regardless of policy.webrtc —
    // the policy value only tunes what the UI/dashboard reports.
    args.push_str(" --force-webrtc-ip-handling-policy=disable_non_proxied_udp");
    let _ = BROWSER_ARGS.set(args);
}

/// The session-wide browser arguments (safe to call from any thread).
pub fn browser_args() -> &'static str {
    BROWSER_ARGS
        .get()
        .map(|s| s.as_str())
        .unwrap_or(DEFAULT_ARGS)
}

// ---------------------------------------------------------------------------
// Upstream route snapshot (external proxy chains from the Network section)
// ---------------------------------------------------------------------------

/// One supported upstream hop. `Http` hops speak CONNECT, `Socks5` hops get
/// a SOCKS5 handshake (domain names are passed through — no local DNS).
/// `ProxyType::Https` chains are NOT supported by the std-only proxy and are
/// skipped with an honest status note.
#[derive(Debug, Clone)]
pub enum UpHop {
    Http { host: String, port: u16, auth: Option<(String, String)> },
    Socks5 { host: String, port: u16, auth: Option<(String, String)> },
}

impl UpHop {
    pub fn addr(&self) -> String {
        let (h, p) = match self {
            UpHop::Http { host, port, .. } | UpHop::Socks5 { host, port, .. } => (host, *port),
        };
        format!("{h}:{p}")
    }
}

/// Routing table snapshot for the data plane: the default chain plus
/// per-host suffix rules (`direct` forces bypass even when a default chain
/// exists; rules may point at their own chain).
pub struct NetSnap {
    pub default_chain: Option<Vec<UpHop>>,
    /// (host_suffix, target): `None` = direct.
    pub rules: Vec<(String, Option<Vec<UpHop>>)>,
}

impl Default for NetSnap {
    fn default() -> Self {
        Self { default_chain: None, rules: Vec::new() }
    }
}

impl NetSnap {
    /// The hop sequence for `host`, or `None` for a direct connection.
    /// LAN/IP hosts are handled by the proxy itself and never reach this.
    pub fn resolve(&self, host: &str) -> Option<&[UpHop]> {
        let host = host.to_lowercase();
        for (suffix, target) in &self.rules {
            if host.ends_with(suffix.as_str()) || host == suffix.as_str() {
                return target.as_deref();
            }
        }
        self.default_chain.as_deref()
    }
}

static ROUTE: OnceLock<RwLock<Arc<NetSnap>>> = OnceLock::new();

fn route_cell() -> &'static RwLock<Arc<NetSnap>> {
    ROUTE.get_or_init(|| RwLock::new(Arc::new(NetSnap::default())))
}

/// Current routing table for the proxy threads (lock-free clone of an Arc).
pub fn route_snapshot() -> Arc<NetSnap> {
    route_cell().read().unwrap_or_else(|e| e.into_inner()).clone()
}

#[derive(Debug, Clone, Default)]
pub struct EnforceStatus {
    pub doh: String,
    pub upstream: String,
}

static ENFORCE: OnceLock<RwLock<EnforceStatus>> = OnceLock::new();

fn enforce_cell() -> &'static RwLock<EnforceStatus> {
    ENFORCE.get_or_init(|| RwLock::new(EnforceStatus::default()))
}

/// Human-readable enforcement summary for the privacy overview.
pub fn enforce_status() -> EnforceStatus {
    enforce_cell().read().unwrap_or_else(|e| e.into_inner()).clone()
}

// ---------------------------------------------------------------------------
// Snapshot refresh
// ---------------------------------------------------------------------------

/// Rebuild BOTH live snapshots from the active profile's settings:
/// the privacy filter (policy + blocker + site overrides) and the network
/// route (external proxy chains + per-host rules). Call after every
/// mutation that affects either: level/policy updates, emergency mode,
/// custom list changes, override changes, profile switch/delete and
/// `save_network_settings`.
pub fn sync_from_state(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let state = app.state::<crate::state::SharedState>();
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let policy = active.privacy.effective_policy();
    let lists = active.privacy.custom_lists.clone();
    let overrides: BTreeMap<String, bool> = active
        .privacy
        .site_overrides
        .iter()
        .map(|(h, o)| (h.clone(), o.allow_trackers))
        .collect();
    let network = active.network.clone();
    drop(guard);

    let filter = app.state::<Arc<LiveFilter>>();
    filter.set(PrivacySnap::build(policy, &lists, overrides));

    // ---- route snapshot ----
    let mut snap = NetSnap::default();
    let mut upstream_note = "прямой (без внешнего прокси)".to_string();
    if let Some(chain_id) = network.default_chain {
        if let Some(chain) = network.chains.get(&chain_id) {
            match hops_of(chain) {
                Ok(hops) if !hops.is_empty() => {
                    upstream_note =
                        format!("внешняя цепочка «{}»: {} узл(ов)", chain.name, hops.len());
                    snap.default_chain = Some(hops);
                }
                Ok(_) => {}
                Err(kind) => {
                    upstream_note = format!(
                        "цепочка «{}» пропущена: узел {kind:?} не поддерживается локальным прокси (используйте Http или Socks5)",
                        chain.name
                    );
                }
            }
        }
    }
    for rule in &network.rules {
        if rule.host_suffix.is_empty() {
            continue;
        }
        let target = if rule.direct {
            None
        } else {
            rule.chain_id.and_then(|id| network.chains.get(&id)).and_then(|c| hops_of(c).ok())
        };
        snap.rules.push((rule.host_suffix.to_lowercase(), target));
    }
    *route_cell().write().unwrap_or_else(|e| e.into_inner()) = Arc::new(snap);
    // Profile DNS → proxy resolver snapshot + honest enforcement note.
    crate::network::resolver::apply(&network.dns);
    {
        let mut en = enforce_cell().write().unwrap_or_else(|e| e.into_inner());
        en.doh = crate::network::resolver::describe(&network.dns);
        en.upstream = upstream_note;
    }
    Ok(())
}

/// Convert a configured chain into supported upstream hops.
/// Err(ProxyType) reports the first unsupported hop kind.
fn hops_of(chain: &apb_network::ProxyChain) -> Result<Vec<UpHop>, ProxyType> {
    let mut out = Vec::new();
    for hop in &chain.hops {
        let auth = hop
            .username
            .clone()
            .map(|u| (u, hop.password.clone().unwrap_or_default()));
            match hop.kind {
                ProxyType::Https => return Err(ProxyType::Https),
                ProxyType::Http => out.push(UpHop::Http { host: hop.host.clone(), port: hop.port, auth }),
                ProxyType::Socks5 => out.push(UpHop::Socks5 { host: hop.host.clone(), port: hop.port, auth }),
            }
    }
    Ok(out)
}

// Made by MrDuck
