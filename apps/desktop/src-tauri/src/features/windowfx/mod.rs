// Made by MrDuck
//! Прозрачность/стекло окна браузера: юзер может сделать окно полностью
//! прозрачным с системным блюром (Acrylic/Blur — видно рабочий стол) или
//! отдельные слои UI — стеклом (CSS apb-glass). Окно обязано быть
//! transparent С МОМЕНТА СОЗДАНИЯ (Windows не даёт включить WS_EX_LAYERED
//! + effects на живом окне надёжно) — поэтому строим окно прозрачным
//! всегда, а «обычный» вид возвращаем командой: полностью непрозрачный
//! бэкграунд без эффектов.

use tauri::{AppHandle, Manager};

/// Режим прозрачности окна. "off" — обычное окно, "blur" — системный
/// блюр за прозрачным окном (Windows 10: Blur, 11: Acrylic; за окном
/// видно рабочий стол и другие окна), "clear" — просто прозрачное
/// (фон UI остаётся своим, сквозь пустоты видно рабочий стол).
#[tauri::command]
pub(crate) fn window_transparency(app: AppHandle, mode: String, is_light: Option<bool>) -> Result<(), String> {
    let light = is_light.unwrap_or(false);
    let Some(win) = app.get_webview_window("shell") else {
        return Err("окно не найдено".into());
    };
    match mode.as_str() {
        "off" => {
            // вернуть обычный вид: движок красит своим цветом, эффекты прочь
            let _ = win.set_effects(None::<tauri::utils::config::WindowEffectsConfig>);
            let c = if light { tauri::utils::config::Color(255, 255, 255, 255) } else { tauri::utils::config::Color(0, 0, 0, 255) };
            let _ = win.set_background_color(Some(c));
        }
        "mica" | "acrylic" | "blur" => {
            let _ = win.set_background_color(Some(tauri::utils::config::Color(0, 0, 0, 0)));
            let effect = match mode.as_str() {
                "mica" => tauri::window::Effect::Mica,
                "acrylic" => tauri::window::Effect::Acrylic,
                _ => tauri::window::Effect::Blur,
            };
            let alpha = if mode == "mica" { 150 } else { 175 };
            let tint = if light { tauri::window::Color(244, 246, 252, alpha) } else { tauri::window::Color(18, 18, 24, alpha) };
            let effects = tauri::window::EffectsBuilder::new().effects([effect])
                .state(tauri::window::EffectState::Active)
                .color(tint).build();
            let _ = win.set_effects(Some(effects));
        }
        "clear" => {
            // чистая прозрачность без системного блюра: подложка движка
            // прозрачна, за окном виден рабочий стол как есть
            let _ = win.set_background_color(Some(tauri::utils::config::Color(0, 0, 0, 0)));
            let _ = win.set_effects(None::<tauri::utils::config::WindowEffectsConfig>);
        }
        _ => return Err("режим: off | mica | acrylic | blur | clear".into()),
    }
    Ok(())
}
