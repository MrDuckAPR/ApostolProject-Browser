// Made by MrDuck
//! Crash-safe session journal with validation and automatic fallback.

use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::Manager;

use crate::state::SharedState;

const MAX_TABS: usize = 200;
const MAX_URL: usize = 16_384;
const MAX_FILE: usize = 4 * 1024 * 1024;

fn valid_session(value: &serde_json::Value) -> bool {
    let Some(tabs) = value.get("tabs").and_then(|v| v.as_array()) else { return false };
    if tabs.len() > MAX_TABS { return false; }
    tabs.iter().all(|tab| {
        let Some(obj) = tab.as_object() else { return false };
        let Some(url) = obj.get("url").and_then(|v| v.as_str()) else { return false };
        url.len() <= MAX_URL && (url.starts_with("http://") || url.starts_with("https://"))
    })
}

fn default_session() -> serde_json::Value {
    serde_json::json!({ "tabs": [], "active": 0, "recovered": false })
}

fn read_valid(path: &Path) -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(path).ok()?;
    if text.len() > MAX_FILE { return None; }
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    valid_session(&value).then_some(value)
}

fn atomic_write(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    {
        let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn paths(root: &Path) -> (PathBuf, PathBuf) {
    (root.join("session.json"), root.join("session.prev.json"))
}

#[tauri::command]
pub(crate) fn session_get(
    state: tauri::State<'_, SharedState>,
) -> Result<serde_json::Value, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let active = guard.active_or_err()?;
    let root = guard.profiles.storage_root(active.profile.id);
    let (current, previous) = paths(&root);
    if let Some(mut value) = read_valid(&current) {
        value["recovered"] = serde_json::Value::Bool(false);
        return Ok(value);
    }
    if current.exists() {
        let damaged = root.join(format!("session.damaged-{}.json", chrono::Utc::now().format("%Y%m%d-%H%M%S")));
        let _ = std::fs::rename(&current, damaged);
    }
    if let Some(mut value) = read_valid(&previous) {
        value["recovered"] = serde_json::Value::Bool(true);
        let _ = atomic_write(&current, &value);
        return Ok(value);
    }
    Ok(default_session())
}

/// РЎС‚Р°С‚РёСЃС‚РёРєР° РґР»СЏ РІРёРґР¶РµС‚Р° В«РўРµРєСѓС‰Р°СЏ СЃРµСЃСЃРёСЏВ» (index.html:466-468):
/// Р°РїС‚Р°Р№Рј СЃРµСЃСЃРёРё, С‡РёСЃР»Рѕ РѕС‚РєСЂС‹С‚С‹С… РІРєР»Р°РґРѕРє, С‡РёСЃР»Рѕ Р»РѕРіРёС‡РµСЃРєРёС… СЏРґРµСЂ,
/// СЂР°Р±РѕС‡РёР№ РЅР°Р±РѕСЂ РїСЂРѕС†РµСЃСЃР° РІ РњР‘. РћРґРёРЅ invoke вЂ” РІСЃС‘, С‡С‚Рѕ РЅСѓР¶РЅРѕ РґРѕРјСѓ.
#[tauri::command]
pub(crate) fn session_stats(
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    let working_set_mb = crate::features::maintenance::process_working_set() / (1024 * 1024);
    let tab_count = {
        let tabs = app.state::<crate::webviews::PageTabs>();
        let guard = tabs.tabs.lock().map_err(|e| e.to_string())?;
        guard.len()
    };
    let session_seconds: i64 = {
        let state = app.state::<crate::state::SharedState>();
        let guard = state.lock().map_err(|e| e.to_string())?;
        let Ok(active) = guard.active_or_err() else {
            return Ok(serde_json::json!({
                "session_seconds": 0,
                "tabs": tab_count,
                "cores": cores,
                "working_set_mb": working_set_mb,
            }));
        };
        let root = guard.profiles.storage_root(active.profile.id);
        drop(guard);
        let saved_at = std::fs::read_to_string(&root.join("session.json")).ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v.get("saved_at").and_then(|v| v.as_str()).map(String::from));
        match saved_at.and_then(|s| s.parse::<chrono::DateTime<chrono::Utc>>().ok()) {
            Some(t) => (chrono::Utc::now() - t).num_seconds().max(0),
            None => 0,
        }
    };
    Ok(serde_json::json!({
        "session_seconds": session_seconds,
        "tabs": tab_count,
        "cores": cores,
        "working_set_mb": working_set_mb,
    }))
}

#[tauri::command]
pub(crate) fn session_save(
    state: tauri::State<'_, SharedState>,
    mut session: serde_json::Value,
) -> Result<(), String> {
    if !valid_session(&session) { return Err("РЅРµРєРѕСЂСЂРµРєС‚РЅРѕРµ СЃРѕСЃС‚РѕСЏРЅРёРµ СЃРµСЃСЃРёРё".into()); }
    let guard = state.lock().map_err(|e| e.to_string())?;
    let active = guard.active_or_err()?;
    let root = guard.profiles.storage_root(active.profile.id);
    let (current, previous) = paths(&root);
    if let Some(old) = read_valid(&current) { atomic_write(&previous, &old)?; }
    session["saved_at"] = serde_json::Value::String(chrono::Utc::now().to_rfc3339());
    session["recovered"] = serde_json::Value::Bool(false);
    atomic_write(&current, &session)
}

