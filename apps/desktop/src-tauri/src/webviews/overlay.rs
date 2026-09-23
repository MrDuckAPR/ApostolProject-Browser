use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};

pub(crate) const POPUP_LABEL: &str = "apb-popup";

#[derive(Default)]
pub(crate) struct PopupState(pub Mutex<Option<String>>);

/// Ленивое создание окна-попапа, если стартовое создание не произошло
/// (журнал 2026-09-17: overlay_show падал «нет окна-попапа»).
fn ensure_popup(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(win) = app.get_webview_window(POPUP_LABEL) {
        return Ok(win);
    }
    crate::features::debug::append_backend_log("[overlay] popup отсутствует — ленивое создание");
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        POPUP_LABEL,
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
    .additional_browser_args(crate::network::liveprivacy::browser_args());
    match builder.build() {
        Ok(win) => {
            crate::features::debug::append_backend_log("[overlay] popup создан лениво");
            Ok(win)
        }
        Err(e) => {
            crate::features::debug::append_backend_log(&format!("[overlay] ошибка ленивого создания: {e}"));
            Err(e.to_string())
        }
    }
}

pub(crate) fn dismiss(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(POPUP_LABEL) {
        let _ = win.hide();
    }
    let id = app.state::<PopupState>().0.lock().unwrap().take();
    if let Some(id) = id {
        let _ = app.emit_to("shell", "overlay-closed", serde_json::json!({"id": id}));
    }
}

#[tauri::command]
pub(crate) async fn overlay_show(app: AppHandle, payload: serde_json::Value) -> Result<(), String> {
    crate::webviews::on_main_thread(&app.clone(), move || {
        let win = ensure_popup(&app)?;
        let shell = app.get_window("shell").ok_or("Нет оболочки")?;
        crate::features::debug::append_backend_log(&format!("[overlay] show id={id}", id = payload.get("id").and_then(|v| v.as_str()).unwrap_or("?")));
        let id = payload.get("id").and_then(|v| v.as_str()).ok_or("Нет идентификатора попапа")?.to_string();
        let omni = payload.get("omni").and_then(|v| v.as_bool()).unwrap_or(false);
        let number = |key: &str, fallback: f64| payload.get(key).and_then(|v| v.as_f64()).filter(|v| v.is_finite()).unwrap_or(fallback);
        let scale = shell.scale_factor().map_err(|e| e.to_string())?;
        let origin = shell.inner_position().map_err(|e| e.to_string())?;
        let shell_size = shell.inner_size().map_err(|e| e.to_string())?;
        let available_w = shell_size.width as f64 / scale;
        let available_h = shell_size.height as f64 / scale;
        let width = number("width", 320.0).clamp(180.0, 1000.0).min(available_w);
        let height = number("height", 260.0).clamp(48.0, 700.0).min(available_h);
        let x = number("x", 0.0).clamp(0.0, (available_w - width).max(0.0));
        let y = number("y", 0.0).clamp(0.0, (available_h - height).max(0.0));
        let old = app.state::<PopupState>().0.lock().unwrap().replace(id.clone());
        if let Some(old) = old.filter(|old| old != &id) {
            let _ = app.emit_to("shell", "overlay-closed", serde_json::json!({"id": old}));
        }
        win.set_focusable(!omni).map_err(|e| e.to_string())?;
        win.set_size(tauri::LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
        win.set_position(PhysicalPosition::new(origin.x + (x * scale).round() as i32, origin.y + (y * scale).round() as i32)).map_err(|e| e.to_string())?;
        let inner = if omni { payload } else {
            let mut p = payload.clone();
            if let Some(obj) = p.as_object_mut() {
                obj.insert("x".into(), serde_json::json!(0.0));
                obj.insert("y".into(), serde_json::json!(0.0));
            }
            p
        };
        win.eval(&format!("window.__apbShow({inner})")).map_err(|e| e.to_string())?;
        win.show().map_err(|e| e.to_string())?;
        if !omni { win.set_focus().map_err(|e| e.to_string())?; }
        Ok(())
    })?
}

#[tauri::command]
pub(crate) async fn overlay_hide(app: AppHandle, id: String) -> Result<(), String> {
    crate::webviews::on_main_thread(&app.clone(), move || {
        let matches = app.state::<PopupState>().0.lock().unwrap().as_deref() == Some(id.as_str());
        if matches { dismiss(&app); }
    })
}

#[tauri::command]
pub(crate) async fn overlay_action(app: AppHandle, id: String, action: String, value: Option<serde_json::Value>) -> Result<(), String> {
    crate::webviews::on_main_thread(&app.clone(), move || {
        let matches = app.state::<PopupState>().0.lock().unwrap().as_deref() == Some(id.as_str());
        if matches {
            app.state::<PopupState>().0.lock().unwrap().take();
            if let Some(win) = app.get_webview_window(POPUP_LABEL) { let _ = win.hide(); }
            let _ = app.emit_to("shell", "overlay-action", serde_json::json!({"id": id, "action": action, "value": value}));
        }
    })
}
