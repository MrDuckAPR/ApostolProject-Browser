// Made by MrDuck
//! Видимая структура данных браузера (запрос юзера: «нормальная папка,
//! где можно хранить темы/настройки», как у больших браузеров).
//!
//! %APPDATA%/dev.apb.browser/ теперь читается человеком:
//!   settings.json   — тема браузера + поисковик (продублированы из
//!                     localStorage, который живёт внутри EBWebView
//!                     и пользователю не виден; localStorage остаётся
//!                     источником правды для UI, файл — удобная копия)
//!   themes/         — папка под будущие кастомные темы (дизайн-план);
//!                     сейчас пишет туда theme.css при смене темы
//!   README.txt      — что лежит в остальных папках (profiles/ и т.д.)
//!
//! Не трогаем: profiles/ (SQLite + notes/ + canvas/ + session.json),
//! extensions/, logs/ — их формат уже открытый (SQLite/Markdown/JSON).

use tauri::AppHandle;

fn data_root(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    crate::app::data_root(app)
}

fn write_if_new(path: &std::path::Path, contents: &str) -> Result<(), String> {
    if !path.exists() {
        std::fs::write(path, contents).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Один раз за запуск (setup, main.rs): гарантирует видимые папки/файлы
/// для нового юзера и добавляет их в существующие установки.
pub(crate) fn ensure_visible_layout(app: &AppHandle) {
    let Ok(root) = data_root(app) else { return };
    let _ = std::fs::create_dir_all(root.join("themes"));
    let _ = write_if_new(
        &root.join("README.txt"),
        concat!(
            "APB — ApostolProject Browser: папка данных пользователя\n",
            "=======================================================\n\n",
            "  settings.json  — настройки интерфейса (тема, поисковик) — читаемый JSON\n",
            "  themes/        — темы оформления (браузер сам пишет текущую тему в theme.css)\n",
            "  profiles/      — профили браузера: закладки/история (SQLite),\n",
            "                   заметки (Markdown в profiles/<id>/notes),\n",
            "                   воркспейсы и сессия (JSON), canvas (JSON)\n",
            "  extensions/    — установленные расширения + их разрешения\n",
            "  logs/         — журнал отладки (только в debug-сборках)\n\n",
            "Файлы .sqlite можно открыть любым SQLite-редактором, заметки —\n",
            "обычные .md. Удаление папки = сброс всех данных браузера.\n",
        ),
    );
    let _ = write_if_new(
        &root.join("settings.json"),
        "{\n  \"theme\": \"dark\",\n  \"search_engine\": \"duckduckgo\"\n}\n",
    );
}

/// Записать текущую тему в читаемые места: settings.json + themes/theme.css.
/// Вызывается фронтендом при каждой смене темы (theme-sync.js) — файл
/// остаётся актуальным, localStorage не единственная копия.
#[tauri::command]
pub(crate) fn settings_theme_save(
    app: AppHandle,
    theme: String,
    resolved: Option<String>,
) -> Result<(), String> {
    let root = data_root(&app)?;
    let spath = root.join("settings.json");
    // Merge в существующий settings.json (не затираем другие поля).
    let mut doc: serde_json::Value = std::fs::read_to_string(&spath)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    doc["theme"] = serde_json::Value::String(theme.clone());
    doc["theme_updated"] = serde_json::Value::String(chrono::Utc::now().to_rfc3339());
    let pretty = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    std::fs::write(&spath, pretty).map_err(|e| e.to_string())?;
    // themes/theme.css — живой снапшот активной темы для глаз пользователя.
    let is_dark = resolved.as_deref().unwrap_or(&theme) != "light";
    let accent = if is_dark { "#7fb0ff" } else { "#3b6fd4" };
    let bg = if is_dark { "#0f0f13" } else { "#f4f5f7" };
    let css = format!(
        "/* Активная тема APB: {theme} (обновляется автоматически при смене темы). */\n\
         /* Кастомные темы из этой папки — в разработке (дизайн-план, Vivaldi-уровень). */\n\
         :root {{\n  --accent: {accent};\n  --bg: {bg};\n}}\n",
    );
    let _ = std::fs::write(root.join("themes").join("theme.css"), css);
    Ok(())
}

/// То же для поисковика (merge в settings.json).
#[tauri::command]
pub(crate) fn settings_search_save(app: AppHandle, engine: String) -> Result<(), String> {
    let root = data_root(&app)?;
    let spath = root.join("settings.json");
    let mut doc: serde_json::Value = std::fs::read_to_string(&spath)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    doc["search_engine"] = serde_json::Value::String(engine);
    let pretty = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    std::fs::write(&spath, pretty).map_err(|e| e.to_string())?;
    Ok(())
}

// Made by MrDuck
