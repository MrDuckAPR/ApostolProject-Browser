// Made by MrDuck
#![allow(unused_imports)]

use crate::state::{AppState, SharedState};
use tauri::{AppHandle, Manager, State};

use apb_commands::CommandEntry;
#[tauri::command]
pub(crate) fn search_commands(state: tauri::State<'_, SharedState>, query: String) -> Vec<CommandEntry> {
    state.lock().unwrap().commands.search(&query).into_iter().cloned().collect()
}

// ---------------------------------------------------------------------
// Privacy Engine (§10, §10A)
// ---------------------------------------------------------------------

// Made by MrDuck