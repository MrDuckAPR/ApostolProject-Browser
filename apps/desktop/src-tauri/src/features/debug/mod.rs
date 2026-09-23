// Made by MrDuck
//! Debug logging — активен ТОЛЬКО в debug-сборках (`cargo build`).
//! В release (`tauri build` / GitHub Actions) модуль компилируется в
//! заглушки нулевой стоимости: команда отвечает Ok(()) ничего не делая,
//! append_backend_log — no-op, файлов логов релиз не создаёт и не трогает.
//!
//! Фронт-логгер (ui/js/core/debug-log.js) больше НЕ подключается через
//! index.html: в debug-сборке его текст вшит в бинарник (include_str!) и
//! инжектится initialization_script'ом окна shell (см. main.rs) — он
//! выполняется ДО любого скрипта документа. В release логгера нет вообще.
//!
//! КУДА ПИШЕМ (в порядке приоритета, debug-сборки):
//!   1. `%APB_LOG_DIR%`, если переменная задана
//!   2. `<workspace-корень>/logs/` — ищем вверх от exe каталог с Cargo.toml
//!      и подпапкой apps/ → shell-debug.log рядом с проектом
//!   3. фолбэк — AppData
//!
//! Rotated at ~2 MB → shell-debug.log.old.

// ---------------------------------------------------------------------------
// Debug-сборка: живая реализация.
// ---------------------------------------------------------------------------
#[cfg(debug_assertions)]
use std::io::Write;
#[cfg(debug_assertions)]
use std::path::PathBuf;

#[cfg(debug_assertions)]
const MAX_BYTES: u64 = 2_000_000;

#[cfg(debug_assertions)]
fn logs_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(v) = std::env::var("APB_LOG_DIR") {
        let v = v.trim().to_string();
        if !v.is_empty() {
            return PathBuf::from(v);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        for anc in exe.ancestors().skip(1) {
            // именно workspace-корень: и манифест, и структура apps/
            if anc.join("Cargo.toml").is_file() && anc.join("apps").is_dir() {
                return anc.join("logs");
            }
        }
    }
    crate::app::data_root(app)
        .map(|p| p.join("logs"))
        .unwrap_or_else(|_| PathBuf::from("logs"))
}

/// Backend-side log line (no AppHandle available on proxy/resolver threads):
/// env override → project-root discovery by walking up from the exe.
/// Silent no-op when neither yields a directory (e.g. installed copy).
#[cfg(debug_assertions)]
pub(crate) fn append_backend_log(line: &str) {
    let dir = std::env::var("APB_LOG_DIR").ok().map(PathBuf::from).or_else(|| {
        std::env::current_exe().ok().and_then(|exe| {
            exe.ancestors().skip(1).find_map(|anc| {
                (anc.join("Cargo.toml").is_file() && anc.join("apps").is_dir())
                    .then(|| anc.join("logs"))
            })
        })
    });
    let Some(dir) = dir else { return };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("shell-debug.log");
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_BYTES {
            let _ = std::fs::rename(&path, dir.join("shell-debug.log.old"));
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{line}");
    }
}

#[cfg(debug_assertions)]
#[tauri::command]
pub(crate) fn debug_log_append(
    app: tauri::AppHandle,
    lines: Vec<String>,
) -> Result<(), String> {
    if lines.is_empty() {
        return Ok(());
    }
    let dir = logs_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("shell-debug.log");

    // Simple size-based rotation: keep exactly one previous generation.
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_BYTES {
            let _ = std::fs::rename(&path, dir.join("shell-debug.log.old"));
        }
    }

    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    for line in lines {
        let _ = writeln!(f, "{line}");
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Release-сборка: заглушки. Диагностические вызовы в pages.rs/resolver.rs
// компилируются как раньше, но не пишут ни байта; команда существует (общий
// generate_handler), но ничего не делает — фронт-логгер в release не
// инжектится и не зовёт её.
// ---------------------------------------------------------------------------
#[cfg(not(debug_assertions))]
#[inline]
pub(crate) fn append_backend_log(_line: &str) {}

#[cfg(not(debug_assertions))]
#[tauri::command]
pub(crate) fn debug_log_append(_lines: Vec<String>) -> Result<(), String> {
    Ok(())
}

// Made by MrDuck
