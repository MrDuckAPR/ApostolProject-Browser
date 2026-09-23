// Made by MrDuck
#![allow(unused_imports)]

use crate::util::percent_encode;
use crate::util::decode_base64;
use crate::state::{AppState, SharedState};
use tauri::{AppHandle, Manager, State};

use crate::util::{encode_base64, sniff_image_mime, percent_decode};
/// Рекурсивный обход notes/: относительные пути с '/', только .md
fn walk_md_notes(
    dir: &std::path::Path,
    base: &std::path::Path,
    out: &mut Vec<String>,
) -> std::io::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            walk_md_notes(&path, base, out)?;
        } else if path.extension().map(|e| e == "md").unwrap_or(false) {
            if let Ok(rel) = path.strip_prefix(base) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn list_notes(state: tauri::State<'_, SharedState>) -> Result<Vec<String>, String> {
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let root = guard.profiles.storage_root(active.profile.id).join("notes");
    let mut out = Vec::new();
    walk_md_notes(&root, &root, &mut out).map_err(|e| e.to_string())?;
    out.sort();
    Ok(out)
}

#[tauri::command]
pub(crate) fn create_note(state: tauri::State<'_, SharedState>, path: String, content: String) -> Result<(), String> {
    let guard = state.lock().unwrap();
    guard.active_or_err()?.notes.write_note(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn read_note(state: tauri::State<'_, SharedState>, path: String) -> Result<String, String> {
    let guard = state.lock().unwrap();
    guard.active_or_err()?.notes.read_note(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn backlinks(state: tauri::State<'_, SharedState>, title: String) -> Result<Vec<String>, String> {
    let guard = state.lock().unwrap();
    guard.active_or_err()?.notes.backlinks(&title).map_err(|e| e.to_string())
}

/// Save a drawing (PNG data-URL from the note editor's canvas) into the
/// profile's `notes/assets/` folder; returns an asset-protocol URL that the
/// markdown preview can render directly.
// Made by MrDuck
#[tauri::command]
pub(crate) fn save_note_image(
    state: tauri::State<'_, SharedState>,
    data_base64: String,
) -> Result<String, String> {
    let bytes = decode_base64(&data_base64).ok_or_else(|| "не удалось декодировать изображение".to_string())?;
    if bytes.is_empty() || !bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Err("ожидается PNG".into());
    }
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let root = guard.profiles.storage_root(active.profile.id).join("notes").join("assets");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let name = format!("{}.png", uuid::Uuid::new_v4());
    std::fs::write(root.join(&name), bytes).map_err(|e| e.to_string())?;
    let abs = root.join(&name);
    // Tauri's asset protocol uses https://asset.localhost/ on Windows and
    // Android (WebView2/WebView restrictions on custom schemes), and
    // asset://localhost/ elsewhere (Linux/macOS).
    let scheme = if cfg!(any(target_os = "windows", target_os = "android")) {
        "https"
    } else {
        "asset"
    };
    Ok(format!("{scheme}://asset.localhost/{}", percent_encode(abs.to_string_lossy().as_bytes())))
}

/// Serve a note-embedded image as a data-URL, bypassing the asset protocol.
/// Accepts an asset-protocol URL (`https://asset.localhost/C%3A%5C...`),
/// a raw absolute path or a profile-relative reference (`assets/x.png`).
/// Only files inside the active profile's `notes/` subtree are served, and
/// only real images (magic-byte sniff) pass — no arbitrary file read.
#[tauri::command]
pub(crate) fn read_note_asset(state: tauri::State<'_, SharedState>, src: String) -> Result<String, String> {
    let mut s = src.trim().to_string();
    for prefix in [
        "https://asset.localhost/",
        "http://asset.localhost/",
        "asset://localhost/",
        "asset://",
    ] {
        if let Some(rest) = s.strip_prefix(prefix) {
            s = percent_decode(rest).ok_or_else(|| "некорректная ссылка на изображение".to_string())?;
            break;
        }
    }
    let s = s.trim_matches('"');
    let notes_root = {
        let guard = state.lock().unwrap();
        let active = guard.active_or_err()?;
        guard.profiles.storage_root(active.profile.id).join("notes")
    };
    let cand = std::path::PathBuf::from(s);
    let path = if cand.is_absolute() {
        cand
    } else {
        // Relative markdown refs resolve against the notes folder first,
        // then the assets subfolder (e.g. `assets/<uuid>.png`).
        let direct = notes_root.join(&cand);
        if direct.exists() {
            direct
        } else {
            notes_root.join("assets").join(&cand)
        }
    };
    let canon_file = path.canonicalize().map_err(|_| "изображение не найдено".to_string())?;
    let canon_root = notes_root.canonicalize().map_err(|e| e.to_string())?;
    if !canon_file.starts_with(&canon_root) {
        return Err("доступ к файлу запрещён".into());
    }
    let bytes = std::fs::read(&canon_file).map_err(|e| e.to_string())?;
    let mime = sniff_image_mime(&bytes)
        .ok_or_else(|| "файл не является изображением".to_string())?;
    Ok(format!("data:{};base64,{}", mime, encode_base64(&bytes)))
}

/// Detect common raster image formats by magic bytes.

// Made by MrDuck
#[tauri::command]
pub(crate) fn notes_graph(state: tauri::State<'_, SharedState>) -> Result<serde_json::Value, String> {
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let root = guard.profiles.storage_root(active.profile.id).join("notes");
    let mut nodes: Vec<serde_json::Value> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    walk_md_notes(&root, &root, &mut files).map_err(|e| e.to_string())?;
    for name in files {
        let path = root.join(&name);
        let title = std::fs::read_to_string(&path)
            .ok()
            .and_then(|c| {
                c.lines().find_map(|l| l.strip_prefix("# ").map(str::trim).map(String::from))
            })
            .unwrap_or_else(|| name.trim_end_matches(".md").to_string());
        nodes.push(serde_json::json!({ "file": name, "title": title }));
    }
    nodes.sort_by(|a, b| a["file"].as_str().cmp(&b["file"].as_str()));
    let edges = active.notes.graph_edges().map_err(|e| e.to_string())?;
    // Manual layout persistence
    let pos_path = root.join("notes-graph.json");
    let positions: serde_json::Value = std::fs::read_to_string(&pos_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    // Free-form board items (text/image/widget blocks placed by the user).
    // Self-heal: older builds stored the payload as a JSON *string* — unwrap.
    let board_path = root.join("notes-board.json");
    let mut items: serde_json::Value = std::fs::read_to_string(&board_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!([]));
    if let serde_json::Value::String(inner) = &items {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(inner) {
            items = parsed;
        }
    }
    Ok(serde_json::json!({ "nodes": nodes, "edges": edges, "positions": positions, "items": items }))
}

#[tauri::command]
pub(crate) fn save_board_items(
    state: tauri::State<'_, SharedState>,
    items: serde_json::Value,
) -> Result<(), String> {
    // Tolerate legacy callers that passed an already-serialized STRING.
    let val: serde_json::Value = match items {
        serde_json::Value::String(s) => serde_json::from_str(&s)
            .map_err(|e| format!("некорректный JSON борда: {e}"))?,
        v => v,
    };
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let root = guard.profiles.storage_root(active.profile.id).join("notes");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    std::fs::write(
        root.join("notes-board.json"),
        serde_json::to_string_pretty(&val).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

// Made by MrDuck
#[tauri::command]
pub(crate) fn save_graph_positions(
    state: tauri::State<'_, SharedState>,
    positions: serde_json::Value,
) -> Result<(), String> {
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let root = guard.profiles.storage_root(active.profile.id).join("notes");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    std::fs::write(
        root.join("notes-graph.json"),
        serde_json::to_string(&positions).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

/// Delete a markdown note from the active profile's vault.
/// Папки поддерживаются: путь вида `Folder/Sub/Note.md` (относительный).
#[tauri::command]
pub(crate) fn note_delete(state: tauri::State<'_, SharedState>, path: String) -> Result<(), String> {
    if path.contains("..") || path.starts_with('/') || path.starts_with('\\') || path.contains('\\')
    {
        return Err("недопустимый путь".into());
    }
    let mut guard = state.lock().unwrap();
    let profile_id = guard.active_or_err()?.profile.id;
    let root = guard.profiles.storage_root(profile_id).join("notes");
    let full = root.join(&path);
    if full.exists() {
        std::fs::remove_file(&full).map_err(|e| e.to_string())?;
    }
    // Подчистка опустевших папок (вверх до корня notes/)
    let mut parent = full.parent();
    while let Some(p) = parent {
        if p == root {
            break;
        }
        let empty = p
            .read_dir()
            .map(|mut d| d.next().is_none())
            .unwrap_or(false);
        if empty {
            let _ = std::fs::remove_dir(p);
            parent = p.parent();
        } else {
            break;
        }
    }
    guard.active_mut_or_err()?.notes.reindex().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn notes_reindex(state: tauri::State<'_, SharedState>) -> Result<usize, String> {
    let mut guard = state.lock().unwrap();
    guard.active_mut_or_err()?.notes.reindex().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------
// Session persistence — the open tabs survive an app restart.
// Stored per profile as session.json; ephemeral profiles are skipped
// on the frontend side (they keep nothing by design).
// ---------------------------------------------------------------------

// Made by MrDuck