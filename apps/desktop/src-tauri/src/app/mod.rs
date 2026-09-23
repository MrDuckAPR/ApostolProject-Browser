//! Central application paths. APB keeps its writable state in one normal
//! operating-system application folder, never beside the installed executable.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::Manager;

static DATA_ROOT: OnceLock<PathBuf> = OnceLock::new();
const APP_FOLDER: &str = "ApostolProject Browser";
const DATA_DIRS: &[&str] = &["themes","profiles","extensions","extensions/installed","cache","cache/webview2","cache/http","logs","backups","downloads"];

fn create_layout(root: &Path) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    for dir in DATA_DIRS { std::fs::create_dir_all(root.join(dir)).map_err(|e| e.to_string())?; }
    let readme=root.join("README.txt");
    if !readme.exists() {
        std::fs::write(&readme, concat!(
            "ApostolProject Browser — папка данных приложения\n",
            "=================================================\n\n",
            "themes/              темы оформления\n",
            "profiles/            профили, история, закладки, заметки и сессии\n",
            "extensions/installed установленные расширения\n",
            "cache/webview2/      профиль и кэш WebView2\n",
            "cache/http/          сетевой кэш\n",
            "logs/                журналы диагностики\n",
            "backups/             резервные копии\n",
            "downloads/           служебные данные загрузок\n\n",
            "Не публикуйте папку: в ней могут находиться приватные данные.\n"
        )).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn operating_system_root() -> Option<PathBuf> {
    #[cfg(target_os="windows")]
    { return std::env::var_os("LOCALAPPDATA").map(PathBuf::from).map(|x| x.join(APP_FOLDER)); }
    #[cfg(target_os="macos")]
    { return std::env::var_os("HOME").map(PathBuf::from).map(|x| x.join("Library").join("Application Support").join(APP_FOLDER)); }
    #[cfg(target_os="linux")]
    {
        if let Some(x)=std::env::var_os("XDG_DATA_HOME") { return Some(PathBuf::from(x).join(APP_FOLDER)); }
        return std::env::var_os("HOME").map(PathBuf::from).map(|x| x.join(".local").join("share").join(APP_FOLDER));
    }
    #[allow(unreachable_code)] None
}

/// Runs before the first WebView2 environment is created. On Windows the
/// result is `%LOCALAPPDATA%\\ApostolProject Browser`.
pub(crate) fn prepare_system_root() -> Option<PathBuf> {
    let root=operating_system_root()?;
    create_layout(&root).ok()?;
    let webview_data=root.join("cache").join("webview2");
    #[allow(unused_unsafe)] unsafe { std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &webview_data); }
    Some(root)
}

pub(crate) fn initialize_data_root(app:&tauri::AppHandle, prepared:Option<PathBuf>) -> Result<PathBuf,String> {
    let root=match prepared { Some(x)=>x, None=>app.path().app_data_dir().map_err(|e| e.to_string())? };
    create_layout(&root)?;
    let _=DATA_ROOT.set(root.clone());
    let location=serde_json::json!({"path":root.to_string_lossy(),"kind":"system_application_data","portable":false});
    let _=std::fs::write(root.join("data-location.json"),serde_json::to_string_pretty(&location).unwrap_or_default());
    Ok(root)
}

pub(crate) fn data_root(app:&tauri::AppHandle)->Result<PathBuf,String>{
    if let Some(path)=DATA_ROOT.get(){return Ok(path.clone())}
    app.path().app_data_dir().map_err(|e|e.to_string())
}
