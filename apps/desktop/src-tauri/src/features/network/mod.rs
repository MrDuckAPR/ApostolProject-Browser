// Made by MrDuck
#![allow(unused_imports)]

use crate::state::{AppState, SharedState};
use tauri::{AppHandle, Manager, State};

use apb_network::NetworkSettings;
#[tauri::command]
pub(crate) fn get_network_settings(
    state: tauri::State<'_, SharedState>,
) -> Result<NetworkSettings, String> {
    let guard = state.lock().unwrap();
    Ok(guard.active_or_err()?.network.clone())
}

#[tauri::command]
pub(crate) fn save_network_settings(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    settings: NetworkSettings,
) -> Result<(), String> {
    // Reject invalid configs with a clear message instead of persisting
    // something the resolver/proxy would silently ignore.
    settings.dns.validate().map_err(|e| e.to_string())?;
    let mut guard = state.lock().unwrap();
    guard.active_mut_or_err()?.network = settings;
    guard.persist_active_config()?;
    drop(guard);
    // The proxy routes traffic through the configured chain live; profile
    // DNS reaches the proxy resolver through the same sync.
    crate::network::liveprivacy::sync_from_state(&app)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn route_preview(
    state: tauri::State<'_, SharedState>,
    host: String,
) -> Result<Vec<apb_network::RouteNode>, String> {
    let guard = state.lock().unwrap();
    Ok(guard.active_or_err()?.network.effective_route_for(&host))
}

#[tauri::command]
pub(crate) async fn run_network_diagnostics(
    state: tauri::State<'_, SharedState>,
) -> Result<Vec<apb_network::DiagnosticResult>, String> {
    let guard = state.lock().unwrap();
    Ok(apb_network::run_diagnostics(&guard.active_or_err()?.network))
}

// ---------------------------------------------------------------------
// Secure Vault (AES-256-GCM + Argon2id)
// ---------------------------------------------------------------------

// Made by MrDuck