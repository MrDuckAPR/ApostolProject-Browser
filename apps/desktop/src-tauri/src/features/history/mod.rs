// Made by MrDuck
#![allow(unused_imports)]

use crate::state::{AppState, SharedState};
use tauri::{AppHandle, Manager, State};

use apb_history::Visit;
#[tauri::command]
pub(crate) fn record_visit(state: tauri::State<'_, SharedState>, url: String, title: String) -> Result<(), String> {
    let guard = state.lock().unwrap();
    guard.active_or_err()?.history.record(&url, &title).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn recent_history(state: tauri::State<'_, SharedState>, limit: u32) -> Result<Vec<Visit>, String> {
    let guard = state.lock().unwrap();
    guard.active_or_err()?.history.recent(limit).map_err(|e| e.to_string())
}

/// Detailed row for the full cross-profile history view (Settings).
#[derive(serde::Serialize)]
pub(crate) struct HistoryRow {
    pub(crate) profile: String,
    pub(crate) url: String,
    pub(crate) title: String,
    pub(crate) visited_at: chrono::DateTime<chrono::Utc>,
}

#[tauri::command]
pub(crate) fn history_all_profiles(
    state: tauri::State<'_, SharedState>,
    limit_per_profile: u32,
    scope: Option<String>,
) -> Result<Vec<HistoryRow>, String> {
    let guard = state.lock().unwrap();
    let active_id = guard.active_or_err()?.profile.id;
    let mut rows: Vec<HistoryRow> = Vec::new();
    for p in guard.profiles.list().map_err(|e| e.to_string())? {
        // scope = "all" merges every profile; anything else = active only
        if scope.as_deref() != Some("all") && p.id != active_id {
            continue;
        }
        let root = guard.profiles.storage_root(p.id);
        let Ok(store) = apb_storage::Store::open(root.join("history.sqlite"), apb_history::MIGRATIONS)
        else {
            continue;
        };
        // Ephemeral profiles never recorded visits; policy irrelevant for reads.
        let hist = apb_history::HistoryStore::new(store, apb_history::RecordingPolicy::Disabled);
        if let Ok(visits) = hist.recent(limit_per_profile) {
            for v in visits {
                rows.push(HistoryRow {
                    profile: p.name.clone(),
                    url: v.url,
                    title: v.title,
                    visited_at: v.visited_at,
                });
            }
        }
    }
    rows.sort_by(|a, b| b.visited_at.cmp(&a.visited_at));
    Ok(rows)
}

/// Note graph for the visual "logical network" view.
/// Nodes carry both the file name and the display title (first `# heading`
/// or the stem), edges are (from_title, to_title). Saved manual layout
/// positions are included so the user can arrange the graph by hand.
#[tauri::command]

pub(crate) fn clear_history(state: tauri::State<'_, SharedState>) -> Result<(), String> {
    let guard = state.lock().unwrap();
    guard.active_or_err()?.history.clear_all().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------
// Notes (§13, §30 — plain markdown on disk)
// ---------------------------------------------------------------------

#[tauri::command]

pub(crate) fn invoke_record_visit(app: &AppHandle, url: &str) {
    let title = tauri::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
        .unwrap_or_else(|| url.to_string());
    {
        let state = app.state::<SharedState>();
        let Ok(guard) = state.lock() else { return };
        if let Ok(active) = guard.active_or_err() {
            let _ = active.history.record(url, &title);
        }
    }
}

// Made by MrDuck