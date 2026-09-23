// Made by MrDuck
#![allow(unused_imports)]

use crate::state::{AppState, SharedState};
use tauri::{AppHandle, Manager, State};

use apb_extensions::{InstalledExtension, Permission, SandboxPolicy};
#[tauri::command]
pub(crate) fn ext_install(state: tauri::State<'_, SharedState>, path: String) -> Result<InstalledExtension, String> {
    let mut guard = state.lock().unwrap();
    guard.extensions.install(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn ext_list(state: tauri::State<'_, SharedState>) -> Result<Vec<InstalledExtension>, String> {
    let guard = state.lock().unwrap();
    Ok(guard.extensions.list().into_iter().cloned().collect())
}

#[tauri::command]
pub(crate) fn ext_grant(
    state: tauri::State<'_, SharedState>,
    ext_id: String,
    perms: Vec<Permission>,
) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    let profile_id = guard.active_or_err()?.profile.id;
    guard
        .extensions
        .grant_permissions(profile_id, &ext_id, &perms)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn ext_approve_dangerous(
    state: tauri::State<'_, SharedState>,
    ext_id: String,
    perm: Permission,
) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    let profile_id = guard.active_or_err()?.profile.id;
    guard
        .extensions
        .approve_dangerous(profile_id, &ext_id, perm)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn ext_set_enabled(
    state: tauri::State<'_, SharedState>,
    ext_id: String,
    enabled: bool,
) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    guard.extensions.set_enabled(&ext_id, enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn ext_sandbox_policy(
    state: tauri::State<'_, SharedState>,
    ext_id: String,
) -> Result<SandboxPolicy, String> {
    let guard = state.lock().unwrap();
    let profile_id = guard.active_or_err()?.profile.id;
    guard.extensions.sandbox_policy(profile_id, &ext_id).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// In-window page tabs: every tab is a native WebView2 surface (real browser
// engine) embedded as a child webview of the single shell window.
// ---------------------------------------------------------------------------

// Fallback-only estimates used before the shell DOM reports the real
// content-area rect via `page_relayout` (tabstrip + toolbar stack on top,
// icon rail on the left — see ui/index.html).

// Made by MrDuck