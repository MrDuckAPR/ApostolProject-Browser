//! Offline E2E profile container: bookmarks + theme/settings + selected UI state.
use crate::state::SharedState;
use serde::{Deserialize,Serialize};
use tauri::AppHandle;
#[derive(Serialize,Deserialize)]struct ContainerPayload{format:String,created_at:String,profile:serde_json::Value,bookmarks:serde_json::Value,folders:serde_json::Value,settings:serde_json::Value,client_state:serde_json::Value}
#[tauri::command]
pub(crate) async fn profile_container_export(app:AppHandle,state:tauri::State<'_,SharedState>,passphrase:String,client_state:serde_json::Value)->Result<String,String>{
    let g=state.lock().unwrap();let a=g.active_or_err()?;
    let bookmarks=serde_json::to_value(a.bookmarks.all().map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let folders=serde_json::to_value(a.bookmarks.folders().map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    let profile=serde_json::to_value(&a.profile).map_err(|e|e.to_string())?;
    let settings=crate::app::data_root(&app).ok().and_then(|r|std::fs::read_to_string(r.join("settings.json")).ok()).and_then(|s|serde_json::from_str(&s).ok()).unwrap_or_else(||serde_json::json!({}));
    let payload=ContainerPayload{format:"apb-profile-payload-v1".into(),created_at:chrono::Utc::now().to_rfc3339(),profile,bookmarks,folders,settings,client_state};
    let raw=serde_json::to_vec(&payload).map_err(|e|e.to_string())?;drop(g);
    let encrypted=apb_vault::encrypt_portable(&raw,&passphrase).map_err(|e|e.to_string())?;
    let dir=crate::features::downloads::download_dir_custom(&app)?.map(std::path::PathBuf::from).or_else(||std::env::var("USERPROFILE").ok().map(|h|std::path::PathBuf::from(h).join("Downloads"))).unwrap_or(crate::app::data_root(&app)?.join("downloads"));std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    let dst=crate::features::downloads::unique_path(&dir,&format!("APB-Profile-{}.apbprofile",chrono::Utc::now().format("%Y%m%d-%H%M%S")));std::fs::write(&dst,encrypted).map_err(|e|e.to_string())?;Ok(dst.to_string_lossy().into_owned())
}
#[tauri::command]
pub(crate) async fn profile_container_decrypt(container:String,passphrase:String)->Result<serde_json::Value,String>{
    if container.len()>64*1024*1024{return Err("контейнер слишком большой".into())}
    let raw=apb_vault::decrypt_portable(&container,&passphrase).map_err(|_|"Неверная фраза или повреждённый контейнер".to_string())?;
    let value:serde_json::Value=serde_json::from_slice(&raw).map_err(|e|e.to_string())?;
    if value["format"]!="apb-profile-payload-v1"{return Err("неподдерживаемый профиль".into())}Ok(value)
}
