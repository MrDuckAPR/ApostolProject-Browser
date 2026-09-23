// Made by MrDuck && Ox-Alpha
//! apb-vault
//!
//! Secure Vault (design doc §11, §10A.24): passwords, secure notes, credit
//! cards, API keys and TOTP secrets — encrypted at rest with AES-256-GCM,
//! key derived from the user's passphrase with Argon2id.
//!
//! Threat model honesty: the vault protects data *at rest* on disk. While
//! unlocked, entries live in process memory like in any password manager;
//! web content and extensions have no path to this crate (enforced by the
//! command layer — no Tauri command exposes raw entry contents without an
//! explicit reveal call), and AI never receives vault data (§10A.19/§20).

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use uuid::Uuid;
use zeroize::Zeroize;

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("vault is locked")]
    Locked,
    #[error("wrong passphrase or corrupted vault")]
    AuthFailed,
    #[error("vault already initialized")]
    AlreadyInitialized,
    #[error("entry not found: {0}")]
    NotFound(Uuid),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("crypto error: {0}")]
    Crypto(String),
}

pub type Result<T> = std::result::Result<T, VaultError>;

// ---------------------------------------------------------------------------
// Entry model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EntryKind {
    Password {
        title: String,
        username: String,
        password: String,
        url: Option<String>,
        totp_secret: Option<String>,
    },
    SecureNote {
        title: String,
        body: String,
    },
    CreditCard {
        title: String,
        holder: String,
        number: String,
        exp_month: u8,
        exp_year: u16,
        cvv: String,
    },
    ApiKey {
        title: String,
        key: String,
        service: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: Uuid,
    pub created_at: chrono::DateTime<chrono::Utc>,
    #[serde(flatten)]
    pub kind: EntryKind,
}

impl Entry {
    pub fn title(&self) -> &str {
        match &self.kind {
            EntryKind::Password { title, .. }
            | EntryKind::SecureNote { title, .. }
            | EntryKind::CreditCard { title, .. }
            | EntryKind::ApiKey { title, .. } => title,
        }
    }

    /// Short safe summary for list views — never includes secret material.
    pub fn summary(&self) -> String {
        match &self.kind {
            EntryKind::Password { username, url, .. } => {
                format!("Пароль · {}{}", username, url.as_ref().map(|u| format!(" · {u}")).unwrap_or_default())
            }
            EntryKind::SecureNote { .. } => "Заметка".into(),
            EntryKind::CreditCard { number, .. } => {
                let tail: String = number.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
                format!("Карта · ····{tail}")
            }
            EntryKind::ApiKey { service, .. } => {
                format!("API-ключ{}", service.as_ref().map(|s| format!(" · {s}")).unwrap_or_default())
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Encrypted envelope
// ---------------------------------------------------------------------------

/// On-disk format. `verifier` is AES-GCM encryption of the fixed string
/// "apb-vault-ok" under the derived key — a cheap correct-password check
/// that never stores the passphrase or its hash in plaintext form.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct VaultEnvelope {
    version: u32,
    kdf_salt_b64: String,
    argon_m_kib: u32,
    argon_t: u32,
    argon_p: u32,
    verifier_b64: String,
    payload_b64: String,
}

const VERIFIER_PLAINTEXT: &[u8] = b"apb-vault-ok";
const ENVELOPE_VERSION: u32 = 2;

fn b64(data: &[u8]) -> String {
    // Standard base64 without external crates (small alphabet table).
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

fn unb64(s: &str) -> Result<Vec<u8>> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a') as u32 + 26),
            b'0'..=b'9' => Some((c - b'0') as u32 + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let bytes: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace() && *b != b'=').collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        if chunk.len() < 2 {
            return Err(VaultError::Crypto("bad base64".into()));
        }
        let mut n: u32 = 0;
        for (i, c) in chunk.iter().enumerate() {
            n |= val(*c).ok_or_else(|| VaultError::Crypto("bad base64 char".into()))? << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(n as u8);
        }
    }
    Ok(out)
}

fn random_bytes(n: usize) -> Result<Vec<u8>> {
    let mut buf = vec![0u8; n];
    getrandom::getrandom(&mut buf).map_err(|e| VaultError::Crypto(e.to_string()))?;
    Ok(buf)
}

fn validate_kdf(salt: &[u8], m_kib: u32, t: u32, p: u32) -> Result<()> {
    if salt.len() < 16 || !(19_456..=262_144).contains(&m_kib) || !(1..=10).contains(&t) || !(1..=8).contains(&p) {
        return Err(VaultError::Crypto("invalid or unsafe Argon2 parameters".into()));
    }
    Ok(())
}

fn derive_key(passphrase: &str, salt: &[u8], m_kib: u32, t: u32, p: u32) -> [u8; 32] {
    use argon2::Algorithm;
    use argon2::Params;
    use argon2::Version;
    let params =
        Params::new(m_kib, t, p, Some(32)).expect("argon2 params are statically valid");
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon.hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .expect("argon2 hashing into sized buffer cannot fail");
    key
}

// Made by MrDuck && Ox-Alpha
fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| VaultError::Crypto(e.to_string()))?;
    let nonce_bytes = random_bytes(12)?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, Payload { msg: plaintext, aad: b"apb-vault" })
        .map_err(|_| VaultError::Crypto("encrypt failed".into()))?;
    let mut out = nonce_bytes;
    out.extend_from_slice(&ct);
    Ok(out)
}

fn decrypt(key: &[u8; 32], blob: &[u8]) -> Result<Vec<u8>> {
    if blob.len() < 13 {
        return Err(VaultError::AuthFailed);
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| VaultError::Crypto(e.to_string()))?;
    let (nonce, ct) = blob.split_at(12);
    cipher
        .decrypt(Nonce::from_slice(nonce), Payload { msg: ct, aad: b"apb-vault" })
        .map_err(|_| VaultError::AuthFailed)
}

// ---------------------------------------------------------------------------
// Password generator
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
pub struct GeneratorOptions {
    pub length: usize,
    pub lower: bool,
    pub upper: bool,
    pub digits: bool,
    pub symbols: bool,
    /// Exclude visually ambiguous characters (l I 1 O 0).
    pub avoid_ambiguous: bool,
}

impl Default for GeneratorOptions {
    fn default() -> Self {
        Self { length: 20, lower: true, upper: true, digits: true, symbols: true, avoid_ambiguous: true }
    }
}

pub fn generate_password(opts: GeneratorOptions) -> Result<String> {
    const LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";
    const UPPER: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const DIGITS: &[u8] = b"0123456789";
    const SYMBOLS: &[u8] = b"!@#$%^&*-_=+?";
    const AMBIGUOUS: &[u8] = b"lI1O0";

    let mut pool: Vec<u8> = Vec::new();
    let mut required: Vec<Vec<u8>> = Vec::new();
    let add = |pool: &mut Vec<u8>, req: &mut Vec<Vec<u8>>, set: &[u8], on: bool| {
        if !on {
            return;
        }
        let filtered: Vec<u8> = set
            .iter()
            .filter(|c| !(opts.avoid_ambiguous && AMBIGUOUS.contains(c)))
            .copied()
            .collect();
        if filtered.is_empty() {
            return;
        }
        pool.extend_from_slice(&filtered);
        req.push(filtered);
    };
    add(&mut pool, &mut required, LOWER, opts.lower);
    add(&mut pool, &mut required, UPPER, opts.upper);
    add(&mut pool, &mut required, DIGITS, opts.digits);
    add(&mut pool, &mut required, SYMBOLS, opts.symbols);

    if pool.is_empty() || opts.length == 0 {
        return Err(VaultError::Crypto("generator: empty character set".into()));
    }
    if required.len() > opts.length {
        return Err(VaultError::Crypto("generator: length too small for classes".into()));
    }

    let rand_index = |max: usize| -> Result<usize> {
        let bytes = random_bytes(4)?;
        let n = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        Ok((n % max as u32) as usize)
    };

    let mut chars: Vec<u8> = Vec::with_capacity(opts.length);
    for set in &required {
        chars.push(set[rand_index(set.len())?]);
    }
    while chars.len() < opts.length {
        chars.push(pool[rand_index(pool.len())?]);
    }
    // Fisher-Yates shuffle with CSPRNG.
    for i in (1..chars.len()).rev() {
        let j = rand_index(i + 1)?;
        chars.swap(i, j);
    }
    Ok(String::from_utf8(chars).map_err(|_| VaultError::Crypto("utf8".into()))?)
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238, SHA-1, 6 digits — compatible with Google Authenticator)
// ---------------------------------------------------------------------------

const BASE32_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

pub fn generate_totp_secret(byte_len: usize) -> String {
    let bytes = random_bytes(byte_len).unwrap_or_else(|_| vec![0u8; byte_len]);
    let mut out = String::new();
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for b in bytes {
        buffer = (buffer << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(BASE32_ALPHABET[((buffer >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(BASE32_ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    out
}

fn base32_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for c in s.chars() {
        if c == '=' || c.is_whitespace() {
            continue;
        }
        let v = BASE32_ALPHABET
            .iter()
            .position(|a| (*a as char) == c.to_ascii_uppercase())? as u32;
        buffer = (buffer << 5) | v;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xFF) as u8);
        }
    }
    Some(out)
}

pub fn totp_now(secret_base32: &str, at_seconds: u64) -> Result<String> {
    let secret = base32_decode(secret_base32).ok_or_else(|| VaultError::Crypto("bad base32".into()))?;
    let counter = at_seconds / 30;
    let msg = counter.to_be_bytes();

    let mut mac = <Hmac<Sha1> as hmac::Mac>::new_from_slice(&secret)
        .map_err(|e| VaultError::Crypto(e.to_string()))?;
    mac.update(&msg);
    let digest = mac.finalize().into_bytes();
    let offset = (digest[19] & 0x0F) as usize;
    let code = u32::from_be_bytes([
        digest[offset] & 0x7F,
        digest[offset + 1],
        digest[offset + 2],
        digest[offset + 3],
    ]) % 1_000_000;
    Ok(format!("{code:06}"))
}

// ---------------------------------------------------------------------------
// The vault itself
// ---------------------------------------------------------------------------

/// Auto-lock policy: lock after N seconds of inactivity. Zero disables.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AutoLock {
    pub after_secs: u64,
}

impl Default for AutoLock {
    fn default() -> Self {
        Self { after_secs: 300 }
    }
}

enum LockState {
    Locked,
    Unlocked { key: Box<[u8; 32]>, last_activity: Instant },
}

/// A vault file on disk, not yet unlocked. `unlock` verifies the passphrase
/// against the verifier and returns an operational `Vault`.
pub struct VaultFile {
    path: PathBuf,
    envelope: VaultEnvelope,
}

// Made by MrDuck && Ox-Alpha
impl VaultFile {
    pub fn unlock(self, passphrase: &str) -> Result<Vault> {
        let salt = unb64(&self.envelope.kdf_salt_b64)?;
        if !matches!(self.envelope.version, 1 | ENVELOPE_VERSION) { return Err(VaultError::Crypto("unsupported vault version".into())); }
        validate_kdf(&salt, self.envelope.argon_m_kib, self.envelope.argon_t, self.envelope.argon_p)?;
        let key = derive_key(
            passphrase,
            &salt,
            self.envelope.argon_m_kib,
            self.envelope.argon_t,
            self.envelope.argon_p,
        );
        let verifier = unb64(&self.envelope.verifier_b64)?;
        if decrypt(&key, &verifier)? != VERIFIER_PLAINTEXT { return Err(VaultError::AuthFailed); }
        let payload = if self.envelope.payload_b64.is_empty() {
            Vec::new()
        } else {
            decrypt(&key, &unb64(&self.envelope.payload_b64)?)?
        };
        Ok(Vault {
            path: self.path,
            envelope: self.envelope,
            state: LockState::Unlocked { key: Box::new(key), last_activity: Instant::now() },
            auto_lock: AutoLock::default(),
            entries_cache: if payload.is_empty() {
                Vec::new()
            } else {
                serde_json::from_slice(&payload)?
            },
        })
    }
}

pub struct Vault {
    path: PathBuf,
    envelope: VaultEnvelope,
    state: LockState,
    auto_lock: AutoLock,
    entries_cache: Vec<Entry>,
}

impl Vault {
    /// Open an existing vault file, or report that none exists yet.
    pub fn open(path: impl AsRef<Path>) -> Result<Option<VaultFile>> {
        let path = path.as_ref().to_path_buf();
        if !path.exists() {
            return Ok(None);
        }
        let envelope: VaultEnvelope = serde_json::from_str(&std::fs::read_to_string(&path)?)?;
        Ok(Some(VaultFile { path, envelope }))
    }

    /// Create a brand-new encrypted vault at `path`.
    pub fn create(path: impl AsRef<Path>, passphrase: &str) -> Result<Vault> {
        let path = path.as_ref().to_path_buf();
        if path.exists() {
            return Err(VaultError::AlreadyInitialized);
        }
        if passphrase.chars().count() < 8 {
            return Err(VaultError::Crypto("passphrase слишком короткий (минимум 8 символов)".into()));
        }
        let salt = random_bytes(16)?;
        let envelope = VaultEnvelope {
            version: ENVELOPE_VERSION,
            kdf_salt_b64: b64(&salt),
            argon_m_kib: 65_536, // 64 MiB; interactive desktop baseline
            argon_t: 3,
            argon_p: 1,
            verifier_b64: String::new(),
            payload_b64: String::new(),
        };
        let key = derive_key(passphrase, &salt, envelope.argon_m_kib, envelope.argon_t, envelope.argon_p);
        let verifier = encrypt(&key, VERIFIER_PLAINTEXT)?;

        let mut vault = Self {
            path,
            envelope,
            state: LockState::Unlocked { key: Box::new(key), last_activity: Instant::now() },
            auto_lock: AutoLock::default(),
            entries_cache: Vec::new(),
        };
        vault.envelope.verifier_b64 = b64(&verifier);
        vault.persist_envelope()?;
        Ok(vault)
    }

    fn touch(&mut self) {
        if let LockState::Unlocked { last_activity, .. } = &mut self.state {
            *last_activity = Instant::now();
        }
    }

    pub fn is_locked(&self) -> bool {
        match &self.state {
            LockState::Locked => true,
            LockState::Unlocked { last_activity, .. } => {
                self.auto_lock.after_secs > 0
                    && last_activity.elapsed() >= Duration::from_secs(self.auto_lock.after_secs)
            }
        }
    }

    pub fn lock(&mut self) {
        if let LockState::Unlocked { key, .. } = &mut self.state { key.zeroize(); }
        self.state = LockState::Locked;
        self.entries_cache.clear();
    }

    /// Records explicit trusted UI activity; web content cannot call this.
    pub fn touch_activity(&mut self) -> Result<()> {
        if self.is_locked() { self.lock(); return Err(VaultError::Locked); }
        self.touch();
        Ok(())
    }

    pub fn auto_lock_secs(&self) -> u64 { self.auto_lock.after_secs }


    pub fn unlock_existing(&mut self, passphrase: &str) -> Result<()> {
        let salt = unb64(&self.envelope.kdf_salt_b64)?;
        if !matches!(self.envelope.version, 1 | ENVELOPE_VERSION) { return Err(VaultError::Crypto("unsupported vault version".into())); }
        validate_kdf(&salt, self.envelope.argon_m_kib, self.envelope.argon_t, self.envelope.argon_p)?;
        let key = derive_key(
            passphrase,
            &salt,
            self.envelope.argon_m_kib,
            self.envelope.argon_t,
            self.envelope.argon_p,
        );
        let verifier = unb64(&self.envelope.verifier_b64)?;
        if decrypt(&key, &verifier)? != VERIFIER_PLAINTEXT { return Err(VaultError::AuthFailed); }
        let payload = if self.envelope.payload_b64.is_empty() {
            Vec::new()
        } else {
            decrypt(&key, &unb64(&self.envelope.payload_b64)?)?
        };
        self.entries_cache = if payload.is_empty() {
            Vec::new()
        } else {
            serde_json::from_slice(&payload)?
        };
        self.state = LockState::Unlocked { key: Box::new(key), last_activity: Instant::now() };
        Ok(())
    }

    fn persist_envelope(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(&self.envelope)?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, json)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    fn persist_entries(&mut self) -> Result<()> {
        let key: [u8; 32] = match &self.state {
            LockState::Unlocked { key, .. } => **key,
            LockState::Locked => return Err(VaultError::Locked),
        };
        let payload = serde_json::to_vec(&self.entries_cache)?;
        let blob = encrypt(&key, &payload)?;
        self.envelope.payload_b64 = b64(&blob);
        self.persist_envelope()?;
        Ok(())
    }

    pub fn add_entry(&mut self, kind: EntryKind) -> Result<Entry> {
        if self.is_locked() {
            return Err(VaultError::Locked);
        }
        let entry = Entry { id: Uuid::new_v4(), created_at: chrono::Utc::now(), kind };
        self.entries_cache.push(entry.clone());
        self.persist_entries()?;
        self.touch();
        Ok(entry)
    }

    pub fn delete_entry(&mut self, id: Uuid) -> Result<()> {
        if self.is_locked() {
            return Err(VaultError::Locked);
        }
        let before = self.entries_cache.len();
        self.entries_cache.retain(|e| e.id != id);
        if self.entries_cache.len() == before {
            return Err(VaultError::NotFound(id));
        }
        self.persist_entries()?;
        self.touch();
        Ok(())
    }

    /// Metadata-only listing (safe summaries, no secrets).
    pub fn list_summaries(&mut self) -> Result<Vec<(Uuid, String, String)>> {
        if self.is_locked() {
            return Err(VaultError::Locked);
        }
        Ok(self
            .entries_cache
            .iter()
            .map(|e| (e.id, e.title().to_string(), e.summary()))
            .collect())
    }

    /// Returns a clone for an explicit local vault-to-vault import. This API
    /// stays inside the Rust backend and is never exposed directly to pages.
    pub fn entries_for_import(&mut self) -> Result<Vec<Entry>> {
        if self.is_locked() { return Err(VaultError::Locked); }
        self.touch();
        Ok(self.entries_cache.clone())
    }

    /// Full entry content — only through explicit user action in the UI.
// Made by MrDuck && Ox-Alpha
    pub fn reveal_entry(&mut self, id: Uuid) -> Result<Entry> {
        if self.is_locked() {
            return Err(VaultError::Locked);
        }
        let found = self.entries_cache
            .iter()
            .find(|e| e.id == id)
            .cloned()
            .ok_or(VaultError::NotFound(id));
        if found.is_ok() { self.touch(); }
        found
    }

    /// Live TOTP code for an entry with a `totp_secret`.
    pub fn totp_code_for(&mut self, id: Uuid) -> Result<String> {
        let entry = self.reveal_entry(id)?;
        match entry.kind {
            EntryKind::Password { totp_secret: Some(secret), .. } => {
                totp_now(&secret, chrono::Utc::now().timestamp().max(0) as u64)
            }
            _ => Err(VaultError::NotFound(id)),
        }
    }

    pub fn set_auto_lock(&mut self, after_secs: u64) {
        self.auto_lock.after_secs = after_secs;
    }

    /// Export = copy of the encrypted envelope. Useless without the
    /// passphrase — safe to store anywhere.
    pub fn export_encrypted(&self, dest: impl AsRef<Path>) -> Result<()> {
        std::fs::copy(&self.path, dest.as_ref())?;
        Ok(())
    }

    /// Import merges another vault's entries into this one (the other file
    /// is unlocked by its own passphrase first).
    pub fn import_merge(&mut self, other_path: impl AsRef<Path>, other_passphrase: &str) -> Result<usize> {
        if self.is_locked() {
            return Err(VaultError::Locked);
        }
        let other_file = Vault::open(other_path)?.ok_or(VaultError::NotFound(Uuid::nil()))?;
        let mut other_vault = other_file.unlock(other_passphrase)?;
        let imported = other_vault.entries_cache.len();
        self.entries_cache.append(&mut other_vault.entries_cache);
        self.persist_entries()?;
        Ok(imported)
    }
}

// ---------------------------------------------------------------------------
// Portable encrypted container (profile sync/backups; no cloud involved)
// ---------------------------------------------------------------------------
#[derive(Debug, Serialize, Deserialize)]
struct PortableEnvelope {
    magic: String,
    version: u32,
    kdf: String,
    salt_b64: String,
    argon_m_kib: u32,
    argon_t: u32,
    argon_p: u32,
    payload_b64: String,
}

/// Encrypt arbitrary profile JSON with independent random salt and nonce.
pub fn encrypt_portable(plaintext: &[u8], passphrase: &str) -> Result<String> {
    if passphrase.chars().count() < 10 {
        return Err(VaultError::Crypto("фраза контейнера должна содержать минимум 10 символов".into()));
    }
    let salt=random_bytes(16)?;let m=65_536;let t=3;let p=1;
    let mut key=derive_key(passphrase,&salt,m,t,p);
    let blob=encrypt(&key,plaintext)?;key.zeroize();
    serde_json::to_string_pretty(&PortableEnvelope{
        magic:"APB-E2E-PROFILE".into(),version:1,kdf:"argon2id-v19".into(),salt_b64:b64(&salt),
        argon_m_kib:m,argon_t:t,argon_p:p,payload_b64:b64(&blob)
    }).map_err(Into::into)
}

pub fn decrypt_portable(container:&str,passphrase:&str)->Result<Vec<u8>>{
    let env:PortableEnvelope=serde_json::from_str(container)?;
    if env.magic!="APB-E2E-PROFILE"||env.version!=1||env.kdf!="argon2id-v19"{
        return Err(VaultError::Crypto("неподдерживаемый контейнер APB".into()));
    }
    if env.argon_m_kib<19_456||env.argon_m_kib>262_144||env.argon_t==0||env.argon_t>10||env.argon_p==0||env.argon_p>8{
        return Err(VaultError::Crypto("небезопасные параметры контейнера".into()));
    }
    let salt=unb64(&env.salt_b64)?;if salt.len()<16{return Err(VaultError::Crypto("короткая соль".into()))}
    let mut key=derive_key(passphrase,&salt,env.argon_m_kib,env.argon_t,env.argon_p);
    let out=decrypt(&key,&unb64(&env.payload_b64)?);key.zeroize();out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_path(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("apb-vault-{tag}-{}.json", Uuid::new_v4()))
    }

    #[test]
    fn base64_roundtrip() {
        for len in 0..40usize {
            let data = random_bytes(len).unwrap();
            let enc = b64(&data);
            assert_eq!(unb64(&enc).unwrap(), data, "len={len}");
        }
    }

    /// The desktop UI sends exactly this JSON shape via the Tauri command;
    /// it must deserialize or "add entry" silently breaks for users.
    #[test]
    fn ui_payload_shapes_deserialize() {
        let password: EntryKind = serde_json::from_str(
            r#"{"kind":"password","title":"GH","username":"octo","password":"pw123456","url":null,"totp_secret":null}"#,
        )
        .expect("password payload");
        assert!(matches!(password, EntryKind::Password { ref title, .. } if title == "GH"));

        serde_json::from_str::<EntryKind>(
            r#"{"kind":"secure_note","title":"N","body":"text"}"#,
        )
        .expect("note payload");
        serde_json::from_str::<EntryKind>(
            r#"{"kind":"credit_card","title":"C","holder":"A B","number":"4242424242424242","exp_month":12,"exp_year":2030,"cvv":"123"}"#,
        )
        .expect("card payload");
        serde_json::from_str::<EntryKind>(r#"{"kind":"api_key","title":"K","key":"abc123"}"#)
            .expect("apikey payload");
    }

    #[test]
    fn create_unlock_add_reveal_roundtrip() {
        let path = tmp_path("roundtrip");
        let mut vault = Vault::create(&path, "correct horse battery staple").unwrap();

        let entry = vault
            .add_entry(EntryKind::Password {
                title: "GitHub".into(),
                username: "octocat".into(),
                password: "hunter2-but-longer".into(),
                url: Some("https://github.com".into()),
                totp_secret: Some(generate_totp_secret(20)),
            })
            .unwrap();
        vault.add_entry(EntryKind::SecureNote { title: "Recovery codes".into(), body: "1234-5678".into() }).unwrap();

        // Summaries must not leak secrets:
        let summaries = vault.list_summaries().unwrap();
        assert_eq!(summaries.len(), 2);
        assert!(summaries.iter().all(|(_, _, s)| !s.contains("hunter2")));

        drop(vault);
        // Reopen from disk, wrong passphrase fails, right one works:
        let file = Vault::open(&path).unwrap().unwrap();
        assert!(matches!(file.unlock("wrong"), Err(VaultError::AuthFailed)));

        let file = Vault::open(&path).unwrap().unwrap();
        let mut vault = file.unlock("correct horse battery staple").unwrap();
        let revealed = vault.reveal_entry(entry.id).unwrap();
        match revealed.kind {
            EntryKind::Password { password, totp_secret, .. } => {
                assert_eq!(password, "hunter2-but-longer");
                assert!(totp_now(&totp_secret.unwrap(), 59).is_ok());
            }
            _ => panic!("wrong kind"),
        }
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn ciphertext_on_disk_never_contains_plaintext() {
        let path = tmp_path("plaintext");
        let secret = "SUPER-SECRET-PAYLOAD-42";
        let mut vault = Vault::create(&path, "pw12345678").unwrap();
        vault.add_entry(EntryKind::SecureNote { title: "s".into(), body: secret.into() }).unwrap();
        drop(vault);
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(!raw.contains(secret));
        assert!(!raw.contains("pw12345678"));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn generator_meets_class_requirements() {
        let opts = GeneratorOptions { length: 24, ..Default::default() };
        for _ in 0..50 {
            let pw = generate_password(opts).unwrap();
            assert_eq!(pw.chars().count(), 24);
            assert!(pw.chars().any(|c| c.is_ascii_lowercase()));
            assert!(pw.chars().any(|c| c.is_ascii_uppercase()));
            assert!(pw.chars().any(|c| c.is_ascii_digit()));
            assert!(pw.chars().any(|c| "!@#$%^&*-_=+?".contains(c)));
            assert!(!pw.chars().any(|c| "lI1O0".contains(c)));
        }
        assert!(generate_password(GeneratorOptions { length: 2, ..Default::default() }).is_err());
    }

    #[test]
    fn totp_matches_known_rfc_vectors() {
        // RFC 6238 test vector for ASCII secret "12345678901234567890"
        // (SHA-1): time 59 -> code 287082; base32 of that secret below.
        let secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
        assert_eq!(totp_now(secret, 59).unwrap(), "287082");
        assert_eq!(totp_now(secret, 1111111109).unwrap(), "081804");
    }

    #[test]
    fn delete_missing_entry_errors() {
        let path = tmp_path("delete");
        let mut vault = Vault::create(&path, "pw12345678").unwrap();
        assert!(matches!(
            vault.delete_entry(Uuid::new_v4()),
            Err(VaultError::NotFound(_))
        ));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn export_import_merge_flow() {
        let a_path = tmp_path("export-a");
        let b_path = tmp_path("export-b");
        let mut a = Vault::create(&a_path, "pass-a-123").unwrap();
        a.add_entry(EntryKind::ApiKey { title: "K1".into(), key: "sk-test-abcdef".into(), service: None }).unwrap();

        let mut b = Vault::create(&b_path, "pass-b-123").unwrap();
        b.add_entry(EntryKind::SecureNote { title: "N1".into(), body: "x".into() }).unwrap();

        // Export produces a standalone encrypted copy:
        let copy_path = tmp_path("export-copy");
        a.export_encrypted(&copy_path).unwrap();
        assert!(Vault::open(&copy_path).unwrap().is_some());

        let merged = b.import_merge(&a_path, "pass-a-123").unwrap();
        assert_eq!(merged, 1);
        assert_eq!(b.list_summaries().unwrap().len(), 2);

        std::fs::remove_file(&a_path).ok();
        std::fs::remove_file(&b_path).ok();
        std::fs::remove_file(&copy_path).ok();
    }
}

// Made by MrDuck && Ox-Alpha