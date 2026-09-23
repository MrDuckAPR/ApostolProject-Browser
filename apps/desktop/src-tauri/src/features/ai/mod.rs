// Made by MrDuck
#![allow(unused_imports)]

use crate::state::{AppState, SharedState};
use tauri::{AppHandle, Emitter, Manager, State};

use apb_ai::{build_context, AiClient, ChatMessage, ContextPermissions, ContextPiece, ContextSource, ProviderConfig, UreqTransport};
pub(crate) fn ai_config_path(root: &std::path::Path) -> std::path::PathBuf {
    root.join("ai.json")
}

pub(crate) fn load_ai_config(root: &std::path::Path) -> ProviderConfig {
    std::fs::read_to_string(ai_config_path(root))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]

pub(crate) fn ai_get_config(state: tauri::State<'_, SharedState>) -> Result<ProviderConfig, String> {
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let root = guard.profiles.storage_root(active.profile.id);
    Ok(load_ai_config(&root))
}

#[tauri::command]
pub(crate) fn ai_save_config(
    state: tauri::State<'_, SharedState>,
    config: ProviderConfig,
) -> Result<(), String> {
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let root = guard.profiles.storage_root(active.profile.id);
    std::fs::write(ai_config_path(&root), serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn ai_chat(
    state: tauri::State<'_, SharedState>,
    prompt: String,
    page_title: Option<String>,
    page_content: Option<String>,
) -> Result<apb_ai::ChatReport, String> {
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let profile_root = guard.profiles.storage_root(active.profile.id);
    let config = load_ai_config(&profile_root);

    let perms = ContextPermissions::default();
    let mut pieces: Vec<ContextPiece> = Vec::new();
    if let (Some(t), Some(c)) = (page_title, page_content) {
        pieces.push(ContextPiece { source: ContextSource::Page, title: t, body: c });
    }
    let (context, stripped) = build_context(&perms, &pieces);

    let client = AiClient::new(config, UreqTransport::new());
    let mut report = client
        .chat(&[ChatMessage::user(prompt)], &context)
        .map_err(|e| e.to_string())?;
    report.secrets_blocked += stripped;
    Ok(report)
}

// ---------------------------------------------------------------------
// Бесплатный перевод страницы (без ИИ): публичный gtx-endpoint Google
// Translate — без ключа и без регистрации. Используется автономно в
// карточке перевода (ЖУРНАЛ 2026-09-20) и как запасной путь при AI.
// `source` — исходный язык (sl), по умолчанию "auto".
// ---------------------------------------------------------------------
#[tauri::command]
pub(crate) async fn translate_free(
    text: String,
    target: String,
    source: Option<String>,
) -> Result<String, String> {
    let target = normalize_gtx_lang(&target, "ru");
    let source = normalize_gtx_lang(&source.unwrap_or_else(|| "auto".to_string()), "auto");
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(30))
        .build();
    gtx_translate(&agent, &text, &target, &source)
}

/// Пакетный перевод фрагментов одной страницы (карточка перевода, ЖУРНАЛ
/// 2026-09-20): инъекционный скрипт вкладки режет текст на куски ≤1500
/// символов и шлёт их сюда пачками по 6-8 штук. Возвращает выровненный
/// списok переводов (пустая строка для пустого/упавшего сегмента — страница
/// продолжит приложение с оригиналом). Работает параллельно через пул
/// blocking-потоков, потому что ureq — синхронный клиент.
#[tauri::command]
pub(crate) async fn tr_translate_batch(
    texts: Vec<String>,
    target: String,
    source: Option<String>,
) -> Result<Vec<String>, String> {
    let target = normalize_gtx_lang(&target, "ru");
    let source = normalize_gtx_lang(&source.unwrap_or_else(|| "auto".to_string()), "auto");
    const WAVE: usize = 6;
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(30))
        .build();
    let mut out: Vec<String> = Vec::with_capacity(texts.len());
    for wave in texts.chunks(WAVE) {
        let mut handles = Vec::with_capacity(wave.len());
        for t in wave {
            let agent = agent.clone();
            let text = t.clone();
            let target = target.clone();
            let source = source.clone();
            handles.push(tauri::async_runtime::spawn_blocking(move || {
                gtx_translate(&agent, &text, &target, &source)
            }));
        }
        for h in handles {
            match h.await {
                Ok(Ok(tr)) => out.push(tr),
                _ => out.push(String::new()),
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub(crate) async fn tr_report(app: AppHandle, url: String, done: bool, count: usize) -> Result<(), String> {
    let _ = tauri::Emitter::emit(
        &app,
        "tr-page-report",
        serde_json::json!({ "url": url, "done": done, "count": count }),
    );
    Ok(())
}

fn normalize_gtx_lang(v: &str, default: &str) -> String {
    let v = v.trim();
    if v.is_empty() { default.to_string() } else { v.to_string() }
}

/// gtx-вызов Google Translate. `body[0]` = массив сегментов
/// [[перевод, оригинал, ...], ...].
fn gtx_translate(
    agent: &ureq::Agent,
    text: &str,
    target: &str,
    source: &str,
) -> Result<String, String> {
    let url = "https://translate.googleapis.com/translate_a/single";
    let resp = agent
        .get(url)
        .query("client", "gtx")
        .query("dt", "t")
        .query("sl", source)
        .query("tl", target)
        .query("q", text)
        .call()
        .map_err(|e| format!("переводчик Google недоступен: {e}"))?;
    let body = resp
        .into_json::<serde_json::Value>()
        .map_err(|e| format!("ответ переводчика: {e}"))?;
    let mut out = String::new();
    if let Some(segments) = body.get(0).and_then(|v| v.as_array()) {
        for seg in segments {
            if let Some(txt) = seg.get(0).and_then(|v| v.as_str()) {
                out.push_str(txt);
            }
        }
    }
    if out.trim().is_empty() {
        return Err("переводчик вернул пустой результат".into());
    }
    Ok(out)
}

// ---------------------------------------------------------------------
// Живые поисковые подсказки для омнибокса: официальные suggest-endpoint'ы
// у DuckDuckGo (ac), Google (complete/search) и Bing (osjson). Startpage
// публичного suggest не имеет — ведём себя как DuckDuckGo, он и так её
// аналог. Возвращаем готовые фразы; если движок недоступен — пустой список
// (омнибокс молча остаётся на локальных подсказках).
// ---------------------------------------------------------------------
#[tauri::command]
pub(crate) async fn search_suggest(query: String, engine: String) -> Result<Vec<String>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let e = engine.trim().to_ascii_lowercase();
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(5))
        .build();
    let url = match e.as_str() {
        "google" => "https://suggestqueries.google.com/complete/search",
        "bing" => "https://api.bing.com/osjson.aspx",
        // duckduckgo — как для DDG, так и для Startpage (аналог DDG)
        _ => "https://duckduckgo.com/ac/",
    };
    let mut req = agent.get(url).query("q", q);
    if e == "google" {
        // Без client=chrome Google отвечает 400 (проверено 2026-09-20);
        // legacy формат [q, [sug, ...]] сохраняется.
        req = req.query("client", "chrome").query("hl", "ru");
    }
    if e == "bing" {
        req = req.query("lang", "ru").query("query", q);
    }
    let resp = req.call().map_err(|er| er.to_string())?;
    let body: serde_json::Value = resp
        .into_json()
        .map_err(|er| format!("suggest ответ: {er}"))?;
    // Все три движка отдают [[q, [sug, ...]]] или [q, [sug, ...]]:
    // ищем массив фраз во втором элементе массива.
    let mut out: Vec<String> = Vec::new();
    if let Some(arr) = body.as_array() {
        if let Some(list) = arr.get(1).and_then(|v| v.as_array()) {
            for item in list.iter().take(5) {
                if let Some(s) = item.as_str() {
                    let s = s.trim().to_string();
                    if !s.is_empty() && !out.contains(&s) {
                        out.push(s);
                    }
                }
            }
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------
// Extensions (per-profile sandboxed installs, §10A.22-23)
// ---------------------------------------------------------------------

// Made by MrDuck