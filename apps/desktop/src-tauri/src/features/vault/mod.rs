// Made by MrDuck
//! Vault command boundary: rate limiting, inactivity lock and encrypted backups.
use crate::state::SharedState;
use apb_vault::{EntryKind, GeneratorOptions};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;

#[derive(Default)] struct Attempt { failures:u32, blocked_until:Option<Instant> }
#[derive(Default)] pub struct VaultSecurityState(Mutex<HashMap<String,Attempt>>);

fn profile_key(state:&SharedState)->Result<String,String>{Ok(state.lock().unwrap().active_or_err()?.profile.id.to_string())}
fn remaining(a:&Attempt)->u64{a.blocked_until.and_then(|x|x.checked_duration_since(Instant::now())).map(|d|d.as_secs()+1).unwrap_or(0)}
fn auto_lock_file(root:&std::path::Path)->std::path::PathBuf{root.join("vault-settings.json")}
fn read_auto_lock(root:&std::path::Path)->u64{std::fs::read_to_string(auto_lock_file(root)).ok().and_then(|s|serde_json::from_str::<serde_json::Value>(&s).ok()).and_then(|v|v["auto_lock_secs"].as_u64()).unwrap_or(300).clamp(30,86_400)}

#[tauri::command]
pub(crate) fn vault_status(state:tauri::State<'_,SharedState>,security:tauri::State<'_,VaultSecurityState>)->Result<serde_json::Value,String>{
    let key=profile_key(state.inner())?;let retry_after=security.0.lock().map_err(|e|e.to_string())?.get(&key).map(remaining).unwrap_or(0);
    let mut guard=state.lock().unwrap();let root={let a=guard.active_or_err()?;guard.profiles.storage_root(a.profile.id)};
    let active=guard.active_mut_or_err()?;
    if active.vault.as_ref().map(|v|v.is_locked()).unwrap_or(false){if let Some(v)=active.vault.as_mut(){v.lock()}active.vault=None;}
    Ok(serde_json::json!({"created":active.vault_path.exists(),"unlocked":active.vault.is_some(),"retry_after":retry_after,"auto_lock_secs":read_auto_lock(&root),"kdf":"Argon2id v1.3","salt_bytes":16,"cipher":"AES-256-GCM"}))
}

#[tauri::command]
pub(crate) async fn vault_create(state:tauri::State<'_,SharedState>,passphrase:String)->Result<(),String>{
    if passphrase.chars().count()<8{return Err("парольная фраза слишком короткая (минимум 8 символов)".into())}
    let mut guard=state.lock().unwrap();let root={let a=guard.active_or_err()?;guard.profiles.storage_root(a.profile.id)};let active=guard.active_mut_or_err()?;
    if active.vault_path.exists(){return Err("сейф уже создан".into())}
    let mut v=apb_vault::Vault::create(&active.vault_path,&passphrase).map_err(|e|e.to_string())?;v.set_auto_lock(read_auto_lock(&root));active.vault=Some(v);Ok(())
}

#[tauri::command]
pub(crate) async fn vault_unlock(state:tauri::State<'_,SharedState>,security:tauri::State<'_,VaultSecurityState>,passphrase:String)->Result<(),String>{
    let key=profile_key(state.inner())?;
    {let map=security.0.lock().map_err(|e|e.to_string())?;if let Some(a)=map.get(&key){let left=remaining(a);if left>0{return Err(format!("Слишком много попыток. Повторите через {left} сек."))}}}
    let result=(||{
        let mut guard=state.lock().unwrap();let root={let a=guard.active_or_err()?;guard.profiles.storage_root(a.profile.id)};let active=guard.active_mut_or_err()?;
        if !active.vault_path.exists(){return Err("сейф не создан".into())}if active.vault.is_some(){return Ok(())}
        let file=apb_vault::Vault::open(&active.vault_path).map_err(|e|e.to_string())?.ok_or("файл сейфа пуст")?;
        let mut vault=file.unlock(&passphrase).map_err(|_|"Неверная мастер-фраза или повреждённый сейф".to_string())?;vault.set_auto_lock(read_auto_lock(&root));active.vault=Some(vault);Ok(())
    })();
    let mut map=security.0.lock().map_err(|e|e.to_string())?;
    if result.is_ok() {
        map.remove(&key);
    } else {
        let a = map.entry(key).or_default();
        a.failures = a.failures.saturating_add(1);
        if a.failures >= 3 {
            let delay = (5u64.saturating_mul(1u64 << ((a.failures - 3).min(6)))).min(300);
            a.blocked_until = Some(Instant::now() + Duration::from_secs(delay));
        }
    }
    result
}

#[tauri::command] pub(crate) fn vault_lock(state:tauri::State<'_,SharedState>)->Result<(),String>{let mut g=state.lock().unwrap();let a=g.active_mut_or_err()?;if let Some(v)=a.vault.as_mut(){v.lock()}a.vault=None;Ok(())}
#[tauri::command] pub(crate) fn vault_touch(state:tauri::State<'_,SharedState>)->Result<(),String>{let mut g=state.lock().unwrap();g.active_mut_or_err()?.vault.as_mut().ok_or("сейф закрыт")?.touch_activity().map_err(|e|e.to_string())}
#[tauri::command] pub(crate) fn vault_set_auto_lock(state:tauri::State<'_,SharedState>,seconds:u64)->Result<(),String>{let secs=seconds.clamp(30,86_400);let mut g=state.lock().unwrap();let root={let a=g.active_or_err()?;g.profiles.storage_root(a.profile.id)};std::fs::write(auto_lock_file(&root),serde_json::json!({"auto_lock_secs":secs}).to_string()).map_err(|e|e.to_string())?;if let Some(v)=g.active_mut_or_err()?.vault.as_mut(){v.set_auto_lock(secs)}Ok(())}
#[tauri::command] pub(crate) fn vault_add_entry(state:tauri::State<'_,SharedState>,kind:EntryKind)->Result<String,String>{let mut g=state.lock().unwrap();let e=g.active_mut_or_err()?.vault.as_mut().ok_or("сейф закрыт")?.add_entry(kind).map_err(|e|e.to_string())?;Ok(e.id.to_string())}
#[tauri::command] pub(crate) fn vault_list(state:tauri::State<'_,SharedState>)->Result<Vec<(uuid::Uuid,String,String)>,String>{let mut g=state.lock().unwrap();g.active_mut_or_err()?.vault.as_mut().ok_or("сейф закрыт")?.list_summaries().map_err(|e|e.to_string())}
#[tauri::command] pub(crate) fn vault_reveal(state:tauri::State<'_,SharedState>,id:String)->Result<apb_vault::Entry,String>{let mut g=state.lock().unwrap();let uuid=uuid::Uuid::parse_str(&id).map_err(|e|e.to_string())?;g.active_mut_or_err()?.vault.as_mut().ok_or("сейф закрыт")?.reveal_entry(uuid).map_err(|e|e.to_string())}
#[tauri::command] pub(crate) fn vault_generate_password(length:Option<u16>)->Result<String,String>{apb_vault::generate_password(GeneratorOptions{length:length.unwrap_or(20).clamp(8,128) as usize,..Default::default()}).map_err(|e|e.to_string())}

fn stamp()->String{chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string()}
#[tauri::command]
pub(crate) fn vault_backup_now(app:AppHandle,state:tauri::State<'_,SharedState>)->Result<String,String>{
    let g=state.lock().unwrap();let a=g.active_or_err()?;if !a.vault_path.exists(){return Err("сейф не создан".into())}
    let dir=crate::app::data_root(&app)?.join("backups").join("vault");std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    let dst=dir.join(format!("vault-{}-{}.apbvault",a.profile.id,stamp()));std::fs::copy(&a.vault_path,&dst).map_err(|e|e.to_string())?;
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("apbvault"))
        .collect();
    files.sort_by_key(|e| e.file_name());
    while files.len() > 10 {
        if let Some(f) = files.first() {
            let _ = std::fs::remove_file(f.path());
        }
        files.remove(0);
    }
    Ok(dst.to_string_lossy().into_owned())
}
fn open_import_vault(root:&std::path::Path,container:&str,passphrase:&str)->Result<(std::path::PathBuf,apb_vault::Vault),String>{
    if container.len()>16*1024*1024{return Err("файл сейфа слишком большой".into())}
    serde_json::from_str::<serde_json::Value>(container).map_err(|_|"некорректный .apbvault файл".to_string())?;
    let path=root.join(format!("vault-import-{}.tmp",uuid::Uuid::new_v4()));
    std::fs::write(&path,container).map_err(|e|e.to_string())?;
    let opened=apb_vault::Vault::open(&path).map_err(|e|e.to_string())?.ok_or("пустой .apbvault")?;
    match opened.unlock(passphrase){Ok(v)=>Ok((path,v)),Err(e)=>{let _=std::fs::remove_file(&path);Err(e.to_string())}}
}

#[tauri::command]
pub(crate) fn vault_import_preview(state:tauri::State<'_,SharedState>,container:String,passphrase:String)->Result<serde_json::Value,String>{
    let g=state.lock().map_err(|e|e.to_string())?;let a=g.active_or_err()?;let root=g.profiles.storage_root(a.profile.id);drop(g);
    let(path,mut source)=open_import_vault(&root,&container,&passphrase)?;let list=source.list_summaries().map_err(|e|e.to_string());let _=std::fs::remove_file(path);let list=list?;
    Ok(serde_json::json!({"count":list.len(),"entries":list.into_iter().take(50).map(|(_,title,summary)|serde_json::json!({"title":title,"summary":summary})).collect::<Vec<_>>() }))
}

#[tauri::command]
pub(crate) fn vault_import_apply(state:tauri::State<'_,SharedState>,container:String,passphrase:String,conflict:Option<String>)->Result<serde_json::Value,String>{
    let mut g=state.lock().map_err(|e|e.to_string())?;let root={let a=g.active_or_err()?;g.profiles.storage_root(a.profile.id)};let(path,mut source)=open_import_vault(&root,&container,&passphrase)?;
    let imported=source.entries_for_import().map_err(|e|e.to_string());let _=std::fs::remove_file(path);let imported=imported?;let target=g.active_mut_or_err()?.vault.as_mut().ok_or("сейф закрыт")?;let mode=conflict.as_deref().unwrap_or("skip");let existing=target.list_summaries().map_err(|e|e.to_string())?;let mut by_title:HashMap<String,uuid::Uuid>=existing.into_iter().map(|(id,title,_)|(title.to_lowercase(),id)).collect();let mut added=0usize;let mut skipped=0usize;let mut replaced=0usize;
    for entry in imported{let key=entry.title().to_lowercase();if let Some(id)=by_title.get(&key).copied(){if mode=="replace"{target.delete_entry(id).map_err(|e|e.to_string())?;replaced+=1}else{skipped+=1;continue}}let created=target.add_entry(entry.kind).map_err(|e|e.to_string())?;by_title.insert(key,created.id);added+=1}
    Ok(serde_json::json!({"added":added,"skipped":skipped,"replaced":replaced}))
}

#[tauri::command]
pub(crate) fn vault_export_encrypted(app:AppHandle,state:tauri::State<'_,SharedState>)->Result<String,String>{
    let g=state.lock().unwrap();let a=g.active_or_err()?;if !a.vault_path.exists(){return Err("сейф не создан".into())}
    let dir=crate::features::downloads::download_dir_custom(&app)?.map(std::path::PathBuf::from).or_else(||std::env::var("USERPROFILE").ok().map(|h|std::path::PathBuf::from(h).join("Downloads"))).unwrap_or(crate::app::data_root(&app)?.join("downloads"));std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    let dst=crate::features::downloads::unique_path(&dir,&format!("APB-Vault-{}.apbvault",stamp()));std::fs::copy(&a.vault_path,&dst).map_err(|e|e.to_string())?;Ok(dst.to_string_lossy().into_owned())
}
