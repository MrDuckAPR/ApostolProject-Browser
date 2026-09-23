// Made by MrDuck
//! Performance tools, site permissions, browser registration and redacted diagnostics.

use crate::state::SharedState;
use crate::webviews::PageTabs;
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, serde::Serialize)]
pub(crate) struct TabMemorySample {
    id: String,
    used_bytes: u64,
    total_bytes: u64,
    dom_nodes: u64,
    sampled_at: String,
}

#[derive(Default)]
pub(crate) struct TabMemoryState(pub Mutex<HashMap<String, TabMemorySample>>);

#[tauri::command]
pub(crate) fn page_memory_report(
    webview: tauri::Webview,
    state: tauri::State<'_, TabMemoryState>,
    used_bytes: u64,
    total_bytes: u64,
    dom_nodes: u64,
) -> Result<(), String> {
    let id = webview.label().strip_prefix("page-").unwrap_or(webview.label()).to_string();
    let sample = TabMemorySample {
        id: id.clone(), used_bytes, total_bytes, dom_nodes,
        sampled_at: chrono::Utc::now().to_rfc3339(),
    };
    state.0.lock().map_err(|e| e.to_string())?.insert(id, sample);
    Ok(())
}

#[tauri::command]
pub(crate) fn tab_memory_list(
    tabs: tauri::State<'_, PageTabs>,
    memory: tauri::State<'_, TabMemoryState>,
) -> Result<serde_json::Value, String> {
    let samples = memory.0.lock().map_err(|e| e.to_string())?;
    let rows = tabs.tabs.lock().map_err(|e| e.to_string())?.iter().map(|tab| {
        let host = tauri::Url::parse(&tab.url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_else(|| "Р»РѕРєР°Р»СЊРЅР°СЏ СЃС‚СЂР°РЅРёС†Р°".into());
        let sample = samples.get(&tab.id);
        serde_json::json!({
            "id": tab.id,
            "host": host,
            "visible": tab.visible,
            "used_bytes": sample.map(|s| s.used_bytes),
            "total_bytes": sample.map(|s| s.total_bytes),
            "dom_nodes": sample.map(|s| s.dom_nodes),
            "sampled_at": sample.map(|s| s.sampled_at.clone())
        })
    }).collect::<Vec<_>>();
    Ok(serde_json::json!({"tabs": rows, "process_working_set_bytes": process_working_set()}))
}

#[cfg(target_os = "linux")]
pub(crate) fn process_working_set() -> u64 {
    std::fs::read_to_string("/proc/self/status").ok().and_then(|s| s.lines().find(|l| l.starts_with("VmRSS:"))
        .and_then(|l| l.split_whitespace().nth(1)).and_then(|n| n.parse::<u64>().ok())).unwrap_or(0) * 1024
}
#[cfg(target_os = "windows")]
pub(crate) fn process_working_set() -> u64 {
    use windows_sys::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows_sys::Win32::System::Threading::GetCurrentProcess;
    unsafe {
        let mut counters: PROCESS_MEMORY_COUNTERS = std::mem::zeroed();
        counters.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
        if K32GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb) != 0 { counters.WorkingSetSize as u64 } else { 0 }
    }
}
#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub(crate) fn process_working_set() -> u64 {
    0
}

fn run_cpu(seconds: u64) -> serde_json::Value {
    let start = Instant::now(); let deadline = start + Duration::from_secs(seconds); let mut iterations = 0u64; let mut x = 0x9e3779b97f4a7c15u64;
    while Instant::now() < deadline { for _ in 0..50_000 { x ^= x << 7; x ^= x >> 9; x = x.wrapping_mul(0x2545F4914F6CDD1D); iterations += 1; } }
    let elapsed = start.elapsed().as_secs_f64();
    serde_json::json!({"kind":"cpu","seconds":elapsed,"iterations":iterations,"million_ops_per_sec":iterations as f64/elapsed/1_000_000.0,"checksum":format!("{x:016x}")})
}
fn run_memory(seconds: u64) -> serde_json::Value {
    let start = Instant::now(); let deadline = start + Duration::from_secs(seconds); let mut buf=vec![0u8;64*1024*1024]; let mut passes=0u64; let mut checksum=0u64;
    while Instant::now() < deadline { for (i,b) in buf.iter_mut().enumerate().step_by(64) { *b=b.wrapping_add((i as u8).wrapping_add(passes as u8)); checksum=checksum.wrapping_add(*b as u64); } passes+=1; }
    let elapsed=start.elapsed().as_secs_f64(); let touched=passes.saturating_mul(buf.len() as u64/64);
    serde_json::json!({"kind":"memory","seconds":elapsed,"allocated_bytes":buf.len(),"touches_per_sec":touched as f64/elapsed,"passes":passes,"checksum":checksum})
}
fn run_disk(app:&AppHandle, seconds:u64)->Result<serde_json::Value,String>{
    let dir=crate::app::data_root(app)?.join("cache");std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;let path=dir.join("load-test.tmp");let start=Instant::now();let deadline=start+Duration::from_secs(seconds);let block=vec![0xA5u8;1024*1024];let mut bytes=0u64;
    let result=(||->Result<(),String>{let mut f=std::fs::File::create(&path).map_err(|e|e.to_string())?;while Instant::now()<deadline{f.write_all(&block).map_err(|e|e.to_string())?;bytes+=block.len() as u64;if bytes>=512*1024*1024{f.flush().map_err(|e|e.to_string())?;f.set_len(0).map_err(|e|e.to_string())?;bytes=0;}}f.sync_all().map_err(|e|e.to_string())?;Ok(())})();let elapsed=start.elapsed().as_secs_f64();let _=std::fs::remove_file(&path);result?;Ok(serde_json::json!({"kind":"disk","seconds":elapsed,"bytes_written":bytes,"mb_per_sec":bytes as f64/elapsed/1024.0/1024.0}))
}

#[tauri::command]
pub(crate) async fn performance_load_test(app:AppHandle,kind:String,seconds:Option<u64>)->Result<serde_json::Value,String>{
    let seconds=seconds.unwrap_or(3).clamp(1,10);match kind.as_str(){"cpu"=>Ok(run_cpu(seconds)),"memory"=>Ok(run_memory(seconds)),"disk"=>run_disk(&app,seconds),_=>Err("РЅРµРёР·РІРµСЃС‚РЅС‹Р№ РІРёРґ С‚РµСЃС‚Р°".into())}
}

fn permission_path(state:&SharedState)->Result<std::path::PathBuf,String>{let g=state.lock().map_err(|e|e.to_string())?;let a=g.active_or_err()?;Ok(g.profiles.storage_root(a.profile.id).join("site-permissions.json"))}
fn load_permissions(state:&SharedState)->Result<serde_json::Map<String,serde_json::Value>,String>{let path=permission_path(state)?;Ok(std::fs::read_to_string(path).ok().and_then(|s|serde_json::from_str::<serde_json::Value>(&s).ok()).and_then(|v|v.as_object().cloned()).unwrap_or_default())}
fn normalize_origin(raw:&str)->Result<String,String>{let u=tauri::Url::parse(raw).map_err(|_|"РЅРµРІРµСЂРЅС‹Р№ Р°РґСЂРµСЃ СЃР°Р№С‚Р°")?;if !matches!(u.scheme(),"http"|"https"){return Err("СЂР°Р·СЂРµС€РµРЅС‹ С‚РѕР»СЊРєРѕ http/https СЃР°Р№С‚С‹".into())}let host=u.host_str().ok_or("РІ Р°РґСЂРµСЃРµ РЅРµС‚ РґРѕРјРµРЅР°")?;Ok(match u.port(){Some(p)=>format!("{}://{}:{}",u.scheme(),host,p),None=>format!("{}://{}",u.scheme(),host)})}

#[tauri::command]
pub(crate) fn site_permissions_get(state:tauri::State<'_,SharedState>)->Result<serde_json::Value,String>{Ok(serde_json::Value::Object(load_permissions(state.inner())?))}
#[tauri::command]
pub(crate) fn site_permissions_set(state:tauri::State<'_,SharedState>,origin:String,permission:String,decision:String)->Result<(),String>{
    if !matches!(permission.as_str(),"camera"|"microphone"|"geolocation"){return Err("РЅРµРёР·РІРµСЃС‚РЅРѕРµ СЂР°Р·СЂРµС€РµРЅРёРµ".into())}if !matches!(decision.as_str(),"ask"|"allow"|"deny"){return Err("РЅРµРёР·РІРµСЃС‚РЅРѕРµ СЂРµС€РµРЅРёРµ".into())}
    let origin=normalize_origin(&origin)?;let path=permission_path(state.inner())?;let mut doc=load_permissions(state.inner())?;let row=doc.entry(origin).or_insert_with(||serde_json::json!({}));row[permission.as_str()]=serde_json::Value::String(decision);if let Some(parent)=path.parent(){std::fs::create_dir_all(parent).map_err(|e|e.to_string())?}let tmp=path.with_extension("json.tmp");std::fs::write(&tmp,serde_json::to_vec_pretty(&doc).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;#[cfg(windows)]if path.exists(){std::fs::remove_file(&path).map_err(|e|e.to_string())?;}std::fs::rename(tmp,path).map_err(|e|e.to_string())
}
#[tauri::command]
pub(crate) fn page_permission_check(webview:tauri::Webview,state:tauri::State<'_,SharedState>,permission:String)->Result<String,String>{
    if !matches!(permission.as_str(),"camera"|"microphone"|"geolocation"){return Ok("deny".into())}let origin=webview.url().ok().and_then(|u|normalize_origin(u.as_str()).ok()).unwrap_or_default();if origin.is_empty(){return Ok("deny".into())}let decision=load_permissions(state.inner())?.get(&origin).and_then(|v|v.get(&permission)).and_then(|v|v.as_str()).unwrap_or("ask").to_string();if decision=="ask"{let _=webview.app_handle().emit("site-permission-request",serde_json::json!({"origin":origin,"permission":permission}));}Ok(decision)
}

fn dir_stats(path:&Path)->(u64,u64){let mut files=0;let mut bytes=0;let Ok(rd)=std::fs::read_dir(path)else{return(0,0)};for e in rd.flatten(){let p=e.path();if p.is_dir(){let(a,b)=dir_stats(&p);files+=a;bytes+=b}else if let Ok(m)=e.metadata(){files+=1;bytes+=m.len()}}(files,bytes)}
#[tauri::command]
pub(crate) fn diagnostic_report_export(app:AppHandle,tabs:tauri::State<'_,PageTabs>,memory:tauri::State<'_,TabMemoryState>)->Result<String,String>{
    let root=crate::app::data_root(&app)?;let categories=["profiles","cache","logs","backups","downloads"].into_iter().map(|name|{let(f,b)=dir_stats(&root.join(name));(name.to_string(),serde_json::json!({"files":f,"bytes":b}))}).collect::<serde_json::Map<_,_>>();let samples=memory.0.lock().map_err(|e|e.to_string())?;let report=serde_json::json!({"format":"apb-diagnostic-v1","created_at":chrono::Utc::now().to_rfc3339(),"privacy":"No URLs, titles, usernames, file names, notes, history, cookies, secrets or absolute paths are included.","app":{"version":env!("CARGO_PKG_VERSION"),"os":std::env::consts::OS,"arch":std::env::consts::ARCH},"runtime":{"process_working_set_bytes":process_working_set(),"open_tabs":tabs.tabs.lock().map_err(|e|e.to_string())?.len(),"tab_samples":samples.values().map(|s|serde_json::json!({"used_bytes":s.used_bytes,"total_bytes":s.total_bytes,"dom_nodes":s.dom_nodes})).collect::<Vec<_>>()},"storage":categories});let dir=crate::features::downloads::download_dir_custom(&app)?.map(Into::into).unwrap_or(root.join("downloads"));std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?;let path=crate::features::downloads::unique_path(&dir,&format!("APB-Diagnostic-{}.json",chrono::Utc::now().format("%Y%m%d-%H%M%S")));std::fs::write(&path,serde_json::to_vec_pretty(&report).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;Ok(path.to_string_lossy().into_owned())
}

fn reg_add(key:&str,name:Option<&str>,value:&str)->Result<(),String>{let mut c=std::process::Command::new("reg.exe");c.args(["ADD",key,"/f"]);match name{Some(n)=>{c.args(["/v",n]);},None=>{c.arg("/ve");}};c.args(["/t","REG_SZ","/d",value]);let out=c.output().map_err(|e|e.to_string())?;if out.status.success(){Ok(())}else{Err(String::from_utf8_lossy(&out.stderr).into_owned())}}
#[tauri::command]
pub(crate) fn browser_registration_status()->Result<serde_json::Value,String>{#[cfg(windows)]{let ok=std::process::Command::new("reg.exe").args(["QUERY",r"HKCU\Software\RegisteredApplications","/v","APB"]).status().map(|s|s.success()).unwrap_or(false);return Ok(serde_json::json!({"registered":ok,"can_register":true}))}#[cfg(not(windows))]{Ok(serde_json::json!({"registered":false,"can_register":false}))}}
#[tauri::command]
pub(crate) fn browser_register()->Result<(),String>{#[cfg(windows)]{let exe=std::env::current_exe().map_err(|e|e.to_string())?.to_string_lossy().into_owned();let command=format!("\"{exe}\" \"%1\"");let root=r"HKCU\Software\Clients\StartMenuInternet\APB";reg_add(root,None,"APB")?;reg_add(&format!(r"{root}\shell\open\command"),None,&command)?;reg_add(&format!(r"{root}\Capabilities"),Some("ApplicationName"),"APB")?;reg_add(&format!(r"{root}\Capabilities"),Some("ApplicationDescription"),"ApostolProject Browser")?;reg_add(&format!(r"{root}\Capabilities\URLAssociations"),Some("http"),"APBURL")?;reg_add(&format!(r"{root}\Capabilities\URLAssociations"),Some("https"),"APBURL")?;reg_add(r"HKCU\Software\RegisteredApplications",Some("APB"),r"Software\Clients\StartMenuInternet\APB\Capabilities")?;let class=r"HKCU\Software\Classes\APBURL";reg_add(class,None,"APB URL")?;reg_add(class,Some("URL Protocol"),"")?;reg_add(&format!(r"{class}\DefaultIcon"),None,&format!("{exe},0"))?;reg_add(&format!(r"{class}\shell\open\command"),None,&command)?;Ok(())}#[cfg(not(windows))]{Err("СЂРµРіРёСЃС‚СЂР°С†РёСЏ Р±СЂР°СѓР·РµСЂР° РїРѕРґРґРµСЂР¶РёРІР°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ РІ Windows".into())}}
#[tauri::command]
pub(crate) fn browser_open_default_apps()->Result<(),String>{#[cfg(windows)]{std::process::Command::new("cmd.exe").args(["/C","start","", "ms-settings:defaultapps"]).spawn().map_err(|e|e.to_string())?;Ok(())}#[cfg(not(windows))]{Err("РґРѕСЃС‚СѓРїРЅРѕ С‚РѕР»СЊРєРѕ РІ Windows".into())}}
