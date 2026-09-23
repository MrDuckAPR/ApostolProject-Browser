// Made by MrDuck
//! APB download engine: pause/resume with HTTP Range, crash recovery,
//! atomic .apbpart files, SHA-256 verification and persistent history.

use crate::state::SharedState;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct DownloadItem {
    pub(crate) id: String,
    pub(crate) url: String,
    pub(crate) file_name: String,
    pub(crate) path: String,
    pub(crate) status: String,
    #[serde(default = "unknown_progress")]
    pub(crate) progress: i64,
    #[serde(default)] pub(crate) recv: u64,
    #[serde(default)] pub(crate) total: u64,
    #[serde(default)] pub(crate) source: String,
    #[serde(default)] pub(crate) etag: String,
    #[serde(default)] pub(crate) sha256: String,
    #[serde(default)] pub(crate) error: String,
    #[serde(default)] pub(crate) resumable: bool,
    #[serde(default)] pub(crate) created_at: String,
}
fn unknown_progress() -> i64 { -1 }

pub(crate) fn unique_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let safe: String = name.chars().map(|c| if "<>:\"/\\|?*\0".contains(c) { '_' } else { c }).collect();
    let safe = safe.trim_matches(|c| c == '.' || c == ' ').trim();
    let safe = if safe.is_empty() { "download" } else { safe };
    let mut p = dir.join(safe);
    let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
    let ext = p.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
    let mut n = 1u32;
    while p.exists() || part_path(&p.to_string_lossy()).exists() {
        n += 1; p = dir.join(format!("{stem}-{n}{ext}"));
    }
    p
}
fn part_path(path: &str) -> std::path::PathBuf { std::path::PathBuf::from(format!("{path}.apbpart")) }
fn meta_path(path: &str) -> std::path::PathBuf { std::path::PathBuf::from(format!("{path}.apbmeta")) }

#[derive(Default)] pub struct DownloadsLog(pub Mutex<Vec<DownloadItem>>);
impl DownloadsLog {
    pub fn load_from_disk(app: &AppHandle) -> Self {
        let mut items: Vec<DownloadItem> = crate::app::data_root(app).ok()
            .and_then(|r| std::fs::read_to_string(r.join("downloads-log.json")).ok())
            .and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        for d in &mut items {
            if d.status == "downloading" {
                d.status = "interrupted".into();
                d.error = "Приложение было закрыто; загрузку можно продолжить".into();
                d.resumable = part_path(&d.path).exists();
            }
        }
        Self(Mutex::new(items))
    }
    pub fn save_to_disk(&self, app: &AppHandle) {
        let Ok(root)=crate::app::data_root(app) else{return};
        let Ok(g)=self.0.lock() else{return};
        let from=g.len().saturating_sub(300);
        if let Ok(json)=serde_json::to_string_pretty(&g[from..]) {
            let tmp=root.join("downloads-log.json.tmp"); let dst=root.join("downloads-log.json");
            if std::fs::write(&tmp,json).is_ok(){let _=std::fs::rename(tmp,dst);}
        }
    }
}

#[derive(Default)] pub struct DlOwnRuns {
    pub cancel: Mutex<HashSet<String>>,
    pub pause: Mutex<HashSet<String>>,
    pub active: Mutex<HashSet<String>>,
}

enum Stop { None, Pause, Cancel }
fn stop_requested(app:&AppHandle,id:&str)->Stop {
    let runs=app.state::<DlOwnRuns>();
    if runs.cancel.lock().map(|m|m.contains(id)).unwrap_or(false){Stop::Cancel}
    else if runs.pause.lock().map(|m|m.contains(id)).unwrap_or(false){Stop::Pause}
    else{Stop::None}
}
fn emit_item(app:&AppHandle,item:&DownloadItem){let _=app.emit("dl-update",item.clone());}
fn mutate_item(app:&AppHandle,id:&str,f:impl FnOnce(&mut DownloadItem))->Option<DownloadItem>{
    let log=app.state::<DownloadsLog>(); let mut g=log.0.lock().ok()?;
    let d=g.iter_mut().find(|d|d.id==id)?; f(d); Some(d.clone())
}
fn publish(app:&AppHandle,id:&str,persist:bool,f:impl FnOnce(&mut DownloadItem)){
    if let Some(d)=mutate_item(app,id,f){emit_item(app,&d);}
    if persist{app.state::<DownloadsLog>().save_to_disk(app);}
}
fn cleanup_run(app:&AppHandle,id:&str){
    let runs=app.state::<DlOwnRuns>();
    if let Ok(mut a) = runs.active.lock() { a.remove(id); };
    if let Ok(mut p) = runs.pause.lock() { p.remove(id); };
    if let Ok(mut c) = runs.cancel.lock() { c.remove(id); };
}
fn content_range_total(v:Option<&str>)->u64{
    v.and_then(|s|s.rsplit('/').next()).and_then(|s|s.parse().ok()).unwrap_or(0)
}

/// Starts or resumes one download. A partial file is preserved on pause/error.
pub(crate) fn resume_interrupted_downloads(app:&AppHandle){
    let items=app.state::<DownloadsLog>().0.lock().ok().map(|g|g.iter().filter(|d|d.status=="interrupted"&&d.resumable&&part_path(&d.path).exists()).cloned().collect::<Vec<_>>()).unwrap_or_default();
    for item in items{spawn_own_download(app,item.id,item.url,item.path,item.source)}
}

pub(crate) fn spawn_own_download(app:&AppHandle,id:String,url:String,path:String,source:String){
    {
        let runs=app.state::<DlOwnRuns>(); let Ok(mut a)=runs.active.lock() else{return};
        if !a.insert(id.clone()){return}
        if let Ok(mut p) = runs.pause.lock() { p.remove(&id); };
        if let Ok(mut c) = runs.cancel.lock() { c.remove(&id); };
    }
    publish(app,&id,true,|d|{d.status="downloading".into();d.error.clear();d.resumable=true;});
    let app=app.clone();
    std::thread::spawn(move||{
        let part=part_path(&path); let meta=meta_path(&path);
        if let Some(parent)=part.parent(){if let Err(e)=std::fs::create_dir_all(parent){
            publish(&app,&id,true,|d|{d.status="failed".into();d.error=e.to_string();});cleanup_run(&app,&id);return;
        }}
        let mut offset=std::fs::metadata(&part).map(|m|m.len()).unwrap_or(0);
        let known_etag=app.state::<DownloadsLog>().0.lock().ok().and_then(|g|g.iter().find(|d|d.id==id).map(|d|d.etag.clone())).unwrap_or_default();
        let mut req=ureq::get(&url).timeout(std::time::Duration::from_secs(120));
        if offset>0{req=req.set("Range",&format!("bytes={offset}-"));if !known_etag.is_empty(){req=req.set("If-Range",&known_etag)}}
        let resp=match req.call(){Ok(r)=>r,Err(e)=>{
            publish(&app,&id,true,|d|{d.status="failed".into();d.error=format!("Сеть: {e}");d.resumable=offset>0;});cleanup_run(&app,&id);return;
        }};
        let partial=resp.status()==206;
        if offset>0&&!partial{offset=0;let _=std::fs::remove_file(&part);}
        let content_len=resp.header("Content-Length").and_then(|v|v.parse::<u64>().ok()).unwrap_or(0);
        let total=if partial{content_range_total(resp.header("Content-Range")).max(offset+content_len)}else{content_len};
        let etag=resp.header("ETag").unwrap_or("").to_string();
        let mut hasher=Sha256::new();
        if offset>0{if let Ok(mut old)=std::fs::File::open(&part){let mut b=[0u8;65536];loop{match old.read(&mut b){Ok(0)=>break,Ok(n)=>hasher.update(&b[..n]),Err(_)=>break}}}}
        let mut file=match std::fs::OpenOptions::new().create(true).write(true).append(offset>0).truncate(offset==0).open(&part){Ok(f)=>f,Err(e)=>{
            publish(&app,&id,true,|d|{d.status="failed".into();d.error=e.to_string();});cleanup_run(&app,&id);return;
        }};
        let _=std::fs::write(&meta,serde_json::json!({"id":id,"url":url,"path":path,"etag":etag,"total":total}).to_string());
        let mut reader=resp.into_reader(); let mut done=offset; let mut buf=[0u8;131072];
        let mut last_emit=std::time::Instant::now();let mut last_persist=std::time::Instant::now();
        loop{
            match stop_requested(&app,&id){
                Stop::Cancel=>{drop(file);let _=std::fs::remove_file(&part);let _=std::fs::remove_file(&meta);publish(&app,&id,true,|d|{d.status="cancelled".into();d.error.clear();d.resumable=false;});cleanup_run(&app,&id);return},
                Stop::Pause=>{let _=file.flush();publish(&app,&id,true,|d|{d.status="paused".into();d.recv=done;d.total=total;d.error.clear();d.resumable=true;});cleanup_run(&app,&id);return},
                Stop::None=>{}
            }
            match reader.read(&mut buf){
                Ok(0)=>break,
                Ok(n)=>{if let Err(e)=file.write_all(&buf[..n]){publish(&app,&id,true,|d|{d.status="failed".into();d.error=e.to_string();d.resumable=true;});cleanup_run(&app,&id);return}
                    hasher.update(&buf[..n]);done+=n as u64;
                    if last_emit.elapsed()>=std::time::Duration::from_millis(250){
                        let pct=if total>0{(done.saturating_mul(100)/total).min(100) as i64}else{-1};
                        publish(&app,&id,last_persist.elapsed()>=std::time::Duration::from_secs(2),|d|{d.progress=pct;d.recv=done;d.total=total;d.etag=etag.clone();});
                        last_emit=std::time::Instant::now();if last_persist.elapsed()>=std::time::Duration::from_secs(2){last_persist=std::time::Instant::now()}
                    }
                },
                Err(e)=>{let _=file.flush();publish(&app,&id,true,|d|{d.status="failed".into();d.error=format!("Чтение: {e}");d.recv=done;d.total=total;d.resumable=true;});cleanup_run(&app,&id);return}
            }
        }
        if total>0&&done!=total{publish(&app,&id,true,|d|{d.status="failed".into();d.error=format!("Неполный файл: {done} из {total} байт");d.recv=done;d.total=total;d.resumable=true;});cleanup_run(&app,&id);return}
        if file.flush().is_err(){publish(&app,&id,true,|d|{d.status="failed".into();d.error="Не удалось записать файл".into();d.resumable=true;});cleanup_run(&app,&id);return}
        drop(file);let hash=format!("{:x}",hasher.finalize());
        if std::fs::rename(&part,&path).is_err(){publish(&app,&id,true,|d|{d.status="failed".into();d.error="Не удалось завершить файл".into();d.resumable=true;});cleanup_run(&app,&id);return}
        let _=std::fs::remove_file(&meta);
        publish(&app,&id,true,|d|{d.status="done".into();d.progress=100;d.recv=done;d.total=if total>0{total}else{done};d.sha256=hash;d.error.clear();d.resumable=false;});cleanup_run(&app,&id);
        let _=source;
    });
}

#[tauri::command] pub(crate) fn download_pause(app:AppHandle,id:String)->Result<(),String>{
    if !app.state::<DlOwnRuns>().active.lock().map_err(|e|e.to_string())?.contains(&id){return Err("загрузка уже не выполняется".into())}
    app.state::<DlOwnRuns>().pause.lock().map_err(|e|e.to_string())?.insert(id);Ok(())
}
#[tauri::command] pub(crate) fn download_resume(app:AppHandle,id:String)->Result<(),String>{
    let d=app.state::<DownloadsLog>().0.lock().map_err(|e|e.to_string())?.iter().find(|d|d.id==id).cloned().ok_or("загрузка не найдена")?;
    if d.status=="downloading"{return Ok(())}spawn_own_download(&app,d.id,d.url,d.path,d.source);Ok(())
}
#[tauri::command] pub(crate) fn download_retry(app:AppHandle,id:String,url:String,path:String)->Result<(),String>{
    let _=(url,path);download_resume(app,id)
}
#[tauri::command] pub(crate) fn download_cancel(app:AppHandle,id:String,path:String)->Result<(),String>{
    let active=app.state::<DlOwnRuns>().active.lock().map_err(|e|e.to_string())?.contains(&id);
    if active{app.state::<DlOwnRuns>().cancel.lock().map_err(|e|e.to_string())?.insert(id);return Ok(())}
    let _=std::fs::remove_file(part_path(&path));let _=std::fs::remove_file(meta_path(&path));
    publish(&app,&id,true,|d|{d.status="cancelled".into();d.resumable=false;d.error.clear();});Ok(())
}
#[tauri::command] pub(crate) fn downloads_clear(app:AppHandle)->Result<(),String>{
    let log=app.state::<DownloadsLog>();log.0.lock().map_err(|e|e.to_string())?.retain(|d|d.status=="downloading");log.save_to_disk(&app);Ok(())
}
#[tauri::command] pub(crate) fn downloads_list(log:tauri::State<'_,DownloadsLog>)->Result<Vec<DownloadItem>,String>{
    Ok(log.0.lock().map_err(|e|e.to_string())?.iter().rev().cloned().collect())
}
#[tauri::command] pub(crate) fn downloads_dir(state:tauri::State<'_,SharedState>,app:AppHandle)->Result<String,String>{
    if let Some(d)=download_dir_custom(&app)?{std::fs::create_dir_all(&d).map_err(|e|e.to_string())?;return Ok(d)}
    let guard=state.lock().unwrap();let active=guard.active_or_err()?;let dir=guard.profiles.storage_root(active.profile.id).join("downloads");std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;Ok(dir.to_string_lossy().into_owned())
}
pub(crate) fn download_dir_custom(app:&AppHandle)->Result<Option<String>,String>{let p=crate::app::data_root(app)?.join("downloads-dir.txt");if !p.exists(){return Ok(None)}let s=std::fs::read_to_string(p).map_err(|e|e.to_string())?.trim().to_string();Ok((!s.is_empty()).then_some(s))}
#[tauri::command] pub(crate) fn dl_dir_get(app:AppHandle)->Result<String,String>{Ok(download_dir_custom(&app)?.unwrap_or_default())}
#[tauri::command]
pub(crate) fn dl_dir_set(app: AppHandle, path: String) -> Result<(), String> {
    let p = crate::app::data_root(&app)?.join("downloads-dir.txt");
    if path.trim().is_empty() {
        let _ = std::fs::remove_file(p);
    } else {
        std::fs::create_dir_all(path.trim()).map_err(|e| e.to_string())?;
        std::fs::write(p, path.trim()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Save text to the user's Downloads folder (used for exports).
#[tauri::command]
pub(crate) fn save_text_file(name: String, contents: String) -> Result<String, String> {
    let downloads = std::env::var("USERPROFILE")
        .map(|h| std::path::PathBuf::from(h).join("Downloads"))
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());
    std::fs::create_dir_all(&downloads).map_err(|e| e.to_string())?;
    let path = unique_path(&downloads, &name);
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Save binary (base64) to the user's Downloads folder — PNG-экспорт графа.
#[tauri::command]
pub(crate) fn save_image_file(
    app: AppHandle,
    name: String,
    data_base64: String,
) -> Result<String, String> {
    let _ = app;
    let bytes = crate::util::decode_base64(&data_base64).ok_or("неверный base64")?;
    let downloads = std::env::var("USERPROFILE")
        .map(|h| std::path::PathBuf::from(h).join("Downloads"))
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_default());
    std::fs::create_dir_all(&downloads).map_err(|e| e.to_string())?;
    let path = unique_path(&downloads, &name);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// Right-click "Save image" from inside a webview. Accepts both regular
/// URLs (http/https) and `data:` URIs.  Regular URLs are downloaded with
/// our pause/resume engine and appear in the download history; `data:` URIs
/// are decoded in-place.
#[tauri::command]
pub(crate) fn page_save_image(
    app: AppHandle,
    url: String,
) -> Result<String, String> {
    // Resolve the download directory (custom dir → profile downloads → fallback).
    let dir: std::path::PathBuf = download_dir_custom(&app)?
        .map(std::path::PathBuf::from)
        .or_else(|| {
            let state = app.try_state::<SharedState>()?;
            let guard = state.lock().ok()?;
            let active = guard.active_or_err().ok()?;
            Some(guard.profiles.storage_root(active.profile.id).join("downloads"))
        })
        .ok_or("нет активного профиля")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // ---- data: URI — decode base64 directly (no network) ----
    if let Some(rest) = url.strip_prefix("data:") {
        let (_meta, b64) = rest.split_once(',').unwrap_or(("", rest));
        let bytes = crate::util::decode_base64(b64).ok_or("неверный base64 в data-URL")?;
        // Guess extension from the mime portion:  data:image/png;base64,…
        let ext = rest
            .split(';')
            .next()
            .and_then(|m| m.rsplit('/').next())
            .unwrap_or("bin");
        let name = format!("image-{ext}");
        let path = unique_path(&dir, &name);
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
        return Ok(path.to_string_lossy().into_owned());
    }

    // ---- Regular URL — infer filename and download with our engine ----
    let file_name = {
        let raw = url.split('?').next().unwrap_or(&url);
        let path_part = raw.rsplit('/').next().unwrap_or("image");
        let decoded = crate::util::percent_decode(path_part)
            .unwrap_or_else(|| path_part.to_string());
        let safe: String = decoded
            .chars()
            .map(|c| if "<>:\"/\\|?*\0".contains(c) { '_' } else { c })
            .collect();
        let safe = safe.trim_matches(|c| c == '.' || c == ' ').trim();
        if safe.is_empty() {
            format!("image-{}", chrono::Utc::now().timestamp_millis())
        } else {
            safe.to_string()
        }
    };

    let path = unique_path(&dir, &file_name);
    let id = uuid::Uuid::new_v4().to_string();
    let item = DownloadItem {
        id: id.clone(),
        url: url.clone(),
        file_name: path
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.to_string_lossy().into_owned(),
        status: "downloading".into(),
        progress: -1,
        recv: 0,
        total: 0,
        source: "context-menu".into(),
        etag: String::new(),
        sha256: String::new(),
        error: String::new(),
        resumable: true,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    app.state::<DownloadsLog>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .push(item.clone());
    spawn_own_download(
        &app,
        item.id.clone(),
        item.url.clone(),
        item.path.clone(),
        item.source.clone(),
    );

    Ok(item.file_name)
}

// ---------------------------------------------------------------------
// Find-in-page — evaluate arbitrary JS inside a page tab (used to inject
// the self-contained find bar into the active webview).
// ---------------------------------------------------------------------

// Made by MrDuck