// Made by MrDuck
// GUI-приложение без консольного окна (пустая консоль рядом с браузером
// сбивала с толку). Диагностика всё равно пишется в apb/logs/shell-debug.log.
#![windows_subsystem = "windows"]

//! APB desktop shell — Tauri backend (entry point).
//!
//! The backend is split into domain modules:
//!   * `state.rs`   — shared `AppState` / `ActiveProfile` / `SharedState`
//!   * `webviews/layout.rs`   — window-level layout machinery (`PageTabs`, `relayout`,
//!     the `#browserView` measuring contract, main-thread helper)
//!   * `util.rs`    — percent/base64 codecs, image magic-byte sniffing
//!   * `features/*`      — one module per feature domain, mirroring the frontend
//!     modules under `ui/src/features/` (mapping table in `features/mod.rs`)
//!
//! Threading rule (critical on Windows): any command that touches webviews
//! or blocks (network I/O, Argon2) must be `async`, so its body runs on a
//! worker thread; webview work is marshaled back via `webviews::on_main_thread`.

mod app;
mod webviews;
mod features;
mod network;
mod state;
mod util;

use webviews::{enable_dwm_transitions, relayout, PageTabs};
use features::*;
use state::AppState;
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// Frontend debug logger (ui/src/app/debug-log.js), compiled into the
/// binary and injected as an initialization script of the shell window in
/// DEBUG builds only. Initialization scripts run before any document
/// script, which the logger requires to wrap invoke in time (it must beat
/// boot-core.js to the reference). In release builds the logger does not
/// exist at all — index.html no longer references it.
#[cfg(debug_assertions)]
const DEBUG_FRONTEND_JS: &str = include_str!("../../ui/src/app/debug-log.js");

fn main() {
    // Resolve the normal OS application-data folder before WebView2 starts.
    let system_root = app::prepare_system_root();

    // Privacy engine data plane must exist BEFORE the first webview: the
    // local filtering proxy port goes into the shared browser arguments.
    let filter = Arc::new(network::liveprivacy::LiveFilter::default());
    let proxy_port = network::proxy::spawn(filter.clone());

    tauri::Builder::default()
        // Единый экземпляр приложения: повторный запуск exe НЕ плодит второй
        // браузер на том же user-data folder (два процесса WebView2 ломают
        // друг друга), а выводит существующее окно на передний план.
        // Регистрируется самым первым плагином — до любых window-событий.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            use tauri::{Emitter, Manager};
            if let Some(win) = app.get_webview_window("shell") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
            for url in args.into_iter().filter(|a| a.starts_with("http://") || a.starts_with("https://")) {
                let _ = app.emit("external-open-url", url);
            }
        }))
        .manage(filter)
        .setup(move |app| {
            let data_dir = app::initialize_data_root(app.handle(), system_root.clone())
                .map_err(|e: String| -> Box<dyn std::error::Error> { e.into() })?;
            let bootstrapped = AppState::bootstrap(data_dir).map_err(|e: String| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(Mutex::new(bootstrapped));
            app.manage(PageTabs::default());
            app.manage(crate::webviews::overlay::PopupState::default());
            app.manage(features::downloads::DownloadsLog::load_from_disk(app.handle()));
            app.manage(features::downloads::DlOwnRuns::default());
            app.manage(features::vault::VaultSecurityState::default());
            app.manage(features::maintenance::TabMemoryState::default());
            // Видимая структура данных юзера (settings.json/themes/README):
            features::settings::ensure_visible_layout(app.handle());

            // Browser args are finalized here — after bootstrap, before the
            // shell window (and any tab webview) exists. DNS is deliberately
            // NOT put into browser args: behind our HTTP proxy the engine
            // never resolves hostnames itself, so profile DNS lives in
            // `resolver` and is applied by sync_from_state below.
            network::liveprivacy::init_browser_args(proxy_port, features::experimental::autoplay_allowed_at_startup(app.handle()));
            network::liveprivacy::sync_from_state(app.handle())?;

            // The shell window is created here (not from tauri.conf.json) so
            // it shares the exact same browser arguments as every tab —
            // WebView2 requires identical environment options per user-data
            // folder, and the tabs get the proxy flag.
            // КЭШ-БАСТЕР входного документа: WebView2 кэширует index.html
            // эвристически и после правок (dev) или обновления (release)
            // грузил СТАРЫЙ UI со старыми ?v=-ссылками на скрипты.
            // Входной URL обязан меняться: dev — при каждом запуске,
            // релиз — с версией приложения. ГРАБЛЯ 29 (записана в журнал 117).
            #[cfg(debug_assertions)]
            let entry_url = format!(
                "index.html?_dev={}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0)
            );
            #[cfg(not(debug_assertions))]
            let entry_url = format!("index.html?v={}", env!("CARGO_PKG_VERSION"));
            // `mut` нужен только debug-сборке (инжект DEBUG_FRONTEND_JS ниже).
            #[allow(unused_mut)]
            let mut shell_builder =
                tauri::WebviewWindowBuilder::new(app, "shell", tauri::WebviewUrl::App(entry_url.into()))
                    .title("APB — ApostolProject Browser")
                    .inner_size(1280.0, 820.0)
                    .min_inner_size(900.0, 560.0)
                    .resizable(true)
                    .decorations(false)
                    .maximized(true)
                    // Прозрачное окно С МОМЕНТА СОЗДАНИЯ: Windows не даёт
                    // включить прозрачность/стекло на живом окне. Пока юзер
                    // не просил «видеть рабочий стол», html/body непрозрачны
                    // и окно выглядит как обычное.
                    .transparent(true)
                    .additional_browser_args(network::liveprivacy::browser_args());
            // Debug-логгер — только в debug-сборке (см. DEBUG_FRONTEND_JS).
            // initialization_script выполняется до скриптов index.html —
            // логгер успеет обернуть invoke до захвата ссылки в boot-core.
            #[cfg(debug_assertions)]
            {
                shell_builder = shell_builder.initialization_script(DEBUG_FRONTEND_JS);
            }
            shell_builder
                .build()
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            // Resume downloads that were active when APB stopped, and forward
            // an HTTP/HTTPS command-line argument after the shell is ready.
            let startup_app = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1200));
                features::downloads::resume_interrupted_downloads(&startup_app);
                if let Some(url) = std::env::args().skip(1).find(|a| a.starts_with("http://") || a.starts_with("https://")) {
                    let _ = tauri::Emitter::emit(&startup_app, "external-open-url", url);
                }
            });
            // DWM-анимации появления/сворачивания окна явно включены —
            // безрамочное окно иначе может прийти без системных переходов.
            if let Some(win) = app.get_window("shell") {
                enable_dwm_transitions(&win);
            }
            // Окно-попап для HTML-меню/попапов оболочки: frameless,
            // прозрачное, always-on-top. Рисуется ВЫШЕ дочерних webview
            // вкладок, поэтому меню видно над сайтом. Создаётся один раз
            // скрытым; overlay_show/hide только показывают/прячут его.
            // browser-args ОБЯЗАНЫ совпадать с окном оболочки и вкладками
            // (общее окружение WebView2), иначе создание падает с 0x8007139F.
            let popup_built = tauri::WebviewWindowBuilder::new(
                app,
                crate::webviews::overlay::POPUP_LABEL,
                tauri::WebviewUrl::App("overlay.html".into()),
            )
            .title("")
            .inner_size(360.0, 520.0)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .shadow(false)
            .focused(false)
            .visible(false)
            .additional_browser_args(network::liveprivacy::browser_args())
            .build();
            match popup_built {
                Ok(_) => crate::features::debug::append_backend_log("[popup] startup: created OK"),
                Err(e) => crate::features::debug::append_backend_log(&format!("[popup] startup FAILED: {e}")),
            }
            let popup_check = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                let exists = popup_check.get_webview_window(crate::webviews::overlay::POPUP_LABEL).is_some();
                crate::features::debug::append_backend_log(&format!("[popup] check after 3s: exists={exists}"));
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "shell" {
                // Закрытие оболочки должно гасить и скрытое окно-попап:
                // иначе WebviewWindow apb-popup остаётся открытым (пусть и
                // невидимым), Tauri не считает приложение «свернутым до нуля
                // окон» и процесс продолжает жить в фоне без видимого окна —
                // повторный запуск через single-instance не находит shell и
                // не показывает ничего (баг «закрыл, а открыть нельзя»).
                if matches!(
                    event,
                    tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed { .. }
                ) {
                    if let Some(popup) = window.app_handle().get_webview_window(crate::webviews::overlay::POPUP_LABEL) {
                        let _ = popup.close();
                    }
                }
                if matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_)) {
                    crate::webviews::overlay::dismiss(window.app_handle());
                    relayout(window.app_handle());
                }
            } else if window.label() == crate::webviews::overlay::POPUP_LABEL {
                // Клик вне попапа (в приложении или по сайту) забирает фокус —
                // меню закрывается само.
                if matches!(event, tauri::WindowEvent::Focused(false)) {
                    crate::webviews::overlay::dismiss(window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_profiles,
            create_profile,
            create_anonymous_profile,
            switch_profile,
            rename_profile,
            active_profile,
            delete_profile,
            add_bookmark,
            search_bookmarks,
            bookmarks_tree,
            bookmark_folder_create,
            bookmark_delete,
            window_transparency,
            record_visit,
            recent_history,
            clear_history,
            list_notes,
            create_note,
            read_note,
            backlinks,
            save_note_image,
            read_note_asset,
            search_commands,
            get_privacy_overview,
            set_privacy_level,
            update_privacy_policy,
            set_emergency_mode,
            add_blocklist,
            panic_button,
            get_network_settings,
            save_network_settings,
            route_preview,
            run_network_diagnostics,
            privacy_stats,
            privacy_reset_stats,
            remove_blocklist,
            add_blocklist_from_url,
            site_override_set,
            site_override_remove,
            vault_status,
            vault_create,
            vault_unlock,
            vault_lock,
            vault_add_entry,
            vault_list,
            vault_reveal,
            vault_generate_password,
            vault_touch,
            vault_set_auto_lock,
            vault_backup_now,
            vault_export_encrypted,
            vault_import_preview,
            vault_import_apply,
            profile_container_export,
            profile_container_decrypt,
            ai_get_config,
            ai_save_config,
            ai_chat,
            translate_free,
            tr_translate_batch,
            tr_report,
            search_suggest,
            history_all_profiles,
            notes_graph,
            save_graph_positions,
            save_board_items,
            note_delete,
            notes_reindex,
            session_get,
            session_save,
            session_stats,
            downloads_list,
            downloads_dir,
            download_cancel,
            download_pause,
            download_resume,
            download_retry,
            downloads_clear,
            dl_dir_get,
            dl_dir_set,
            save_text_file,
            save_image_file,
            page_save_image,
            debug_log_append,
            page_eval,
            shell_hotkey,
            shell_open_tab,
            workspaces_get,
            workspaces_set,
            page_extract_text,
            ext_install,
            ext_list,
            ext_grant,
            ext_approve_dangerous,
            ext_set_enabled,
            ext_sandbox_policy,
            page_open,
            page_open_bg,
            page_url_push,
            page_diag,
            page_navigate,
            page_activate,
            page_hide_all,
            page_close,
            page_relayout,
            page_split_set,
            page_split_off,
            page_fullscreen_enter,
            page_fullscreen_exit,
            privacy_apply_to_open_tabs,
            open_in_system,
            app_version,
            update_check,
            update_install,
            settings_theme_save,
            settings_search_save,
            experimental_get,
            experimental_save,
            clipboard_write,
            performance_load_test,
            tab_memory_list,
            page_memory_report,
            site_permissions_get,
            site_permissions_set,
            page_permission_check,
            diagnostic_report_export,
            browser_registration_status,
            browser_register,
            browser_open_default_apps,
            overlay_show,
            overlay_hide,
            overlay_action
        ])
        .run(tauri::generate_context!())
        .expect("error while running APB");
}

// Made by MrDuck