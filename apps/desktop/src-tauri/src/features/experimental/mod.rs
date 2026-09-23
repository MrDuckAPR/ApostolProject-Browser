// Made by MrDuck
//! Экспериментальные функции (вкладка «Экспериментальные функции» в
//! настройках): переключатели для нестабильных/опциональных механик,
//! которые ещё не готовы стать настройками по умолчанию.
//!
//! Сейчас две опции:
//!   * `autoplay_allowed` — снимает блокировку автозапуска медиа
//!     (`--autoplay-policy`). Действует с момента старта браузера, т.к.
//!     browser args фиксируются до создания первого webview.
//!   * `clipboard_sync` — шим во вкладках принудительно пишет скопированный
//!     текст в системный буфер через командy `clipboard_write` (обходит
//!     случаи, когда WebView2 не успевает синхронизировать буфер).

use tauri::AppHandle;

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub(crate) struct ExperimentalSettings {
    pub(crate) autoplay_allowed: bool,
    pub(crate) clipboard_sync: bool,
}

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(crate::app::data_root(app)?.join("settings.json"))
}

fn read_settings(app: &AppHandle) -> ExperimentalSettings {
    let Ok(path) = settings_path(app) else { return ExperimentalSettings::default() };
    let Ok(raw) = std::fs::read_to_string(&path) else { return ExperimentalSettings::default() };
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(&raw) else { return ExperimentalSettings::default() };
    doc.get("experimental")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default()
}

fn write_settings(app: &AppHandle, s: &ExperimentalSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let mut doc: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    doc["experimental"] = serde_json::to_value(s).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(path.parent().unwrap_or_else(|| std::path::Path::new(".")))
        .map_err(|e| e.to_string())?;
    std::fs::write(&path, serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())
}

/// Флаг allow-autoplay, читаемый при старте (до создания первого webview).
pub(crate) fn autoplay_allowed_at_startup(app: &AppHandle) -> bool {
    read_settings(app).autoplay_allowed
}

#[tauri::command]
pub(crate) fn experimental_get(app: AppHandle) -> Result<ExperimentalSettings, String> {
    Ok(read_settings(&app))
}

#[tauri::command]
pub(crate) fn experimental_save(
    app: AppHandle,
    autoplay_allowed: Option<bool>,
    clipboard_sync: Option<bool>,
) -> Result<(), String> {
    let mut s = read_settings(&app);
    if let Some(v) = autoplay_allowed {
        s.autoplay_allowed = v;
    }
    if let Some(v) = clipboard_sync {
        s.clipboard_sync = v;
    }
    write_settings(&app, &s)
}

/// Запись текста в системный буфер обмена (Windows). Срабатывает только
/// когда включён `clipboard_sync` — вызов из страницы без флага безопасен
/// (no-op), поэтому шим можно инжектить в каждую вкладку всегда.
#[tauri::command]
pub(crate) fn clipboard_write(app: AppHandle, text: String) -> Result<(), String> {
    if !read_settings(&app).clipboard_sync {
        return Ok(());
    }
    if text.is_empty() {
        return Ok(());
    }
    set_clipboard_text(&text)
}

#[cfg(target_os = "windows")]
fn set_clipboard_text(text: &str) -> Result<(), String> {
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    const CF_UNICODETEXT: u32 = 13;

    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return Err("не удалось открыть буфер обмена".into());
        }
        let result = (|| -> Result<(), String> {
            if EmptyClipboard() == 0 {
                return Err("не удалось очистить буфер обмена".into());
            }
            let bytes = (wide.len() * 2) as usize;
            let hmem = GlobalAlloc(GMEM_MOVEABLE, bytes);
            if hmem.is_null() {
                return Err("не удалось выделить память".into());
            }
            let ptr = GlobalLock(hmem);
            if ptr.is_null() {
                GlobalFree(hmem);
                return Err("не удалось заблокировать память".into());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, ptr as *mut u8, bytes);
            GlobalUnlock(hmem);
            if SetClipboardData(CF_UNICODETEXT, hmem).is_null() {
                GlobalFree(hmem);
                return Err("не удалось записать в буфер обмена".into());
            }
            Ok(())
        })();
        CloseClipboard();
        result
    }
}

#[cfg(not(target_os = "windows"))]
fn set_clipboard_text(_text: &str) -> Result<(), String> {
    panic!("clipboard_write реализован только для Windows")
}

// Made by MrDuck