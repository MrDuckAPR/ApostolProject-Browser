// Made by MrDuck
#![allow(unused_imports)]

use crate::features::ai::load_ai_config;
use crate::network::liveprivacy::{LiveFilter, PrivacySnap};
use crate::state::{AppState, SharedState};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub(crate) fn get_privacy_overview(
    state: tauri::State<'_, SharedState>,
    filter: tauri::State<'_, Arc<LiveFilter>>,
) -> Result<serde_json::Value, String> {
    let guard = state.lock().unwrap();
    let active = guard.active_or_err()?;
    let profile_root = guard.profiles.storage_root(active.profile.id);
    let policy = active.privacy.effective_policy();
    let persona = apb_privacy::FingerprintPersona::derive(
        active.profile.id,
        policy.fingerprint_protection,
    );
    let ai_cfg = load_ai_config(&profile_root);
    let inputs = apb_privacy::AuditInputs {
        dns_encrypted: !matches!(active.network.dns.mode, apb_network::DnsMode::System),
        proxy_configured: active.network.default_chain.is_some(),
        extensions_with_broad_permissions: guard
            .extensions
            .broad_permission_count(active.profile.id),
        ai_cloud_configured: !ai_cfg.kind.is_local(),
        vault_created: active.vault_path.exists(),
    };
    let findings = apb_privacy::run_audit(&policy, &inputs);
    let snap: Arc<PrivacySnap> = filter.get();
    let live = snap.blocker.stats();
    let enforcement = {
        let st = crate::network::liveprivacy::enforce_status();
        serde_json::json!({
            "doh": st.doh,
            "upstream": st.upstream,
            "webrtc": "UDP вне прокси запрещён на уровне движка",
        })
    };
    Ok(serde_json::json!({
        "level": active.privacy.policy.level,
        "emergency": active.privacy.emergency_mode,
        "policy": active.privacy.effective_policy(),
        "dashboard": apb_privacy::fingerprint_dashboard(&policy, &persona),
        "findings": findings,
        "stats": {
            "total_blocked": live.total_blocked,
            "per_category": live.per_category,
            "per_site": top_sites(&live.per_site, 10),
            "rules": snap.blocker.rule_count(),
            "proxy_live": true,
        },
        "custom_lists": active.privacy.custom_lists,
        "site_overrides": active
            .privacy
            .site_overrides
            .iter()
            .map(|(h, o)| serde_json::json!({ "host": h, "allow_trackers": o.allow_trackers }))
            .collect::<Vec<_>>(),
        "enforcement": enforcement,
        "threats": active.privacy.threats,
    }))
}

fn top_sites(per_site: &std::collections::BTreeMap<String, u64>, n: usize) -> Vec<serde_json::Value> {
    let mut v: Vec<(String, u64)> = per_site.iter().map(|(k, c)| (k.clone(), *c)).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v.truncate(n);
    v.into_iter()
        .map(|(site, count)| serde_json::json!({ "site": site, "count": count }))
        .collect()
}

/// Live counters of the filtering proxy (network-layer blocks).
#[tauri::command]
pub(crate) fn privacy_stats(filter: tauri::State<'_, Arc<LiveFilter>>) -> Result<serde_json::Value, String> {
    let snap: Arc<PrivacySnap> = filter.get();
    let st = snap.blocker.stats();
    Ok(serde_json::json!({
        "total_blocked": st.total_blocked,
        "per_category": st.per_category,
        "per_site": top_sites(&st.per_site, 10),
        "rules": snap.blocker.rule_count(),
    }))
}

#[tauri::command]
pub(crate) fn privacy_reset_stats(filter: tauri::State<'_, Arc<LiveFilter>>) -> Result<(), String> {
    filter.get().blocker.reset_stats();
    Ok(())
}

#[tauri::command]
pub(crate) fn set_privacy_level(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    level: apb_profiles::PrivacyLevel,
) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    let active = guard.active_mut_or_err()?;
    active.privacy.policy = apb_privacy::PrivacyPolicy::for_level(level);
    // Keep the profile's own level in sync so presets survive restarts.
    active.profile.privacy_level = level;
    guard.persist_active_config()?;
    drop(guard);
    crate::network::liveprivacy::sync_from_state(&app)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn update_privacy_policy(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    policy: apb_privacy::PrivacyPolicy,
) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    let active = guard.active_mut_or_err()?;
    active.privacy.policy = policy;
    guard.persist_active_config()?;
    drop(guard);
    crate::network::liveprivacy::sync_from_state(&app)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn set_emergency_mode(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    on: bool,
) -> Result<bool, String> {
    let mut guard = state.lock().unwrap();
    {
        let active = guard.active_mut_or_err()?;
        active.privacy.emergency_mode = on;
    }
    guard.persist_active_config()?;
    let now = guard.active_or_err()?.privacy.emergency_mode;
    drop(guard);
    crate::network::liveprivacy::sync_from_state(&app)?;
    Ok(now)
}

#[tauri::command]
pub(crate) fn add_blocklist(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    name: String,
    category: apb_privacy::TrackerCategory,
    text: String,
) -> Result<usize, String> {
    let mut guard = state.lock().unwrap();
    let added = {
        let active = guard.active_mut_or_err()?;
        let n = active.blocker.add_custom_list(&text, category);
        if n > 0 {
            active.privacy.custom_lists.push(apb_privacy::CustomList { name, category, text });
        }
        n
    };
    guard.persist_active_config()?;
    drop(guard);
    crate::network::liveprivacy::sync_from_state(&app)?;
    Ok(added)
}

/// Download a full filter list (hosts / AdGuard-DNS / ABP domain syntax),
/// parse domains out of it and install as a persistent per-profile custom
/// list. Re-downloading the same name REPLACES the previous copy, so
/// «обновить список» = вызвать ещё раз. Async: network I/O on a worker.
#[tauri::command]
pub(crate) async fn add_blocklist_from_url(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    name: String,
    url: String,
) -> Result<usize, String> {
    if !url.starts_with("https://") {
        return Err("URL списка должен начинаться с https://".into());
    }
    let text = ureq::get(&url)
        .timeout(std::time::Duration::from_secs(90))
        .call()
        .map_err(|e| format!("не удалось скачать список: {e}"))?
        .into_string()
        .map_err(|e| format!("не удалось прочитать список: {e}"))?;
    let domains = apb_privacy::blocklists::extract_domains(&text);
    if domains.is_empty() {
        return Err("в списке не найдено ни одного домена — проверьте URL".into());
    }
    let body = domains.join("\n");
    let category = apb_privacy::TrackerCategory::Advertising;
    let mut guard = state.lock().unwrap();
    let added = {
        let active = guard.active_mut_or_err()?;
        active.privacy.custom_lists.retain(|l| l.name != name);
        let n = active.blocker.add_custom_list(&body, category);
        active.privacy.custom_lists.push(apb_privacy::CustomList { name, category, text: body });
        n
    };
    guard.persist_active_config()?;
    drop(guard);
    crate::network::liveprivacy::sync_from_state(&app)?;
    Ok(added)
}

/// Удалить пользовательский список по имени и пересобрать базу доменов
/// из оставшихся (builtin-правила возвращаются автоматически через
/// TrackerBlocker::new). Живой фильтр синхронизируется сразу.
#[tauri::command]
pub(crate) fn remove_blocklist(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    name: String,
) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    {
        let active = guard.active_mut_or_err()?;
        let before = active.privacy.custom_lists.len();
        active.privacy.custom_lists.retain(|l| l.name != name);
        if active.privacy.custom_lists.len() == before {
            return Err(format!("список «{name}» не найден"));
        }
        let mut blocker = apb_privacy::TrackerBlocker::new();
        for l in &active.privacy.custom_lists {
            blocker.add_custom_list(&l.text, l.category);
        }
        active.blocker = blocker;
    }
    guard.persist_active_config()?;
    drop(guard);
    crate::network::liveprivacy::sync_from_state(&app)?;
    Ok(())
}

/// Site exceptions (§10A.9): allow/block a host on the network-layer
/// blocker. `host` may come as a full URL — it is sanitized down to the
/// bare domain (subdomains inherit automatically).
#[tauri::command]
pub(crate) fn site_override_set(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    host: String,
    allow: bool,
) -> Result<String, String> {
    let host = sanitize_override_host(&host)?;
    {
        let mut guard = state.lock().unwrap();
        let active = guard.active_mut_or_err()?;
        let entry = active
            .privacy
            .site_overrides
            .entry(host.clone())
            .or_insert_with(|| apb_privacy::SiteOverride::new(host.clone()));
        entry.allow_trackers = allow;
        guard.persist_active_config()?;
    }
    crate::network::liveprivacy::sync_from_state(&app)?;
    Ok(host)
}

#[tauri::command]
pub(crate) fn site_override_remove(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    host: String,
) -> Result<(), String> {
    let host = sanitize_override_host(&host)?;
    {
        let mut guard = state.lock().unwrap();
        let active = guard.active_mut_or_err()?;
        if active.privacy.site_overrides.remove(&host).is_none() {
            return Err(format!("исключение «{host}» не найдено"));
        }
        guard.persist_active_config()?;
    }
    crate::network::liveprivacy::sync_from_state(&app)?;
    Ok(())
}

/// URL/domain → bare lowercase domain. Rejects junk before it reaches the
/// blocker map.
fn sanitize_override_host(input: &str) -> Result<String, String> {
    let mut h = input.trim().to_lowercase();
    if let Some(idx) = h.find("://") {
        h = h[idx + 3..].to_string();
    }
    let h = h.split(['/', '?', '#']).next().unwrap_or("").to_string();
    let h = h.rsplit_once(':').map(|(x, _)| x.to_string()).unwrap_or(h);
    let h = h.trim_matches(['[', ']', '.']).to_string();
    if h.is_empty() || !h.contains('.') {
        return Err(format!("«{input}» не похоже на домен"));
    }
    if !h
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
        || h.contains("..")
    {
        return Err(format!("«{h}» содержит недопустимые символы"));
    }
    Ok(h)
}

// Made by MrDuck

/// Panic Button (§10A.26): wipe traces of the current session in one shot.
#[tauri::command]
pub(crate) fn panic_button(
    app: AppHandle,
    state: tauri::State<'_, SharedState>,
    filter: tauri::State<'_, Arc<LiveFilter>>,
) -> Result<Vec<String>, String> {
    let mut guard = state.lock().unwrap();
    let mut done = Vec::new();
    {
        let active = guard.active_mut_or_err()?;
        let actions = active.privacy.panic_actions;

        active.history.clear_all().map_err(|e| e.to_string())?;
        done.push("история текущей сессии очищена".into());

        active.blocker.reset_stats();
        filter.get().blocker.reset_stats();
        done.push("счётчики блокировок сброшены".into());

        if actions.clear_all_temporary_data || actions.close_anonymous_session {
            if active.vault.is_some() {
                if let Some(v) = active.vault.as_mut() {
                    v.lock();
                }
                active.vault = None;
                done.push("сейф заблокирован".into());
            }
        }

        active.privacy.emergency_mode = true;
        done.push("Emergency Privacy Mode включён".into());
    }
    guard.persist_active_config()?;
    drop(guard);
    crate::network::liveprivacy::sync_from_state(&app)?;
    Ok(done)
}

// ---------------------------------------------------------------------
// Network (§10A.6 — DoH/DoT, proxy chains, route preview)
// ---------------------------------------------------------------------

// Made by MrDuck