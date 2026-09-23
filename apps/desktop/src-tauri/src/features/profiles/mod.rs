// Made by MrDuck
#![allow(unused_imports)]

use apb_profiles::Profile;
use crate::state::{AppState, SharedState};
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub(crate) fn list_profiles(state: tauri::State<'_, SharedState>) -> Result<Vec<Profile>, String> {
    state.lock().unwrap().profiles.list().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn create_profile(state: tauri::State<'_, SharedState>, name: String) -> Result<Profile, String> {
    state.lock().unwrap().profiles.create(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn create_anonymous_profile(state: tauri::State<'_, SharedState>) -> Result<Profile, String> {
    state
        .lock()
        .unwrap()
        .profiles
        .create_anonymous()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn switch_profile(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedState>,
    id: String,
) -> Result<Profile, String> {
    let uuid = uuid::Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let mut guard = state.lock().unwrap();
    guard.activate(uuid)?;
    let profile = guard.active_or_err()?.profile.clone();
    drop(guard);
    crate::network::liveprivacy::sync_from_state(&app)?;
    Ok(profile)
}

#[tauri::command]
pub(crate) fn active_profile(state: tauri::State<'_, SharedState>) -> Result<Profile, String> {
    Ok(state.lock().unwrap().active_or_err()?.profile.clone())
}

/// Удалить профиль вместе со всеми его данными (storage root стирается
/// целиком в ProfileManager::delete). Единственный профиль удалить нельзя.
/// Удаление АКТИВНОГО разрешено: приложение автоматически переключается
/// на другой существующий профиль перед стиранием.
#[tauri::command]
pub(crate) fn rename_profile(state: tauri::State<'_, SharedState>, id: String, name: String) -> Result<(), String> {
    let uuid = uuid::Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("имя профиля не может быть пустым".into());
    }
    let mut guard = state.lock().unwrap();
    guard.profiles.rename(uuid, &name).map_err(|e| e.to_string())?;
    // Keep the in-memory active copy consistent (sidebar badges use it).
    if let Some(a) = guard.active.as_mut() {
        if a.profile.id == uuid {
            a.profile.name = name;
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_profile(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedState>,
    id: String,
) -> Result<(), String> {
    let uuid = uuid::Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let mut guard = state.lock().unwrap();
    let all = guard.profiles.list().map_err(|e| e.to_string())?;
    if all.len() <= 1 {
        return Err("нельзя удалить последний профиль — должен остаться хотя бы один".into());
    }
    let is_active = guard
        .active
        .as_ref()
        .map(|a| a.profile.id == uuid)
        .unwrap_or(false);
    if is_active {
        let next = all
            .iter()
            .find(|p| p.id != uuid)
            .map(|p| p.id)
            .ok_or_else(|| "нельзя удалить последний профиль".to_string())?;
        guard.activate(next)?;
    }
    guard.profiles.delete(uuid).map_err(|e| e.to_string())?;
    drop(guard);
    crate::network::liveprivacy::sync_from_state(&app)?;
    Ok(())
}

// ---------------------------------------------------------------------
// Bookmarks (§7)
// ---------------------------------------------------------------------

// Made by MrDuck