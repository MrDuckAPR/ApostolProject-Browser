// Made by MrDuck
#![allow(unused_imports)]

use crate::state::{AppState, SharedState};
use tauri::{AppHandle, Manager, State};

use apb_bookmarks::Bookmark;
#[tauri::command]
pub(crate) fn add_bookmark(
    state: tauri::State<'_, SharedState>,
    title: String,
    url: String,
    tags: Vec<String>,
    note: Option<String>,
    folder_id: Option<String>,
) -> Result<Bookmark, String> {
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let tag_refs: Vec<&str> = tags.iter().map(String::as_str).collect();
    let fid = folder_id.and_then(|s| uuid::Uuid::parse_str(&s).ok());
    active
        .bookmarks
        .add(&title, &url, fid, &tag_refs, note.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn search_bookmarks(state: tauri::State<'_, SharedState>, query: String) -> Result<Vec<Bookmark>, String> {
    let guard = state.lock().unwrap();
    guard.active_or_err()?.bookmarks.search(&query).map_err(|e| e.to_string())
}

/// Все закладки + все папки одним пакетом: панель «Закладки» строит
/// дерево (папки → вложенные папки → закладки без папки — корень).
#[tauri::command]
pub(crate) fn bookmarks_tree(
    state: tauri::State<'_, SharedState>,
) -> Result<serde_json::Value, String> {
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let folders = active
        .bookmarks
        .folders()
        .map_err(|e| e.to_string())?;
    let items = active
        .bookmarks
        .all()
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "folders": folders, "items": items }))
}

/// Создать папку закладок (вложенность через parent_id).
#[tauri::command]
pub(crate) fn bookmark_folder_create(
    state: tauri::State<'_, SharedState>,
    name: String,
    parent_id: Option<String>,
) -> Result<apb_bookmarks::Folder, String> {
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let pid = parent_id
        .and_then(|s| uuid::Uuid::parse_str(&s).ok());
    active
        .bookmarks
        .create_folder(&name, pid)
        .map_err(|e| e.to_string())
}

/// Удалить закладку по id (строке UUID).
#[tauri::command]
pub(crate) fn bookmark_delete(state: tauri::State<'_, SharedState>, id: String) -> Result<(), String> {
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let uuid = uuid::Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    active.bookmarks.delete(uuid).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------
// History (§10A.3 — respects each profile's RecordingPolicy)
// ---------------------------------------------------------------------

// Made by MrDuck