// Made by MrDuck
//! Auto-update engine.
//!
//! Flow: GitHub Releases hosts `latest.json` (asset of the newest release).
//! `update_check` fetches it, compares semver against the running binary and
//! reports back to the shell (version / notes / mandatory / artifact URL /
//! minisign signature). `update_install` downloads the NSIS `-setup.exe`,
//! verifies it against the embedded PUBLIC key (rejects anything unsigned or
//! tampered), then launches the installer silently (/S) with auto-restart (/R).
//!
//! The private signing key lives ONLY in the repo secret
//! TAURI_SIGNING_PRIVATE_KEY (+ empty password secret) and locally under
//! `G:\APB AI\apb-keys\` (never committed).

use minisign_verify::{PublicKey, Signature};
use serde::Serialize;
use std::io::{Read, Write};
use std::time::Duration;

/// Stable URL: GitHub redirects this to the newest release's latest.json.
const UPDATE_ENDPOINT: &str =
    "https://github.com/McDakcode/ApostolProject-Browser/releases/latest/download/latest.json";

/// Minisign PUBLIC key (safe to embed). Private counterpart never ships.
const UPDATE_PUBKEY: &str = "RWQgE7w6AwqbffMpTOODFv0vNHTSn/qtn3eHyZBE7PKuefNZMu5ZSA8S";

fn endpoint() -> String {
    std::env::var("APB_UPDATE_ENDPOINT").unwrap_or_else(|_| UPDATE_ENDPOINT.to_string())
}

/// "1.2.10" -> (1,2,10); missing parts are 0; non-numeric junk tolerated.
fn vtuple(v: &str) -> (u64, u64, u64) {
    let mut it = v.split('.').map(|p| {
        p.chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse::<u64>()
            .unwrap_or(0)
    });
    let a = it.next().unwrap_or(0);
    let b = it.next().unwrap_or(0);
    let c = it.next().unwrap_or(0);
    (a, b, c)
}

fn is_newer(candidate: &str, current: &str) -> bool {
    vtuple(candidate) > vtuple(current)
}

async fn fetch_latest() -> Result<serde_json::Value, String> {
    // Blocking IO inside an async command = worker thread (project rule).
    let resp = ureq::get(&endpoint())
        .timeout(Duration::from_secs(30))
        .call()
        .map_err(|e| format!("Не удалось связаться с сервером обновлений: {e}"))?;
    resp.into_json::<serde_json::Value>()
        .map_err(|e| format!("Битый манифест обновлений: {e}"))
}

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[derive(Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub mandatory: bool,
    pub url: Option<String>,
    pub signature: Option<String>,
    pub pub_date: Option<String>,
}

#[tauri::command]
pub async fn update_check() -> Result<UpdateInfo, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let latest = fetch_latest().await?;

    let version = latest
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let plat = latest.pointer("/platforms/windows-x86_64");

    let (url, signature) = match plat {
        Some(p) => (
            p.get("url").and_then(|v| v.as_str()).map(String::from),
            p.get("signature").and_then(|v| v.as_str()).map(String::from),
        ),
        None => (None, None),
    };

    let available = !version.is_empty()
        && is_newer(&version, &current_version)
        && url.is_some()
        && signature.is_some();

    Ok(UpdateInfo {
        available,
        current_version,
        version: if version.is_empty() { None } else { Some(version) },
        notes: latest
            .get("notes")
            .and_then(|v| v.as_str())
            .map(String::from),
        mandatory: latest
            .get("mandatory")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        url,
        signature,
        pub_date: latest
            .get("pub_date")
            .and_then(|v| v.as_str())
            .map(String::from),
    })
}

#[tauri::command]
pub async fn update_install(url: String, signature: String) -> Result<(), String> {
    // --- download to temp -------------------------------------------------
    let tmp = std::env::temp_dir().join("apb-update-setup.exe");
    let mut reader = ureq::get(&url)
        .timeout(Duration::from_secs(1800))
        .call()
        .map_err(|e| format!("Ошибка скачивания: {e}"))?
        .into_reader();

    let mut file = std::fs::File::create(&tmp)
        .map_err(|e| format!("Не удалось создать временный файл: {e}"))?;
    let mut buf = [0u8; 65536];
    let mut total: u64 = 0;
    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("Обрыв при скачивании: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("Ошибка записи: {e}"))?;
        total += n as u64;
    }
    file.flush()
        .ok();
    drop(file);

    if total < 1024 {
        std::fs::remove_file(&tmp).ok();
        return Err("Файл обновления слишком мал — похоже, ссылка битая".into());
    }

    // --- verify minisign signature BEFORE executing anything --------------
    let data = std::fs::read(&tmp).map_err(|e| e.to_string())?;
    let pk =
        PublicKey::from_base64(UPDATE_PUBKEY).map_err(|e| format!("Публичный ключ: {e}"))?;
    let sig = Signature::decode(&signature).map_err(|e| format!("Подпись в манифесте: {e}"))?;
    // false = строгое правило подписи v2 (не принимать легаси-чек-суммы)
    pk.verify(&data, &sig, false)
        .map_err(|_| "Подпись обновления НЕ сошлась — установка отменена".to_string())?;
    drop(data);

    // --- launch silent installer (NSIS /S), auto-restart app (/R) ---------
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new(&tmp)
        .args(["/S", "/R"])
        .creation_flags(DETACHED_PROCESS | CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| format!("Не удалось запустить установщик: {e}"))?;

    Ok(())
}

// Made by MrDuck
