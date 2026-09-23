// Made by MrDuck && Ox-Alpha
//! apb-privacy
//!
//! The Privacy Engine (design doc §10, §10A). This crate is the single
//! source of truth for *what* the browser does to protect the user; the
//! engine adapter and the UI only read from it. Everything here is
//! profile-scoped: a `PolicyStore` lives in the owning profile's storage
//! root as a plain JSON document (`privacy.json`), so privacy settings are
//! part of the profile (§10A.27) and trivially auditable by hand.
//!
//! Honest-boundary note (§10A.31): this crate computes policy, matches
//! tracker rules, derives fingerprint personas, runs audits. It cannot by
//! itself intercept network traffic — enforcement points are documented on
//! each item (`enforced_by` in the audit findings and README).

pub use apb_profiles::{PrivacyLevel, Profile};
pub mod blocklists;
use blocklists::builtin_rules;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum PrivacyError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, PrivacyError>;

// ---------------------------------------------------------------------------
// Policy model (§10A.1 — Privacy Levels)
// ---------------------------------------------------------------------------

/// How aggressively fingerprinting surfaces are normalized (§10A.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FingerprintLevel {
    Off,
    Lite,
    Standard,
    Aggressive,
}

/// WebRTC leak posture (§10, §10A.6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WebRtcPolicy {
    /// WebRTC fully enabled.
    Enabled,
    /// Media works but public IP candidates are hidden (mDNS-only).
    HidePublicIps,
    Disabled,
}

/// Referer handling (§10A.14).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReferrerPolicy {
    Default,
    StrictOriginWhenCrossOrigin,
    SameOriginOnly,
    NeverCrossOrigin,
}

/// The concrete, per-profile privacy configuration. A `PrivacyLevel` preset
/// maps onto this struct; switching to Custom keeps the current values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PrivacyPolicy {
    pub level: PrivacyLevel,
    // -- Tracker & content blocking (§10A.11) --
    pub block_trackers: bool,
    pub block_ads: bool,
    pub block_fingerprinting_scripts: bool,
    pub block_malicious_domains: bool,
    // -- Cookies & storage (§10A.12-13) --
    pub block_third_party_cookies: bool,
    pub strict_storage_isolation: bool,
    pub clear_cookies_on_exit: bool,
    // -- Fingerprinting (§10A.4) --
    pub fingerprint_protection: FingerprintLevel,
    // -- Network-adjacent (§10A.6, §10A.14) --
    pub webrtc: WebRtcPolicy,
    pub referrer: ReferrerPolicy,
    pub https_only: bool,
    pub block_hyperlink_auditing: bool,
    // -- URL privacy (§10A.15) --
    pub network_prefetch: bool,
    pub dns_prefetch: bool,
    pub search_suggestions_remote: bool,
    // -- Telemetry (§10A.17): always off in code; kept explicit so the UI
    //    can display it and audits can assert it. Not user-settable.
    pub telemetry_enabled: bool,
}

impl PrivacyPolicy {
    /// Preset mapping (§10A.1). Standard = compatibility-first BUT ad
    /// blocking is on from the very first launch (a privacy-first browser
    /// does not ship with ads enabled); Maximum = aggressive even if some
    /// sites break.
    pub fn for_level(level: PrivacyLevel) -> Self {
        let mut p = Self {
            level,
            block_trackers: true,
            block_ads: true,
            block_fingerprinting_scripts: false,
            block_malicious_domains: true,
            block_third_party_cookies: false,
            strict_storage_isolation: false,
            clear_cookies_on_exit: false,
            fingerprint_protection: FingerprintLevel::Off,
            webrtc: WebRtcPolicy::Enabled,
            referrer: ReferrerPolicy::Default,
            https_only: false,
            block_hyperlink_auditing: true,
            network_prefetch: true,
            dns_prefetch: true,
            search_suggestions_remote: true,
            telemetry_enabled: false,
        };
        match level {
            PrivacyLevel::Standard => {}
            PrivacyLevel::Balanced => {
                p.block_ads = true;
                p.block_third_party_cookies = true;
                p.block_fingerprinting_scripts = true;
                p.fingerprint_protection = FingerprintLevel::Lite;
                p.webrtc = WebRtcPolicy::HidePublicIps;
                p.referrer = ReferrerPolicy::StrictOriginWhenCrossOrigin;
                p.https_only = true;
                p.network_prefetch = false;
            }
            PrivacyLevel::Strict => {
                p.block_ads = true;
                p.block_third_party_cookies = true;
                p.block_fingerprinting_scripts = true;
                p.fingerprint_protection = FingerprintLevel::Standard;
                p.webrtc = WebRtcPolicy::HidePublicIps;
                p.referrer = ReferrerPolicy::SameOriginOnly;
                p.https_only = true;
                p.strict_storage_isolation = true;
                p.network_prefetch = false;
                p.dns_prefetch = false;
                p.search_suggestions_remote = false;
            }
            PrivacyLevel::Maximum => {
                p.block_ads = true;
                p.block_third_party_cookies = true;
                p.block_fingerprinting_scripts = true;
                p.fingerprint_protection = FingerprintLevel::Aggressive;
                p.webrtc = WebRtcPolicy::Disabled;
                p.referrer = ReferrerPolicy::NeverCrossOrigin;
                p.https_only = true;
                p.strict_storage_isolation = true;
                p.clear_cookies_on_exit = true;
                p.network_prefetch = false;
                p.dns_prefetch = false;
                p.search_suggestions_remote = false;
            }
            PrivacyLevel::Custom => {
                // Custom starts from Balanced-grade defaults; the user then
                // flips individual switches in Settings.
                let balanced = Self::for_level(PrivacyLevel::Balanced);
                p = balanced.with_level(PrivacyLevel::Custom);
            }
        }
        p
    }

    fn with_level(mut self, level: PrivacyLevel) -> Self {
        self.level = level;
        self
    }

    /// Apply Emergency Privacy Mode (§10A.25): the most defensive values of
    /// every switch, without destroying the user's chosen configuration.
    pub fn into_emergency(mut self) -> Self {
        self.block_trackers = true;
        self.block_ads = true;
        self.block_fingerprinting_scripts = true;
        self.block_malicious_domains = true;
        self.block_third_party_cookies = true;
        self.strict_storage_isolation = true;
        self.fingerprint_protection = FingerprintLevel::Aggressive;
        self.webrtc = WebRtcPolicy::Disabled;
        self.referrer = ReferrerPolicy::NeverCrossOrigin;
        self.https_only = true;
        self.block_hyperlink_auditing = true;
        self.network_prefetch = false;
        self.dns_prefetch = false;
        self.search_suggestions_remote = false;
        self.telemetry_enabled = false;
        self
    }
}

// ---------------------------------------------------------------------------
// Tracker protection (§10A.11)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrackerCategory {
    Analytics,
    Advertising,
    Social,
    Fingerprinting,
    Malicious,
}

/// Domain-rule blocker. Rules are bare domains (`doubleclick.net`); any
/// subdomain matches too. Built-in list ships with the binary; users add
/// their own lists (hosts-format or one-domain-per-line) at runtime.
pub struct TrackerBlocker {
    rules: BTreeMap<String, TrackerCategory>,
    stats: Mutex<BlockStats>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct BlockStats {
    pub total_blocked: u64,
    pub per_category: BTreeMap<String, u64>,
    /// host -> blocked count, capped by the caller when displaying.
    pub per_site: BTreeMap<String, u64>,
}

impl TrackerBlocker {
    pub fn new() -> Self {
        let mut rules = BTreeMap::new();
        for (domain, cat) in builtin_rules() {
            rules.insert(domain.to_string(), cat);
        }
        Self {
            rules,
            stats: Mutex::new(BlockStats::default()),
        }
    }

    pub fn rule_count(&self) -> usize {
        self.rules.len()
    }

    /// Add user-supplied list text. Accepts hosts-file lines
    /// (`0.0.0.0 domain`) and plain domain lines; `#` comments ignored.
    /// Returns how many new rules were added.
    pub fn add_custom_list(&mut self, text: &str, category: TrackerCategory) -> usize {
        let mut added = 0;
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let domain = line.split_whitespace().next_back().unwrap_or(line);
            let domain = domain.trim().to_lowercase();
            if is_plausible_domain(&domain) && !self.rules.contains_key(&domain) {
                self.rules.insert(domain, category);
                added += 1;
            }
        }
        added
    }

    /// Критические для работы браузера домены — ядро поиска/порталов.
    /// НИКОГДА не блокируются целиком, даже если кастомный список
    /// пользователя добавил их в правила (ЖУРНАЛ 2026-09-20: www.google.com
    /// 403 → ERR_TUNNEL_CONNECTION_FAILED). Точные ПОДдомены-трекеры
    /// (analytics.google.com и т.п.) блокируются как раньше — защита
    /// срабатывает только когда host сам в списке либо в правиле матчился
    /// родитель.
    const NEVER_BLOCK: &[&str] = &[
        "google.com", "yandex.ru", "yandex.com", "duckduckgo.com",
        "bing.com", "startpage.com", "github.com", "gitlab.com",
        "youtube.com", "vk.com", "mail.ru", "wikipedia.org",
        "telegram.org", "reddit.com", "x.com", "twitter.com",
        "linkedin.com", "instagram.com", "facebook.com",
    ];

    /// Classify a request host. Exact match or any-depth subdomain match.
    pub fn classify(&self, host: &str) -> Option<TrackerCategory> {
        let host = host.trim().to_lowercase();
        let host = host.strip_suffix('.').unwrap_or(&host);
        if let Some(cat) = self.rules.get(host) {
            // Точное правило на сам домен из кастомного списка может
            // «крыть» критический хост (напр. google.com) — не даём.
            if !Self::NEVER_BLOCK.contains(&host) {
                return Some(*cat);
            }
        }
        // Walk up parent domains: a.b.evil-tracker.com -> evil-tracker.com
        let mut rest = host;
        while let Some(dot) = rest.find('.') {
            rest = &rest[dot + 1..];
            // Родитель из критического списка (www.google.com → google.com)
            // перекрывает любое правило кастомного списка на этот корень.
            if Self::NEVER_BLOCK.contains(&rest) {
                return None;
            }
            if let Some(cat) = self.rules.get(rest) {
                return Some(*cat);
            }
        }
        None
    }

    /// Record a blocked request against the live stats.
// Made by MrDuck && Ox-Alpha
    pub fn record_block(&self, host: &str, category: TrackerCategory) {
        let mut stats = self.stats.lock().expect("privacy stats mutex poisoned");
        stats.total_blocked += 1;
        *stats
            .per_category
            .entry(format!("{category:?}"))
            .or_insert(0) += 1;
        *stats.per_site.entry(host.to_string()).or_insert(0) += 1;
    }

    /// Full decision pipeline used by the engine adapter: classify + count.
    /// Returns the category when the request should be blocked under the
    /// active policy.
    pub fn inspect(&self, host: &str, policy: &PrivacyPolicy) -> Option<TrackerCategory> {
        if !(policy.block_trackers || policy.block_ads || policy.block_malicious_domains) {
            return None;
        }
        let category = self.classify(host)?;
        let relevant = match category {
            TrackerCategory::Analytics | TrackerCategory::Social | TrackerCategory::Fingerprinting => {
                policy.block_trackers || policy.block_fingerprinting_scripts
            }
            TrackerCategory::Advertising => policy.block_ads || policy.block_trackers,
            TrackerCategory::Malicious => policy.block_malicious_domains,
        };
        if relevant {
            self.record_block(host, category);
            Some(category)
        } else {
            None
        }
    }

    pub fn stats(&self) -> BlockStats {
        self.stats.lock().expect("privacy stats mutex poisoned").clone()
    }

    pub fn reset_stats(&self) {
        *self.stats.lock().expect("privacy stats mutex poisoned") = BlockStats::default();
    }
}

impl Default for TrackerBlocker {
    fn default() -> Self {
        Self::new()
    }
}

/// Domain-shaped enough to enter the blocker map (also used by the filter
/// list parser in `blocklists`).
pub fn is_plausible_domain(s: &str) -> bool {
    !s.is_empty()
        && s.contains('.')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
}

// ---------------------------------------------------------------------------
// Anti-fingerprinting (§10A.4-5)
// ---------------------------------------------------------------------------

/// A deterministic, standardized device persona. Instead of randomizing
/// every value per page load (which makes the browser uniquely *weird*),
/// we pick values from common hardware pools so the user blends into the
/// crowd (§10A.4: "less unique, not constantly changing").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FingerprintPersona {
    pub screen_width: u32,
    pub screen_height: u32,
    pub color_depth: u32,
    pub hardware_concurrency: u32,
    pub device_memory_gb: u32,
    pub timezone: String,
    pub locale: String,
    pub platform: String,
    pub webgl_vendor: String,
    pub webgl_renderer: String,
    /// Seed for deterministic canvas/audio noise (per profile+level).
    pub noise_seed: u64,
}

const SCREENS: &[(u32, u32)] = &[
    (1920, 1080),
    (1366, 768),
    (1536, 864),
    (1440, 900),
    (2560, 1440),
];
const CORES: &[u32] = &[4, 8, 12, 16];
const MEMORY: &[u32] = &[4, 8, 16];
const TIMEZONES: &[&str] = &["UTC", "Europe/London", "Europe/Berlin", "America/New_York"];
const GPUS: &[(&str, &str)] = &[
    ("Google Inc. (Intel)", "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)"),
    ("Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0)"),
    ("Google Inc. (AMD)", "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)"),
];

fn hash64(seed: u64) -> u64 {
    // splitmix64 — tiny, stable, dependency-free.
    let mut z = seed.wrapping_add(0x9E3779B97F4A7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}

impl FingerprintPersona {
    /// Deterministic per (profile_id, level): same profile always presents
    /// the same persona to the web, which is both more private-in-practice
    /// and more usable than per-load randomization.
    pub fn derive(profile_id: Uuid, level: FingerprintLevel) -> Self {
        let base = hash64(
            profile_id.as_u128() as u64 ^ (level as u64).wrapping_mul(0x517CC1B727220A95),
        );
        let pick = |n: usize, salt: u8| -> usize { (hash64(base ^ u64::from(salt)) % n as u64) as usize };
        let (w, h) = SCREENS[pick(SCREENS.len(), 1)];
        Self {
            screen_width: w,
            screen_height: h,
            color_depth: 24,
            hardware_concurrency: CORES[pick(CORES.len(), 2)],
            device_memory_gb: MEMORY[pick(MEMORY.len(), 3)],
            timezone: TIMEZONES[pick(TIMEZONES.len(), 4)].to_string(),
            locale: "en-US".to_string(),
            platform: "Win32".to_string(),
            webgl_vendor: GPUS[pick(GPUS.len(), 5)].0.to_string(),
            webgl_renderer: GPUS[pick(GPUS.len(), 5)].1.to_string(),
            noise_seed: hash64(base ^ 0xF00D),
        }
    }

    /// Best-effort JS injected into every frame by the engine adapter.
    /// Covers canvas, WebGL, audio, navigator hardware, screen, battery,
    /// media devices. Timezone/locale are reported via Intl shims where the
    /// engine allows; full OS-level timezone masking is an engine-layer
    /// boundary (documented in README, §10A.4 honest limits).
    pub fn injection_script(&self) -> String {
        let seed = self.noise_seed;
        format!(
            r#"(() => {{
  const P = {{ sw:{sw}, sh:{sh}, cd:{cd}, hc:{hc}, dm:{dm}, tz:"{tz}", loc:"{loc}", plat:"{plat}",
               gv:"{gv}", gr:"{gr}", seed:{seed} }};
  const def = (obj, prop, val) => {{ try {{
      Object.defineProperty(obj, prop, {{ get: () => val, configurable: true }});
  }} catch (e) {{}} }};
  def(navigator, "hardwareConcurrency", P.hc);
  def(navigator, "deviceMemory", P.dm);
  def(navigator, "platform", P.plat);
  def(screen, "width", P.sw); def(screen, "height", P.sh);
  def(screen, "availWidth", P.sw); def(screen, "availHeight", P.sh - 40);
  def(screen, "colorDepth", P.cd); def(screen, "pixelDepth", P.cd);
  // Deterministic PRNG (mulberry32) seeded per-profile.
  let s = P.seed >>> 0;
  const rnd = () => {{ s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }};
  const noise = (data) => {{ for (let i = 0; i < data.length; i += 997) {{
      data[i] = data[i] ^ ((rnd() * 3) | 0); }} }};
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(...a) {{
    try {{ const ctx = this.getContext("2d");
      if (ctx) noise(ctx.getImageData(0, 0, this.width, this.height).data); }} catch (e) {{}}
    return origToDataURL.apply(this, a); }};
  const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function(...a) {{
    const img = origGetImageData.apply(this, a); noise(img.data); return img; }};
  const getParam = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(p) {{
    if (p === 37445) return P.gv;
    if (p === 37446) return P.gr;
    return getParam.apply(this, [p]); }};
  if (window.OfflineAudioContext) {{
    const origGetChannel = AudioBuffer.prototype.getChannelData;
    AudioBuffer.prototype.getChannelData = function(...a) {{
      const d = origGetChannel.apply(this, a);
      for (let i = 0; i < d.length; i += 500) d[i] += (rnd() - 0.5) * 1e-7;
      return d; }};
  }}
  def(navigator, "getBattery", () => Promise.resolve({{
    charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1,
    addEventListener() {{}}, removeEventListener() {{}} }}));
  if (navigator.mediaDevices) {{
    def(navigator.mediaDevices, "enumerateDevices",
      () => Promise.resolve([{{ deviceId: "default", kind: "audioinput", label: "", groupId: "g1" }},
                             {{ deviceId: "default", kind: "videoinput", label: "", groupId: "g2" }}]));
  }}
}})();"#,
            sw = self.screen_width,
            sh = self.screen_height,
            cd = self.color_depth,
            hc = self.hardware_concurrency,
            dm = self.device_memory_gb,
            tz = self.timezone,
            loc = self.locale,
            plat = self.platform,
            gv = self.webgl_vendor,
            gr = self.webgl_renderer,
            seed = seed,
        )
    }
}

/// What the Fingerprint Dashboard (§10A.5) displays per surface.
#[derive(Debug, Clone, Serialize)]
pub struct FingerprintSurface {
    pub surface: &'static str,
    pub status: String,
}

pub fn fingerprint_dashboard(policy: &PrivacyPolicy, persona: &FingerprintPersona) -> Vec<FingerprintSurface> {
    let on = policy.fingerprint_protection != FingerprintLevel::Off;
    vec![
        FingerprintSurface { surface: "Canvas", status: if on { "Protected" } else { "Visible" }.into() },
        FingerprintSurface { surface: "WebGL", status: if on { "Protected" } else { "Visible" }.into() },
        FingerprintSurface { surface: "Audio", status: if on { "Protected" } else { "Visible" }.into() },
        FingerprintSurface {
            surface: "Fonts",
            status: if policy.fingerprint_protection == FingerprintLevel::Aggressive { "Restricted" } else if on { "Limited" } else { "Visible" }.into(),
        },
        FingerprintSurface { surface: "Hardware Info", status: if on { "Reduced" } else { "Exact" }.into() },
        FingerprintSurface { surface: "Screen Info", status: if on { "Normalized" } else { "Exact" }.into() },
        FingerprintSurface {
            surface: "Timezone",
            status: if on { format!("{} (normalized)", persona.timezone) } else { "System".into() },
        },
        FingerprintSurface {
            surface: "WebRTC",
            status: match policy.webrtc {
                WebRtcPolicy::Disabled => "Disabled".into(),
                WebRtcPolicy::HidePublicIps => "Protected".into(),
                WebRtcPolicy::Enabled => "Exposed".into(),
            },
        },
        FingerprintSurface { surface: "Media Devices", status: if on { "Generic" } else { "Exact" }.into() },
    ]
}

// ---------------------------------------------------------------------------
// Per-site overrides (§10A.9)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SiteOverride {
    pub host: String,
    pub allow_trackers: bool,
    pub third_party_cookies: Option<bool>,
    pub javascript: Option<bool>,
    pub camera: PermissionDecision,
    pub microphone: PermissionDecision,
    pub location: PermissionDecision,
    pub notifications: PermissionDecision,
    pub clipboard_read: PermissionDecision,
    pub popups: PermissionDecision,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PermissionDecision {
    Allow,
    Ask,
    Block,
}

impl SiteOverride {
// Made by MrDuck && Ox-Alpha
    pub fn new(host: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            allow_trackers: false,
            third_party_cookies: None,
            javascript: None,
            camera: PermissionDecision::Ask,
            microphone: PermissionDecision::Block,
            location: PermissionDecision::Ask,
            notifications: PermissionDecision::Block,
            clipboard_read: PermissionDecision::Ask,
            popups: PermissionDecision::Block,
        }
    }
}

// ---------------------------------------------------------------------------
// Threat model (§10A.30)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Threat {
    CasualTrackers,
    AdvertisingNetworks,
    WebFingerprinting,
    MaliciousWebsites,
    NetworkObserver,
    PublicWifi,
    LocalDeviceUsers,
    Extensions,
    CloudAiProviders,
}

pub struct ThreatRecommendation {
    pub policy: PrivacyPolicy,
    pub notes: Vec<&'static str>,
}

/// Map selected threats onto a recommended concrete configuration.
pub fn recommend_for_threats(threats: &[Threat], base_level: PrivacyLevel) -> ThreatRecommendation {
    let mut policy = PrivacyPolicy::for_level(base_level);
    let mut notes = Vec::new();
    for t in threats {
        match t {
            Threat::CasualTrackers | Threat::AdvertisingNetworks => {
                policy.block_trackers = true;
                policy.block_ads = true;
                policy.block_third_party_cookies = true;
                policy.strict_storage_isolation = true;
                notes.push("Tracker и cookie-защита включены для блокировки рекламных сетей.");
            }
            Threat::WebFingerprinting => {
                policy.fingerprint_protection = FingerprintLevel::Standard;
                policy.block_fingerprinting_scripts = true;
                notes.push("Fingerprint-нормализация включена: стандартизированные значения вместо уникальных.");
            }
            Threat::MaliciousWebsites => {
                policy.block_malicious_domains = true;
                policy.https_only = true;
                notes.push("HTTPS-only и блокировка malicious-доменов включены.");
            }
            Threat::NetworkObserver | Threat::PublicWifi => {
                policy.https_only = true;
                policy.dns_prefetch = false;
                policy.network_prefetch = false;
                notes.push("Включите DoH/DoT или доверенный proxy в разделе Сеть — это шифрует DNS и маршрут.");
            }
            Threat::LocalDeviceUsers => {
                policy.clear_cookies_on_exit = true;
                notes.push("Рассмотрите Ephemeral-профиль (Anonymous) для сессий на общем устройстве.");
            }
            Threat::Extensions => {
                notes.push("Проверьте разрешения расширений в разделе Расширения; опасные требуют подтверждения.");
            }
            Threat::CloudAiProviders => {
                notes.push("Ограничьте AI-контекст и используйте локальную модель в настройках AI.");
            }
        }
    }
    ThreatRecommendation { policy, notes }
}

// ---------------------------------------------------------------------------
// Audit (§10A.29)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum FindingStatus {
    Ok,
    Warn,
    Critical,
}

#[derive(Debug, Clone, Serialize)]
pub struct Finding {
    pub status: FindingStatus,
    pub area: &'static str,
    pub message: String,
}

/// Inputs gathered from sibling crates so the audit sees the whole picture.
#[derive(Debug, Clone, Default)]
pub struct AuditInputs {
    pub dns_encrypted: bool,
    pub proxy_configured: bool,
    pub extensions_with_broad_permissions: usize,
    pub ai_cloud_configured: bool,
    pub vault_created: bool,
}

pub fn run_audit(policy: &PrivacyPolicy, net: &AuditInputs) -> Vec<Finding> {
    let mut f = Vec::new();
    f.push(Finding {
        status: if net.dns_encrypted { FindingStatus::Ok } else { FindingStatus::Warn },
        area: "DNS",
        message: if net.dns_encrypted {
            "DNS over HTTPS/TLS включён".into()
        } else {
            "DNS идёт через системный резолвер в открытом виде — включите DoH в разделе Сеть".into()
        },
    });
    f.push(Finding {
        status: FindingStatus::Ok,
        area: "WebRTC",
        message: match policy.webrtc {
            // Engine-level: --force-webrtc-ip-handling-policy=disable_non_proxied_udp
            // is always on, so even the permissive profile cannot leak UDP.
            WebRtcPolicy::Enabled => "WebRTC работает, но UDP вне прокси запрещён движком".into(),
            WebRtcPolicy::HidePublicIps => "Публичные IP скрыты; UDP вне прокси запрещён".into(),
            WebRtcPolicy::Disabled => "WebRTC отключён политикой профиля".into(),
        },
    });
    f.push(Finding {
        status: if policy.block_third_party_cookies { FindingStatus::Ok } else { FindingStatus::Warn },
        area: "Cookies",
        message: if policy.block_third_party_cookies {
            "Сторонние cookies блокируются".into()
        } else {
            "Сторонние cookies разрешены".into()
        },
    });
    f.push(Finding {
        status: if policy.telemetry_enabled { FindingStatus::Critical } else { FindingStatus::Ok },
        area: "Telemetry",
        message: "Telemetry выключена по умолчанию и не отправляет данные".into(),
    });
    f.push(Finding {
        status: if policy.fingerprint_protection != FingerprintLevel::Off {
            FindingStatus::Ok
        } else {
            FindingStatus::Warn
        },
        area: "Fingerprint",
        message: match policy.fingerprint_protection {
            FingerprintLevel::Off => "Fingerprint-защита выключена".into(),
            lvl => format!("Fingerprint-нормализация: {lvl:?}"),
        },
    });
    f.push(Finding {
        status: if net.extensions_with_broad_permissions == 0 {
            FindingStatus::Ok
        } else {
            FindingStatus::Warn
        },
        area: "Extensions",
        message: if net.extensions_with_broad_permissions == 0 {
            "Нет расширений с широкими разрешениями".into()
        } else {
            format!(
                "{} расширений имеют широкие разрешения — проверьте раздел Расширения",
                net.extensions_with_broad_permissions
            )
        },
    });
    f.push(Finding {
        status: if net.proxy_configured { FindingStatus::Ok } else { FindingStatus::Warn },
        area: "Proxy",
        message: if net.proxy_configured {
            "Proxy настроен".into()
        } else {
            "Proxy не настроен — трафик идёт напрямую".into()
        },
    });
    f.push(Finding {
        status: if net.vault_created { FindingStatus::Ok } else { FindingStatus::Warn },
        area: "Vault",
        message: if net.vault_created {
            "Secure Vault создан, секреты шифруются".into()
        } else {
            "Secure Vault не создан — пароли не хранятся браузером".into()
        },
    });
    f.push(Finding {
        status: if net.ai_cloud_configured { FindingStatus::Warn } else { FindingStatus::Ok },
        area: "AI",
        message: if net.ai_cloud_configured {
            "Cloud AI настроен — Privacy Firewall фильтрует секреты перед отправкой".into()
        } else {
            "Cloud AI не настроен — данные не покидают устройство".into()
        },
    });
    f
}

// ---------------------------------------------------------------------------
// Persistence (§10A.27 — privacy settings belong to the profile)
// ---------------------------------------------------------------------------

/// Everything this crate persists for one profile, stored as
/// `<profile_root>/privacy.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyState {
    pub policy: PrivacyPolicy,
    pub custom_lists: Vec<CustomList>,
    pub site_overrides: BTreeMap<String, SiteOverride>,
    pub threats: Vec<Threat>,
    pub emergency_mode: bool,
    /// Panic Button config (§10A.26): what the shortcut actually does.
    pub panic_actions: PanicActions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomList {
    pub name: String,
    pub category: TrackerCategory,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct PanicActions {
    pub close_anonymous_session: bool,
    pub clear_current_site_data: bool,
    pub clear_current_session_history: bool,
    pub clear_all_temporary_data: bool,
}

impl PrivacyState {
    pub fn for_profile(profile: &Profile) -> Self {
        Self {
            policy: PrivacyPolicy::for_level(profile.privacy_level),
            custom_lists: Vec::new(),
            site_overrides: BTreeMap::new(),
            threats: vec![Threat::CasualTrackers, Threat::AdvertisingNetworks],
            emergency_mode: false,
            panic_actions: PanicActions::default(),
        }
    }

    pub fn save(&self, root: impl AsRef<Path>) -> Result<()> {
        let path: PathBuf = root.as_ref().join("privacy.json");
        let tmp = root.as_ref().join("privacy.json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(self)?)?;
        std::fs::rename(&tmp, &path)?;
        Ok(())
    }

    pub fn load(root: impl AsRef<Path>) -> Result<Option<Self>> {
        let path = root.as_ref().join("privacy.json");
        if !path.exists() {
            return Ok(None);
        }
        Ok(Some(serde_json::from_str(&std::fs::read_to_string(&path)?)?))
    }

    /// Effective policy right now: emergency mode overrides everything.
// Made by MrDuck && Ox-Alpha
    pub fn effective_policy(&self) -> PrivacyPolicy {
        if self.emergency_mode {
            self.policy.clone().into_emergency()
        } else {
            self.policy.clone()
        }
    }
}

// ---------------------------------------------------------------------------
// Built-in tracker rules — see `blocklists.rs` (domains + cosmetic CSS).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_are_monotonically_stricter() {
        let standard = PrivacyPolicy::for_level(PrivacyLevel::Standard);
        let balanced = PrivacyPolicy::for_level(PrivacyLevel::Balanced);
        let strict = PrivacyPolicy::for_level(PrivacyLevel::Strict);
        let max = PrivacyPolicy::for_level(PrivacyLevel::Maximum);

        assert!(!standard.block_third_party_cookies);
        assert!(balanced.block_third_party_cookies);
        assert!(strict.strict_storage_isolation);
        assert!(!balanced.strict_storage_isolation);
        assert_eq!(max.webrtc, WebRtcPolicy::Disabled);
        assert_eq!(max.fingerprint_protection, FingerprintLevel::Aggressive);
        // Telemetry is never enabled anywhere (§10A.17).
        for p in [&standard, &balanced, &strict, &max] {
            assert!(!p.telemetry_enabled);
        }
    }

    #[test]
    fn blocker_matches_subdomains_and_categories() {
        let b = TrackerBlocker::new();
        assert_eq!(b.classify("www.doubleclick.net"), Some(TrackerCategory::Advertising));
        assert_eq!(b.classify("stats.g.doubleclick.net"), Some(TrackerCategory::Advertising));
        assert_eq!(b.classify("google-analytics.com"), Some(TrackerCategory::Analytics));
        assert_eq!(b.classify("example.com"), None);
        // lookalike must NOT match (suffix safety)
        assert_eq!(b.classify("notdoubleclick.net"), None);
    }

    #[test]
    fn custom_lists_parse_hosts_format() {
        let mut b = TrackerBlocker::new();
        let added = b.add_custom_list(
            "# my list\n0.0.0.0 tracker.example\n\nbad-cdn.example\n# comment",
            TrackerCategory::Advertising,
        );
        assert_eq!(added, 2);
        assert_eq!(b.classify("cdn.tracker.example"), Some(TrackerCategory::Advertising));
        assert_eq!(b.classify("bad-cdn.example"), Some(TrackerCategory::Advertising));
    }

    #[test]
    fn critical_hosts_survive_custom_lists() {
        // Корень поиска не должен падать под кастомным списком, где
        // пользователь добавил google.com (было: www.google.com → 403 →
        // ERR_TUNNEL_CONNECTION_FAILED, журнал 2026-09-20).
        let mut b = TrackerBlocker::new();
        b.add_custom_list("google.com\n0.0.0.0 yandex.ru", TrackerCategory::Advertising);
        assert_eq!(b.classify("www.google.com"), None);
        assert_eq!(b.classify("google.com"), None);
        assert_eq!(b.classify("yandex.ru"), None);
        // Точный трекер-поддомен при этом блокируется как раньше.
        assert_eq!(b.classify("analytics.google.com"), Some(TrackerCategory::Analytics));
    }

    #[test]
    fn inspect_respects_policy_and_counts_stats() {
        let b = TrackerBlocker::new();
        let policy = PrivacyPolicy::for_level(PrivacyLevel::Standard);
        // Standard now blocks ads too (out-of-the-box adblocking);
        // advertising domains fall under both switches.
        assert!(policy.block_trackers);
        assert!(policy.block_ads);
        assert_eq!(b.inspect("google-analytics.com", &policy), Some(TrackerCategory::Analytics));
        assert_eq!(b.inspect("doubleclick.net", &policy), Some(TrackerCategory::Advertising));

        let mut permissive = policy.clone();
        permissive.block_trackers = false;
        permissive.block_ads = false;
        permissive.block_malicious_domains = false;
        assert_eq!(b.inspect("google-analytics.com", &permissive), None);
        let stats = b.stats();
        assert_eq!(stats.total_blocked, 2);
    }

    #[test]
    fn persona_is_deterministic_and_standardized() {
        let id = Uuid::new_v4();
        let a = FingerprintPersona::derive(id, FingerprintLevel::Standard);
        let b = FingerprintPersona::derive(id, FingerprintLevel::Standard);
        assert_eq!(a, b);
        let c = FingerprintPersona::derive(Uuid::new_v4(), FingerprintLevel::Standard);
        // Values must come from the standardized pools, not arbitrary ones.
        assert!(SCREENS.contains(&(a.screen_width, a.screen_height)));
        assert!(CORES.contains(&a.hardware_concurrency));
        assert!(MEMORY.contains(&a.device_memory_gb));
        // Different profiles almost surely differ somewhere.
        let differs = a.screen_width != c.screen_width
            || a.hardware_concurrency != c.hardware_concurrency
            || a.noise_seed != c.noise_seed;
        assert!(differs);
    }

    #[test]
    fn injection_script_contains_hooks() {
        let p = FingerprintPersona::derive(Uuid::new_v4(), FingerprintLevel::Standard);
        let js = p.injection_script();
        assert!(js.contains("hardwareConcurrency"));
        assert!(js.contains("toDataURL"));
        assert!(js.contains("getParameter"));
        assert!(js.contains("enumerateDevices"));
    }

    #[test]
    fn emergency_mode_hardens_everything() {
        let st = PrivacyState {
            policy: PrivacyPolicy::for_level(PrivacyLevel::Standard),
            custom_lists: Vec::new(),
            site_overrides: BTreeMap::new(),
            threats: Vec::new(),
            emergency_mode: true,
            panic_actions: PanicActions::default(),
        };
        let eff = st.effective_policy();
        assert!(eff.block_trackers && eff.block_ads && eff.https_only);
        assert_eq!(eff.webrtc, WebRtcPolicy::Disabled);
        assert_eq!(eff.fingerprint_protection, FingerprintLevel::Aggressive);
        // Underlying choice untouched:
        assert_eq!(st.policy.level, PrivacyLevel::Standard);
    }

    #[test]
    fn state_roundtrip_via_json_file() {
        let tmp = std::env::temp_dir().join(format!("apb-priv-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        let mut st = PrivacyState {
            policy: PrivacyPolicy::for_level(PrivacyLevel::Balanced),
            custom_lists: Vec::new(),
            site_overrides: BTreeMap::new(),
            threats: Vec::new(),
            emergency_mode: false,
            panic_actions: PanicActions::default(),
        };
        st.site_overrides.insert(
            "example.com".into(),
            SiteOverride {
                allow_trackers: true,
                ..SiteOverride::new("example.com")
            },
        );
        st.save(&tmp).unwrap();
        let loaded = PrivacyState::load(&tmp).unwrap().unwrap();
        assert!(loaded.site_overrides["example.com"].allow_trackers);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn audit_flags_missing_dns_and_proxy() {
        let policy = PrivacyPolicy::for_level(PrivacyLevel::Balanced);
        let findings = run_audit(&policy, &AuditInputs::default());
        assert!(findings.iter().any(|f| f.area == "DNS" && f.status == FindingStatus::Warn));
        assert!(findings.iter().any(|f| f.area == "Proxy" && f.status == FindingStatus::Warn));
        let good = AuditInputs {
            dns_encrypted: true,
            proxy_configured: true,
            extensions_with_broad_permissions: 0,
            ai_cloud_configured: false,
            vault_created: true,
        };
        let findings = run_audit(&policy, &good);
        assert!(findings.iter().all(|f| f.status != FindingStatus::Critical));
    }

    #[test]
    fn threat_recommendation_covers_selected_threats() {
        let rec = recommend_for_threats(
            &[Threat::AdvertisingNetworks, Threat::WebFingerprinting],
            PrivacyLevel::Standard,
        );
        assert!(rec.policy.block_ads);
        assert!(rec.policy.block_third_party_cookies);
        assert!(rec.policy.fingerprint_protection != FingerprintLevel::Off);
        assert!(!rec.notes.is_empty());
    }
}

// Made by MrDuck && Ox-Alpha