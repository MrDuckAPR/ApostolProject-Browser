// Made by MrDuck
#![allow(unused_imports)]

use crate::state::{AppState, SharedState};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub(crate) fn workspaces_get(state: tauri::State<'_, SharedState>) -> Result<serde_json::Value, String> {
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let path = guard.profiles.storage_root(active.profile.id).join("workspaces.json");
    // Воркспейс всегда должен быть хотя бы один: битый/пустой файл =
    // дефолтный документ «Основное» (иначе пилюли воркспейсов пропадают).
    let default_doc = || {
        serde_json::json!({
            "current": 0,
            "list": [ { "id": 0, "name": "Основное", "tabs": [], "active": 0 } ]
        })
    };
    Ok(std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .filter(|doc: &serde_json::Value| {
            doc.get("list").and_then(|l| l.as_array()).map(|a| !a.is_empty()).unwrap_or(false)
        })
        .unwrap_or_else(default_doc))
}

/// Fetch a page server-side and return readable text for the AI context.
/// (WebView2 eval cannot return values across origins, so we fetch
/// ourselves; JS-rendered SPAs will yield limited text — honest boundary.)
#[tauri::command]

pub(crate) fn workspaces_set(state: tauri::State<'_, SharedState>, data: serde_json::Value) -> Result<(), String> {
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let root = guard.profiles.storage_root(active.profile.id);
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    std::fs::write(
        root.join("workspaces.json"),
        serde_json::to_string(&data).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

// Made by MrDuck