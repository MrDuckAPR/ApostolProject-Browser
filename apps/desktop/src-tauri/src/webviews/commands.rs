// Made by MrDuck
#![allow(unused_imports)]

use crate::webviews::PageTab;
use crate::features::debug::append_backend_log;
use tauri::{WebviewBuilder, WebviewUrl};
use crate::state::{AppState, SharedState};
use tauri::{AppHandle, Manager, State};

use tauri::{Emitter, LogicalPosition, LogicalSize, Position, Rect, Window};
use crate::webviews::{content_rect, relayout, on_main_thread, page_rect, PageTabs, HIDDEN_RECT};
use crate::features::downloads::{download_dir_custom, unique_path, DownloadItem, DownloadsLog};
use crate::features::history::invoke_record_visit;
#[tauri::command]
pub(crate) async fn page_eval(app: AppHandle, id: String, js: String) -> Result<(), String> {
    let label = {
        let tabs = app.state::<PageTabs>();
        let guard = tabs.tabs.lock().unwrap();
        guard
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.label.clone())
            .ok_or_else(|| "вкладка не найдена".to_string())?
    };
    let app_for_main = app.clone();
    on_main_thread(&app, move || {
        let wv = app_for_main
            .get_webview(&label)
            .ok_or_else(|| "вкладка не найдена".to_string())?;
        wv.eval(&js).map_err(|e| e.to_string())
    })?
}

// Релей горячих клавиш из сайтов-вкладок: пока фокус в нативном вебвью,
// шелловые keydown не срабатывают. Этот скрипт инжектится В КАЖДУЮ вкладку
// (initialization_script — переживает навигации) и пересылает Ctrl+K/Ctrl+T
// в окно оболочки через shell_hotkey.
const HOTKEY_RELAY_JS: &str = r#"(function(){
  if (window.__apbHotkeyRelay) return; window.__apbHotkeyRelay = true;
  function send(k){
    try {
      // Дочерние вебвью не имеют window.__TAURI__ (есть только
      // __TAURI_INTERNALS__) — invoke зовём через неё.
      var i = window.__TAURI_INTERNALS__;
      if (i && i.invoke) i.invoke("shell_hotkey", { key: k });
    } catch(e){}
  }
  window.addEventListener("keydown", function(e){
    if (!(e.ctrlKey || e.metaKey)) return;
    var code = e.code || "";
    var k = (e.key || "").toLowerCase();
    if (code === "KeyK" || code === "KeyT" || code === "KeyF" ||
        k === "k" || k === "t" || k === "f") {
      e.preventDefault(); e.stopPropagation();
      var out = code === "KeyT" || k === "t" ? "t"
              : code === "KeyF" || k === "f" ? "f" : "k";
      send(out);
    }
  }, true);
})();"#;

// Легковесная телеметрия кучи/DOM на вкладку. За пределы страницы уходят
// только сводные счётчики; URL, заголовки и текст DOM никогда не отправляются.
const MEMORY_REPORT_JS: &str = r#"(function(){
  if(window.__apbMemoryReporter)return;window.__apbMemoryReporter=true;
  function report(){try{var m=performance.memory||{};var i=window.__TAURI_INTERNALS__;if(i&&i.invoke)i.invoke('page_memory_report',{usedBytes:Number(m.usedJSHeapSize||0),totalBytes:Number(m.totalJSHeapSize||0),domNodes:Number(document.getElementsByTagName('*').length||0)}).catch(function(){});}catch(e){}}
  setTimeout(report,1800);setInterval(report,15000);
})();"#;

// Синхронизация буфера обмена (экспериментальная настройка «Синхронизировать
// буфер обмена»). WebView2 в некоторых случаях не успевает положить скопи-
// рованный текст в системный буфер (copy + быстрый переход в другое окно).
// Шим ловит копирование (Ctrl+C, контекстное меню) и дублирует текст в
// системный буфер через команду clipboard_write. Rust-сторона проверяет
// флаг clipboard_sync и без него делает no-op — инжектить можно всегда.
const CLIPBOARD_SYNC_JS: &str = r#"(function(){
  if(window.__apbClipSync)return;window.__apbClipSync=true;
  function send(){try{
    var t=String(window.getSelection?window.getSelection():'');
    if(!t)return;
    t=t.slice(0,20000);
    var i=window.__TAURI_INTERNALS__;
    if(i&&i.invoke)i.invoke('clipboard_write',{text:t}).catch(function(){});
  }catch(e){}}
  window.addEventListener('copy',function(){setTimeout(send,0);},true);
  window.addEventListener('cut',function(){setTimeout(send,0);},true);
  window.addEventListener('keydown',function(e){
    if((e.ctrlKey||e.metaKey)&&(e.key==='c'||e.key==='C'||e.key==='x'||e.key==='X')){
      setTimeout(send,0);
    }
  },true);
})();"#;

// Origin-scoped camera, microphone and geolocation gate. The backend derives
// the origin from the calling webview, so a page cannot impersonate a site.
const SITE_PERMISSION_JS: &str = r#"(function(){
  if(window.__apbPermissionGate)return;window.__apbPermissionGate=true;
  function check(kind){try{var i=window.__TAURI_INTERNALS__;return i&&i.invoke?i.invoke('page_permission_check',{permission:kind}):Promise.resolve('deny');}catch(e){return Promise.resolve('deny')}}
  function denied(kind){return new DOMException('APB blocked '+kind+' for this site','NotAllowedError')}
  try{var g=navigator.geolocation;if(g){var get=g.getCurrentPosition.bind(g),watch=g.watchPosition.bind(g);g.getCurrentPosition=function(ok,bad,opt){check('geolocation').then(function(d){if(d==='allow')get(ok,bad,opt);else if(bad)bad({code:1,message:'Geolocation blocked by APB'})})};g.watchPosition=function(ok,bad,opt){var token=Math.floor(Math.random()*2147483647);check('geolocation').then(function(d){if(d==='allow')watch(ok,bad,opt);else if(bad)bad({code:1,message:'Geolocation blocked by APB'})});return token}}}catch(e){}
  try{var md=navigator.mediaDevices;if(md&&md.getUserMedia){var gum=md.getUserMedia.bind(md);md.getUserMedia=async function(c){if(c&&c.video&&await check('camera')!=='allow')throw denied('camera');if(c&&c.audio&&await check('microphone')!=='allow')throw denied('microphone');return gum(c)}}}catch(e){}
})();"#;

// Перехват target=_blank / window.open + КАСТОМНОЕ КОНТЕКСТНОЕ МЕНЮ внутри
// вкладок: ПКМ по ссылке/картинке показывает тёмное меню APB с «Открыть в
// новой вкладке» (нативное меню WebView2 не умеет открывать вкладки в шелле).
const NEW_TAB_RELAY_JS: &str = r#"(function(){
  if (window.__apbNewTabRelay) return; window.__apbNewTabRelay = true;
  function schemeFallback(u, focus){
    // Фолбэк без IPC: навигация на спец-схему перехватывается on_navigation
    // в Rust (false = отмена), URL открывается вкладкой в шелле.
    // apb-newtab-f: — вариант «перейти сразу» (ПКМ-меню), apb-newtab: — фоном.
    try {
      var p = focus ? "apb-newtab-f:" : "apb-newtab:";
      location.assign(p + encodeURIComponent(String(u)));
    } catch(e){}
  }
  function openInTab(u, focus){
    if (!u) return null;
    try {
      var i = window.__TAURI_INTERNALS__;
      if (i && i.invoke) {
        // ВАЖНО: invoke() может реджектнуться (ACL запретил команду для
        // remote-origin, аргумент не прошёл валидацию и т.п.) — раньше
        // reject тут никак не обрабатывался и вкладка просто не
        // открывалась без единой ошибки на экране. Теперь при reject
        // едем в schemeFallback вместо тишины.
        var p = i.invoke("shell_open_tab", { url: String(u), focus: !!focus });
        if (p && typeof p.catch === "function") {
          p.catch(function(err){
            try { console.error("[apb] shell_open_tab failed:", err); } catch(e2){}
            schemeFallback(u, focus);
          });
        }
        return null;
      }
    } catch(e){}
    schemeFallback(u, focus);
    return null;
  }
  var nativeWindowOpen = window.open.bind(window);
  window.open = function(u, name, features){
    try {
      var s = String(u == null ? "" : u);
      var n = String(name || "");
      var f = String(features || "");
      // OAuth, banking and other sign-in flows require a real secondary
      // window with window.opener/postMessage. Named or explicitly-sized
      // windows therefore stay native instead of being converted to a tab.
      var realPopup = (n && n !== "_blank") || /(^|,)(popup|width|height|left|top)=?/i.test(f) || !s || s === "about:blank";
      if (realPopup) return nativeWindowOpen(u, name, features);
      if (s && n === "_blank") { openInTab(s, true); return null; }
      return nativeWindowOpen(u, name, features);
    } catch(e){ try { return nativeWindowOpen(u, name, features); } catch(_) { return null; } }
  };
  document.addEventListener("click", function(e){
    try {
      if (e.defaultPrevented || e.button !== 0) return;
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      var tgt = a.getAttribute("target") || "";
      var plainBlank = tgt === "_blank" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
      var ctrlOpen = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
      if (plainBlank || ctrlOpen) {
        e.preventDefault(); e.stopPropagation();
        // ПРАВИЛО ЮЗЕРА: левый клик по target=_blank — СРАЗУ перейти
        // (юзер выбрал эту ссылку); Ctrl+клик — «в новую вкладку без
        // перехода», как и ПКМ-меню (см. ниже) — открываем фоном.
        openInTab(a.href, plainBlank);
      }
    } catch(err){}
  }, true);

  // ---- Кастомное контекстное меню (ссылки и картинки) ----
  var ctx = null;
  function closeCtx(){
    if (!ctx) return;
    ctx.remove(); ctx = null;
    document.removeEventListener("pointerdown", ctxDown, true);
    window.removeEventListener("keydown", ctxKey, true);
  }
  function ctxDown(e){ if (ctx && !ctx.contains(e.target)) closeCtx(); }
  function ctxKey(e){ if (e.key === "Escape") closeCtx(); }
  function copyText(s){ try { navigator.clipboard.writeText(s); } catch(e){} }
  function saveImage(src) {
    try {
      var i = window.__TAURI_INTERNALS__;
      if (!i || !i.invoke) return;
      if (src.indexOf("blob:") === 0) {
        fetch(src).then(function(r){ return r.blob(); }).then(function(b){
          var rd = new FileReader();
          rd.onload = function(){ try { i.invoke("page_save_image", { url: rd.result }).catch(function(){}); } catch(e){} };
          rd.readAsDataURL(b);
        }).catch(function(){}); return;
      }
      i.invoke("page_save_image", { url: src }).catch(function(){});
    } catch(e){}
  }
  function openCtx(e, items){
    closeCtx();
    ctx = document.createElement("div");
    ctx.style.cssText = "position:fixed;z-index:2147483647;min-width:220px;padding:6px;"
      + "background:rgba(15,15,21,.94);backdrop-filter:blur(20px) saturate(150%);"
      + "-webkit-backdrop-filter:blur(20px) saturate(150%);"
      + "border:1px solid rgba(127,176,255,.25);border-radius:12px;"
      + "box-shadow:0 12px 40px rgba(0,0,0,.5);font:12.5px system-ui,sans-serif;color:#ececf1;";
    for (var i = 0; i < items.length; i++) {
      (function(it){
        if (it.sep) {
          var hr = document.createElement("div");
          hr.style.cssText = "height:1px;background:rgba(255,255,255,.12);margin:4px 8px";
          ctx.appendChild(hr);
          return;
        }
        var b = document.createElement("button");
        b.textContent = it.label;
        b.style.cssText = "display:block;width:100%;text-align:left;padding:8px 12px;"
          + "background:none;border:none;border-radius:8px;color:inherit;font:inherit;"
          + "cursor:pointer;white-space:nowrap";
        b.onmouseenter = function(){ b.style.background = "rgba(255,255,255,.10)"; };
        b.onmouseleave = function(){ b.style.background = "none"; };
        b.onclick = function(){ closeCtx(); try { it.fn(); } catch(e){} };
        ctx.appendChild(b);
      })(items[i]);
    }
    document.documentElement.appendChild(ctx);
    var mw = ctx.offsetWidth || 220, mh = ctx.offsetHeight || 120;
    ctx.style.left = Math.max(4, Math.min(e.clientX, window.innerWidth - mw - 8)) + "px";
    ctx.style.top = Math.max(4, Math.min(e.clientY, window.innerHeight - mh - 8)) + "px";
    setTimeout(function(){
      document.addEventListener("pointerdown", ctxDown, true);
      window.addEventListener("keydown", ctxKey, true);
    }, 0);
  }
  document.addEventListener("contextmenu", function(e){
    try {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      var img = e.target && e.target.closest ? e.target.closest("img") : null;
      var items = [];
      if (a) {
        const href = a.href || "";
        if (href && href.indexOf("javascript:") !== 0) {
          // ПРАВИЛО ЮЗЕРА (инверсно к Chrome): ПКМ «Открыть в новой вкладке» =
          // открыть ФОНОМ, не уходить со страницы. Левый клик по target=
          // _blank (обработчик выше) — наоборот, сразу перейти.
          items.push({ label: "🔗 Открыть в новой вкладке", fn: function(){ openInTab(href, false); } });
          items.push({ label: "📋 Копировать адрес ссылки", fn: function(){ copyText(href); } });
        }
      }
      if (img) {
        const src = img.currentSrc || img.src || "";
        if (src) {
          if (items.length) items.push({ sep: true });
          items.push({ label: "🖼 Открыть изображение в новой вкладке", fn: function(){ openInTab(src, false); } });
          items.push({ label: "💾 Сохранить изображение", fn: function(){ saveImage(src); } });
          items.push({ label: "📋 Копировать адрес изображения", fn: function(){ copyText(src); } });
        }
      }
      // Выделенный текст — копировать как отдельный пункт.
      var selText = "";
      try { var selObj = window.getSelection(); selText = selObj ? String(selObj).trim() : ""; } catch(e){}
      if (selText && selText.length < 5000) {
        if (items.length) items.push({ sep: true });
        items.push({ label: "📋 Копировать выделенное", fn: function(){ copyText(selText); } });
      }
      if (!items.length) return; // не ссылка/картинка/текст — нативное меню как раньше
      e.preventDefault(); e.stopPropagation();
      openCtx(e, items);
    } catch(err){}
  }, true);
})();"#;

// Запоминание позиции видео: главный <video> страницы пишет currentTime в
// localStorage, при повторном открытии ролик продолжается с места остановки
// (в т.ч. после рестарта браузера). Короткие видео (<90с, реклама) не
// трогаем — иначе восстановление ломает рекламные ролики YouTube.
const VIDEO_RESUME_JS: &str = r#"(function(){
  if (window.__apbVideoResume) return; window.__apbVideoResume = true;
  // Ключ считаем В МОМЕНТ записи/чтения: YouTube и прочие SPA меняют URL
  // без перезагрузки страницы — ключ, вычисленный один раз, цеплял бы
  // позицию не к тому ролику. ПРОБЛЕМА, найденная у юзера: обычный
  // origin+pathname для всех роликов одинаков ("/watch"), а полный
  // search — НЕСТАБИЛЕН: YouTube сам добавляет/переставляет параметры
  // (pp, embeds, cbrd...), поэтому ключ «на сохранении» расходился с
  // ключом «при загрузке» ровно для того же ролика → время не находилось.
  // ФИКС: ключ строится строго по ИДЕНТИЧНОСТИ ролика — для /watch берём
  // ТОЛЬКО ?v=<id>, всё остальное выкидываем; shorts/live/embed уже
  // уникальны самим pathname (в нём id). Спам-параметры не влияют на ключ.
  function key(){
    try {
      var u = new URL(location.href);
      if (u.pathname === "/watch") {
        var v7 = u.searchParams.get("v");
        if (v7) return "apb-video-pos:" + u.origin + "/watch?v=" + v7;
      }
      u.searchParams.delete("t");
      return "apb-video-pos:" + u.origin + u.pathname + (u.search ? u.search : "");
    } catch(e){
      return "apb-video-pos:" + location.origin + location.pathname;
    }
  }
  // Диагностика в журнал бэкенда (метка [page]). Толстые строки не шлём —
  // только факты и цифры, чтобы по apb\logs\shell-debug.log понять, что
  // видит страница (p-push: записал/пропустил, p-restore: есть/нет/применил).
  function diag(m){
    try { var i = window.__TAURI_INTERNALS__; if (i && i.invoke) i.invoke("page_diag", { msg: m }).catch(function(){}); } catch(e){}
  }
  function mainVideo(){
    var vs = document.querySelectorAll("video");
    var best = null, bestA = 0;
    for (var i = 0; i < vs.length; i++) {
      var a = (vs[i].videoWidth * vs[i].videoHeight) || (vs[i].clientWidth * vs[i].clientHeight);
      if (a > bestA) { bestA = a; best = vs[i]; }
    }
    return best;
  }
  function resumable(v){
    return v && (!isFinite(v.duration) || v.duration >= 90);
  }
  var lastSaveDiag = 0;
  function save(v){
    try {
      if (!resumable(v)) return; // реклама/короткие вставки не трогаем
      var t = v.currentTime || 0;
      var nearEnd = isFinite(v.duration) && t >= v.duration - 10;
      if (t > 5 && !nearEnd) {
        localStorage.setItem(key(), String(Math.floor(t)));
        var now = Date.now();
        if (now - lastSaveDiag > 20000) { lastSaveDiag = now; diag("push k=" + key() + " t=" + Math.floor(t)); }
      } else if (t <= 5) {
        localStorage.removeItem(key());
      }
    } catch(e){}
  }
  function restore(v){
    // Диагностику держим В САМОМ НАЧАЛЕ (до resumable): если restore вообще
    // вызывается, но молча выходит на resumable()===false (duration ещё 0/NaN/
    // короткое на этапе, когда видео только появилось в DOM), без diag мы бы
    // ничего не узнали. Теперь видно каждый вызов и причину пропуска.
    try { if (!v.__apbDiag) diag("restore-call ct=" + Math.floor(v.currentTime) + " dur=" + (isFinite(v.duration) ? Math.floor(v.duration) : "inf") + " ready=" + v.readyState); } catch(e){}
    try {
      if (!resumable(v)) return;
      var kkey = key();
      var t = parseFloat(localStorage.getItem(kkey) || "0") || 0;
      if (t > 5 && v.currentTime < 5 && (!isFinite(v.duration) || t < v.duration - 10)) {
        v.currentTime = t;
        if (!v.__apbDiag) { v.__apbDiag = true; diag("restore k=" + kkey + " -> " + Math.floor(t)); }
      } else if (t > 5 && !v.__apbDiag) {
        v.__apbDiag = true;
        diag("restore-skip k=" + kkey + " v=" + Math.floor(t) + " ct=" + Math.floor(v.currentTime) + " dur=" + (isFinite(v.duration) ? Math.floor(v.duration) : "inf"));
      } else if (!v.__apbDiag) {
        v.__apbDiag = true;
        diag("restore-empty k=" + kkey);
      }
    } catch(e){}
  }
  var last = 0;
  setInterval(function(){
    var v = mainVideo();
    if (!v || v.paused) return;
    var now = Date.now();
    if (now - last < 4000) return;
    last = now; save(v);
  }, 2000);
  window.addEventListener("pagehide", function(){ var v = mainVideo(); if (v) save(v); });
  // НАДЁЖНЫЙ FALLBACK-ВОССТАН����ВИТЕЛЬ: события loadedmetadata/play/observer
  // у YouTube с холодного старта НЕнадёжны (video появляется поздно, к моменту
  // навешивания hook может уже проскочить нужное состояние → restore молчит,
  // это и ловили в журнале 97). Поэтому дополнительно крутим ВРЕМЕННЫЙ цикл:
  // каждые 600мс в течение ~30с берём главное <video> и, если позицию ещё не
  // восстанавливали и она реально нужна, ставим currentTime. Не зависит от
  // событий/observer вообще. __apbRestored на самом <video> не даёт зациклиться.
  (function(){
    var attempt = 0, tried = 0;
    var timer = setInterval(function(){
      attempt++;
      if (attempt > 50) { clearInterval(timer); return; }
      var v = mainVideo();
      if (!v) return;
      if (v.__apbRestored) { clearInterval(timer); return; }
      var kkey = key();
      var t = parseFloat(localStorage.getItem(kkey) || "0") || 0;
      if (t > 5 && v.currentTime < 5 && (!isFinite(v.duration) || t < v.duration - 10)) {
        tried++;
        // duration могла быть ещё 0/NaN — позволяем установить, но требование 90с
        // для НЕ-числовой длительности держим (resumable: !isFinite допускается).
        try { v.currentTime = t; } catch(e){}
        if (v.currentTime >= 5 || tried > 12) { v.__apbRestored = true; clearInterval(timer); }
        else if (tried === 1) diag("fallback-restore t=" + Math.floor(t) + " current=" + Math.floor(v.currentTime));
      } else if (v.currentTime >= 5 || !(t > 5)) {
        clearInterval(timer);
      }
    }, 600);
  })();
  // SPA-навигация (pushState): YouTube подменяет ролик без перезагрузки —
  // после смены URL пробуем восстановить позицию уже нового видео.
  function hook(v){
    if (v.__apbVp) return; v.__apbVp = true;
    v.addEventListener("loadedmetadata", function(){ v.__apbRestored = false; restore(v); });
    v.addEventListener("play", function(){ if (!v.__apbRestored) { v.__apbRestored = true; restore(v); } });
    if (v.readyState >= 1) restore(v);
    v.addEventListener("pause", function(){ save(v); });
    v.addEventListener("seeked", function(){ save(v); });
  }
  try {
    var mo = new MutationObserver(function(){ document.querySelectorAll("video").forEach(hook); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch(e){}
  try {
    var ps = history.pushState;
    history.pushState = function(){ var r = ps.apply(this, arguments); setTimeout(function(){ document.querySelectorAll("video").forEach(function(v){ v.__apbVp = false; v.__apbRestored = false; }); }, 60); return r; };
    window.addEventListener("popstate", function(){ setTimeout(function(){ document.querySelectorAll("video").forEach(function(v){ v.__apbVp = false; v.__apbRestored = false; }); }, 60); });
  } catch(e){}
  document.querySelectorAll("video").forEach(hook);
})();"#;

// Кинорежим ютуба («широкий экран»): в обычных браузерах раз включённый —
// держится «навсегда, для любого ролика». Сам YouTube хранит это состояние
// в JS-конфигурации плеера нестабильно, поэтому у нас при открытии нового
// ролика (особенно с холодного старта) раскладка каждый раз стартует с
// дефолтной. Решение без сторонних API: запоминаем ВЫБОР юзера (кнопка
// `button.ytp-size-button` = переключатель «кинорежим», состояние видно по
// атрибуту `theater` на ytd-watch-flexy) в localStorage и, если на экране
// плеер не в том режиме, незаметно кликаем кнопку один раз. Работает и для
// SPA-переходов между роликами, и для холодной загрузки страницы ролика.
const THEATER_KEEP_JS: &str = r#"(function(){
  if (window.__apbTheater) return; window.__apbTheater = true;
  var PREF = "apb-theater";
  function diag(m){
    try { var i = window.__TAURI_INTERNALS__; if (i && i.invoke) i.invoke("page_diag", { msg: m }).catch(function(){}); } catch(e){}
  }
  function flexy(){ return document.querySelector("ytd-watch-flexy"); }
  function theaterOn(){
    var f = flexy();
    return !!(f && (f.hasAttribute("theater") || (f.className || "").indexOf("theater") !== -1));
  }
  function desired(){
    try { return localStorage.getItem(PREF) === "1"; } catch(e){ return false; }
  }
  function store(v){
    try { localStorage.setItem(PREF, v ? "1" : "0"); } catch(e){}
  }
  // Текущий выбор юзера фиксируем в момент его собственного переключения.
  function hookSizeButton(){
    try {
      var b = document.querySelector("button.ytp-size-button");
      if (b && !b.__apbTh) {
        b.__apbTh = true;
        b.addEventListener("click", function(){ setTimeout(function(){ store(theaterOn()); }, 400); });
      }
    } catch(e){}
  }
  function apply(){
    var f = flexy();
    if (!f) return;
    var cur = theaterOn();
    var want = desired();
    if (cur === want) return;
    hookSizeButton();
    var b = document.querySelector("button.ytp-size-button");
    if (b) b.click();
  }
  // SPA-переходы: yt-navigate-finish + наблюдение за появлением плеера.
  document.addEventListener("yt-navigate-finish", function(){ setTimeout(apply, 700); });
  try {
    var mo = new MutationObserver(function(){ hookSizeButton(); apply(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch(e){}
  // Холодная загрузка: несколько попыток с нарастающей задержкой.
  [0, 200, 800, 2000, 4000].forEach(function(d){ setTimeout(apply, d); });
  // УПОРСТВО: состояние ютуба нестабильно, одного клика может не хватить
  // (кнопка появляется позже, flexy ещё без атрибута at-theather). Крутим
  // цикл каждые 1.5с в течение ~30с: если расхождение «хочу-факт» есть и
  // кнопка в DOM — кликаем; останавливаемся, когда совпало. Ниже желаемое
  // ни разу не перетирается — юзер-выбор в записи переключателя сохраняется.
  (function(){
    var n = 0;
    var timer = setInterval(function(){
      n++;
      if (n > 20) { clearInterval(timer); return; }
      var f = flexy();
      if (!f) return;
      if (theaterOn() === desired()) { clearInterval(timer); return; }
      hookSizeButton();
      var b = document.querySelector("button.ytp-size-button");
      if (b) { b.click(); diag("theater-click want=" + (desired() ? "1" : "0")); }
    }, 1500);
  })();
  // Диагностика для юзера/лога: показываем, что видим (flexy есть/нет,
  // текущий театр-статус, желаемое, кнопка есть/нет) сразу при старте.
  try {
    var ff = flexy();
    diag("theater-init flexy=" + (ff ? "yes" : "no") + " cur=" + (theaterOn() ? "1" : "0") + " want=" + (desired() ? "1" : "0") + " btn=" + (document.querySelector("button.ytp-size-button") ? "yes" : "no"));
  } catch(e){}
})();"#;

// Спа-сайты (YouTube) меняют URL через pushState без топ-навигации, поэтому
// on_navigation о URL нового ролика НЕ сообщает. Сторона страницы сама
// замечает смену location.href (pushState/replaceState/popstate/hashchange
// + лёгкий поллинг на случай экзотики) и докладывает в бэкенд через
// __TAURI_INTERNALS__.invoke → page_url_push (команда получает вебвью-автора,
// поэтому id эмитится голым, как и остальные события). Схема-none,
// навигацию НЕ трогаем — только invoke (location.assign на apb-* уже один
// раз ломал страницы). Если invoke вдруг недоступен — сценарий молча
// вырубается, URL просто останется старым (названия продолжают работать
// через on_document_title_changed).
const URL_CHANGE_JS: &str = r#"(function(){
  if (window.__apbUrlPush) return; window.__apbUrlPush = true;
  function report(){
    try {
      var h = location.href;
      if (h === window.__apbLastUrl) return;
      window.__apbLastUrl = h;
      var i = window.__TAURI_INTERNALS__;
      if (i && i.invoke) i.invoke("page_url_push", { url: h }).catch(function(){});
    } catch(e){}
  }
  try {
    var ps = history.pushState, rs = history.replaceState;
    history.pushState = function(){ var r = ps.apply(this, arguments); report(); return r; };
    history.replaceState = function(){ var r = rs.apply(this, arguments); report(); return r; };
  } catch(e){}
  window.addEventListener("popstate", report);
  window.addEventListener("hashchange", report);
  setInterval(report, 1200);
  var base = document.title;
  try {
    var t0 = new MutationObserver(function(){ if (document.title !== base) { report(); base = document.title; } });
    t0.observe(document.querySelector("head") || document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  } catch(e){}
})();"#;

#[tauri::command]
pub(crate) async fn page_url_push(webview: tauri::Webview, url: String) -> Result<(), String> {
    if url.trim().is_empty() {
        return Ok(());
    }
    let raw_label = webview.label().to_string();
    let bare = raw_label
        .strip_prefix("page-")
        .unwrap_or(&raw_label)
        .to_string();
    append_backend_log(&format!("[url-push] {bare} {url}"));
    let app = webview.app_handle().clone();
    let payload = serde_json::json!({ "id": bare, "url": url });
    let _ = tauri::Emitter::emit(&app, "page-url-changed", payload);
    Ok(())
}

/// Служебный канал диагностики из СТОРОНЫ СТРАНИЦЫ в журнал бэкенда
/// (apb\logs\shell-debug.log, метка [page]). Сделан командой, как
/// page_url_push: tauri сам подставляет вебвью-автора. Нужен, чтобы
/// страничные скрипты (позиция видео, кинорежим ютуба) могли доказать,
/// что происходит «на поле», не полагаясь на догадки.
#[tauri::command]
pub(crate) async fn page_diag(webview: tauri::Webview, msg: String) -> Result<(), String> {
    let raw_label = webview.label().to_string();
    let bare = raw_label
        .strip_prefix("page-")
        .unwrap_or(&raw_label)
        .to_string();
    append_backend_log(&format!("[page] {bare} {msg}"));
    Ok(())
}

#[tauri::command]
pub(crate) async fn shell_open_tab(
    app: AppHandle,
    url: String,
    focus: Option<bool>,
) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(|_| format!("неверный URL: {url}"))?;
    // focus=true (ПКМ «Открыть в новой вкладке») — юзер явно хочет перейти;
    // по умолчанию (None/false) вкладка открывается фоном, как Ctrl+клик.
    let focus = focus.unwrap_or(false);
    // Глобальные функции открывает session-ws-downloads-tabs.js (createTab).
    let js = format!(
        "window.__apbOpenTab && window.__apbOpenTab({:?}, {})",
        parsed.as_str(),
        focus
    );
    let app_for_main = app.clone();
    on_main_thread(&app, move || {
        let wv = app_for_main
            .get_webview("shell")
            .ok_or_else(|| "нет окна оболочки".to_string())?;
        wv.eval(&js).map_err(|e| e.to_string())
    })?
}

#[tauri::command]
pub(crate) async fn shell_hotkey(app: AppHandle, key: String) -> Result<(), String> {
    let ch = key
        .chars()
        .next()
        .map(|c| c.to_ascii_lowercase())
        .unwrap_or(' ');
    if !ch.is_ascii_lowercase() {
        return Err("bad hotkey".into());
    }
    // Синтетическое событие в шелле: существующие обработчики (палитра,
    // новая вкладка) отработают сами.
    let js = format!(
        "document.dispatchEvent(new KeyboardEvent('keydown',{{key:'{}',ctrlKey:true,bubbles:true,cancelable:true}}));",
        ch
    );
    let app_for_main = app.clone();
    on_main_thread(&app, move || {
        let wv = app_for_main
            .get_webview("shell")
            .ok_or_else(|| "нет окна оболочки".to_string())?;
        wv.eval(&js).map_err(|e| e.to_string())
    })?
}

// ---------------------------------------------------------------------
// Workspaces — named groups of tabs per profile (workspaces.json).
// The frontend orchestrates switching; the backend only stores the doc.
// ---------------------------------------------------------------------

// Made by MrDuck
#[tauri::command]

pub(crate) async fn page_extract_text(url: String) -> Result<serde_json::Value, String> {
    let parsed: tauri::Url = url.parse().map_err(|_| format!("неверный URL: {url}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("поддерживаются только http(s)-страницы".into());
    }
    let body = ureq::get(url.as_str())
        .set(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) APB-browser",
        )
        .timeout(std::time::Duration::from_secs(15))
        .call()
        .map_err(|e| e.to_string())?
        .into_string()
        .map_err(|e| e.to_string())?;
    let body = if body.len() > 400_000 { body[..400_000].to_string() } else { body };

    // Title
    let title = body
        .find("<title")
        .and_then(|i| body[i..].find('>').map(|j| i + j + 1))
        .and_then(|s| body[s..].find("</title>").map(|e| body[s..s + e].to_string()))
        .unwrap_or_default();

    // Crude tag strip: remove scripts/styles/tags, decode few entities
    let mut txt = body.to_string();
    for tag in ["script", "style", "noscript", "svg", "head"] {
        let open = format!("<{tag}");
        while let Some(i) = txt.to_lowercase().find(&open) {
            match txt[i..].to_lowercase().find(&format!("</{tag}>")) {
                Some(e) => {
                    let end = i + e + tag.len() + 3;
                    txt.replace_range(i..end.min(txt.len()), " ");
                }
                None => break,
            }
        }
    }
    let mut out = String::with_capacity(txt.len());
    let mut in_tag = false;
    for ch in txt.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    let out = out
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");
    let collapsed = out.split_whitespace().collect::<Vec<_>>().join(" ");
    let clipped: String = collapsed.chars().take(8000).collect();
    Ok(serde_json::json!({ "title": title.trim(), "text": clipped }))
}

// EXTENSION RUNTIME (продолжение): обёртка одного контент-скрипта.
// Скри��т исполняется в изолированной функции — наружу торчит только объект
// `apb`, чей API собран по ПРАВАМ профиля (GRANTED — локальный массив
// этой обёртки; несколько расширений на одной странице не видят права друг
// друга). Нет права = метод отсутствует/бросает понятную ошибку — никакой
// фейк-функциональности: только то, что реально реализовано (getSelection
// по current_tab/all_websites, copy по clipboard_write).
fn extension_script_wrapper(cs: &apb_extensions::ContentScript) -> String {
    use apb_extensions::Permission;
    let has = |p: Permission| cs.granted.contains(&p);

    let mut api = String::new();
    // url читается всегда — это location.href самой страницы.
    api.push_str(
        "url: function () { try { return location.href; } catch (e) { return \"\"; } },\n    ",
    );
    if has(Permission::CurrentTab) || has(Permission::AllWebsites) {
        api.push_str(
            "getSelection: function () {\n      try { return String(window.getSelection ? window.getSelection() : \"\"); } catch (e) { return \"\"; }\n    },\n    ",
        );
    }
    if has(Permission::ClipboardWrite) {
        api.push_str(
            "copy: function (text) {\n      try { return navigator.clipboard.writeText(String(text)); } catch (e) { return Promise.reject(e); }\n    },\n    ",
        );
    }
    let perms_json = serde_json::to_string(&cs.granted).unwrap_or_else(|_| "[]".into());
    let name_json = serde_json::to_string(&cs.extension_name).unwrap_or_else(|_| "\"?\"".into());
    // `</` в теле расширения не должен закрыть литерал при встраивании в
    // HTML-контекст — экранируем (в JS-строках и regex `<\/` == `</`).
    let code = cs.code.replace("</", "<\\/");
    format!(
        r#"(function () {{
  "use strict";
  try {{
    if (window.__apbExt_{id_safe}) return; // одна инжекция на документ
    window.__apbExt_{id_safe} = true;
    var GRANTED = {perms_json};
    var apb = {{
      id: "{id}",
      name: {name_json},
      granted: GRANTED.slice(),
      {api}
    }};
    window.apb = apb;
    try {{
      (function () {{
{code}
      }})();
    }} catch (e) {{
      try {{ console.error("[APB ext {id_safe}] script error:", e); }} catch (x) {{}}
    }}
  }} catch (e) {{
    try {{ console.error("[APB ext {id_safe}]", e); }} catch (x) {{}}
  }}
}})();"#,
        id_safe = cs.extension_id.replace(['-', '.'], "_"),
        id = cs.extension_id,
        name_json = name_json,
        perms_json = perms_json,
        api = api,
        code = code,
    )
}

#[tauri::command]
pub(crate) async fn page_open(app: AppHandle, url: String) -> Result<String, String> {
    page_open_impl(app, url, true).await
}

/// Background open: the new tab is created hidden and does NOT steal focus
/// (§1 of the user's request: open-in-new-tab must not switch to it).
#[tauri::command]
pub(crate) async fn page_open_bg(app: AppHandle, url: String) -> Result<String, String> {
    page_open_impl(app, url, false).await
}

async fn page_open_impl(
    app: AppHandle,
    url: String,
    focus: bool,
) -> Result<String, String> {
    let parsed: tauri::Url = url.parse().map_err(|_| format!("неверный URL: {url}"))?;
    let id = uuid::Uuid::new_v4().to_string();
    let label = format!("page-{id}");

    // Hide all current tabs before adding the new one — unless opening in
    // the background: then the currently visible tab keeps its place.
    if focus {
        let tabs = app.state::<PageTabs>();
        for t in tabs.tabs.lock().unwrap().iter_mut() {
            t.visible = false;
        }
    }
    if focus {
        relayout(&app);
    }

    let measured = {
        let tabs = app.state::<PageTabs>();
        let rect = *tabs.measured_rect.lock().unwrap();
        rect
    };
    let app_for_main = app.clone();
    let label_for_main = label.clone();
    // Голый id вкладки (page_open возвращает ИМЕННО его). События обязаны
    // нести id, иначе фронтенд tabs.find() по "page-<uuid>" промахивается
    // мимо вкладки с id "<uuid>" — заголовки и смена URL не доходили до UI
    // (корень бага «названий нет», найден по логам: [nav] идут, а вкладка
    // не находится).
    let nav_id = id.clone();

    // Fingerprint spoofing script for this profile (injected before page JS).
    // None when protection is Off — zero overhead for Standard level.
    let fingerprint_js: Option<String> = {
        let state = app.state::<crate::state::SharedState>();
        let guard = state.lock().unwrap();
        guard.active_or_err().ok().and_then(|a| {
            let pol = a.privacy.effective_policy();
            if pol.fingerprint_protection == apb_privacy::FingerprintLevel::Off {
                None
            } else {
                Some(
                    apb_privacy::FingerprintPersona::derive(a.profile.id, pol.fingerprint_protection)
                        .injection_script(),
                )
            }
        })
    };

    // Cookie/storage isolation + Referer-policy shim for this tab's snapshot
    // of the policy. Covers HTTPS traffic where the proxy cannot look inside
    // the tunnel: in cross-origin frames document.cookie is frozen (and
    // storage writes are no-ops under strict isolation), plus a
    // <meta name="referrer"> is planted for the referrer policy. Applies to
    // webviews created after the last policy change (same as fingerprint).
    let privacy_js: Option<String> = {
        let state = app.state::<crate::state::SharedState>();
        let guard = state.lock().unwrap();
        guard.active_or_err().ok().and_then(|a| {
            let pol = a.privacy.effective_policy();
            let cookie_shim =
                pol.block_third_party_cookies || pol.strict_storage_isolation;
            if !cookie_shim && pol.referrer == apb_privacy::ReferrerPolicy::Default {
                None
            } else {
                Some(privacy_shim_js(
                    pol.block_third_party_cookies,
                    pol.strict_storage_isolation,
                    pol.referrer,
                ))
            }
        })
    };

    // Cosmetic ad filtering: AdBlock-grade element hiding. When the profile
    // blocks ads, plant the full stylesheet + DOM-sweeper at document-start
    // so blocked networks leave no empty boxes. The sweeper *removes*
    // banner-shaped nodes and blanks media (gif/swf/flash) URLs, so static /
    // animated / flash test banners are truly gone (clientWidth/Height → 0).
    // Single always-on AdBlock-style mode — no mild/aggressive switch.
    let cosmetic_js: Option<String> = {
        let state = app.state::<crate::state::SharedState>();
        let guard = state.lock().unwrap();
        guard
            .active_or_err()
            .ok()
            .filter(|a| a.privacy.effective_policy().block_ads)
            .map(|_| apb_privacy::blocklists::aggressive_filter_script())
    };

    // In-page request blocker (extension-grade layer): sendBeacon/fetch/XHR
    // to known ad/tracker endpoints abort in-page — the proxy can't see
    // these inside HTTPS tunnels. The full banner/flash/creative path set is
    // always active (the extension-grade mode).
    let req_js: Option<String> = {
        let state = app.state::<crate::state::SharedState>();
        let guard = state.lock().unwrap();
        guard
            .active_or_err()
            .ok()
            .filter(|a| {
                let p = a.privacy.effective_policy();
                p.block_ads || p.block_trackers
            })
            .map(|_| apb_privacy::blocklists::request_blocker_script(
                &apb_privacy::blocklists::builtin_request_patterns_aggressive(),
            ))
    };

    // EXTENSION RUNTIME (§12, "content scripts by masks"): every enabled
    // extension whose manifest `matches` cover this URL and whose granted
    // permissions allow reading the page gets its entry script injected at
    // document-start, wrapped in a sandboxed IIFE with a minimal `apb`
    // API gated by the approved permissions. Extensions that don't match
    // or lack grants are not injected at all. Registry is app-global
    // (AppState.extensions); grants are per-profile.
    let ext_scripts: Vec<apb_extensions::ContentScript> = {
        let state = app.state::<crate::state::SharedState>();
        let guard = state.lock().unwrap();
        match guard.active.as_ref() {
            Some(a) => guard
                .extensions
                .content_scripts_for(a.profile.id, parsed.as_str()),
            None => Vec::new(),
        }
    };

    on_main_thread(&app, move || -> Result<(), String> {
        let window = app_for_main.get_window("shell").ok_or_else(|| "нет окна оболочки".to_string())?;
        let (x, y, width, height) =
            measured.unwrap_or_else(|| content_rect(&window, false));
        // Сайт сам сменил страницу (клик по ссылке, редирект) — сообщаем
        // шеллу, чтобы омнибокс/история вкладки не оставались на старом URL.
        let nav_app = app_for_main.clone();
        let nav_label = label_for_main.clone();
        // Нативное меню WebView2 «Открыть ссылку в новом окне» и не пойманные
        // шимом window.open: ОС-окно НЕ создаём — просим шелл открыть вкладку.
        let mut builder = WebviewBuilder::new(&label_for_main, WebviewUrl::External(parsed))
            .background_color(tauri::utils::config::Color(0, 0, 0, 0))
            .on_navigation(move |url| {
                // Фолбэк-канал «открыть вкладкой» без IPC (если remote-invoke
                // запрещён): шим в странице ведёт на apb-newtab:<url> (фоном)
                // или apb-newtab-f:<url> (ПКМ-меню — сразу перейти), навигация
                // отменяется, URL уезжает в шелл новой вкладкой.
                if url.scheme() == "apb-newtab" || url.scheme() == "apb-newtab-f" {
                    let strip = if url.scheme() == "apb-newtab-f" {
                        "apb-newtab-f:"
                    } else {
                        "apb-newtab:"
                    };
                    let raw = url.as_str().trim_start_matches(strip);
                    // crate::util::percent_decode вместо несуществующего
                    // percent_decode_str (внешний крейт percent-encoding не
                    // подключён и нигде не импортирован — билд падал с
                    // E0425). При неудачном декодировании открываем как есть
                    // — лучше сырой URL, чем сломан��ая вкладка.
                    let target = crate::util::percent_decode(raw).unwrap_or_else(|| raw.to_string());
                    let focus = url.scheme() == "apb-newtab-f";
                    let payload = serde_json::json!({ "url": target, "focus": focus });
                    let _ = tauri::Emitter::emit(&nav_app, "page-open-tab", payload);
                    return false;
                }
                append_backend_log(&format!("[nav] {nav_label} {url}"));
                // Полноэкранная вкладка, УХОДЯЩАЯ на новый документ: её шим
                // (FULLSCREEN_RELAY_JS) переустанавливается с inFs=false, а вот
                // Rust-флаг fullscreen остался бы висеть → relayout навсегда
                // прячет все вебвью за экран (заморозка шелла). Сбрасываем.
                {
                    let tabs = nav_app.state::<PageTabs>();
                    let mut fs = tabs.fullscreen.lock().unwrap();
                    if fs.as_deref() == Some(nav_label.as_str()) {
                        *fs = None;
                        if let Some(w) = nav_app.get_window("shell") {
                            let _ = w.set_always_on_top(false);
                            let _ = w.set_fullscreen(false);
                        }
                    }
                }
                let payload = serde_json::json!({ "id": nav_id, "url": url.to_string() });
                let _ = tauri::Emitter::emit(&nav_app, "page-url-changed", payload);
                true
            })
            // Реальный заголовок страницы (<title>) — для названия сайта в
            // омнибоксе и подписей вкладок. Приходит как только WebView2
            // прогрузит документ. id — голый uuid (как page_open возвращает),
            // а не "page-"-label: фронтенд ищет вкладку ТОЛЬКО по нему.
            .on_document_title_changed(move |w, title| {
                let t = title.trim().to_string();
                let raw_label = w.label().to_string();
                let bare = raw_label
                    .strip_prefix("page-")
                    .unwrap_or(&raw_label)
                    .to_string();
                append_backend_log(&format!("[title-ev] {bare} {t}"));
                if t.is_empty() { return; }
                let app = w.app_handle().clone();
                let payload = serde_json::json!({ "id": bare, "title": t });
                let _ = tauri::Emitter::emit(&app, "page-title-changed", payload);
            })
            .on_new_window(move |_url, _features| {
                // OAuth/login-сценариям необходимы настоящий window.opener,
                // postMessage и отдельное небольшое окно. target=_blank уже
                // перехвачен скриптом выше и продолжает открываться вкладкой.
                tauri::webview::NewWindowResponse::Allow
            })
            .initialization_script(HOTKEY_RELAY_JS)
            .initialization_script(MEMORY_REPORT_JS)
            .initialization_script(SITE_PERMISSION_JS)
            .initialization_script(NEW_TAB_RELAY_JS)
            .initialization_script(VIDEO_RESUME_JS)
            .initialization_script(THEATER_KEEP_JS)
            .initialization_script(URL_CHANGE_JS)
            .initialization_script(CLIPBOARD_SYNC_JS)
            // Плееры нередко живут внутри iframe (embed и др.): шим должен
            // быть и в верхнем фрейме, и во всех вложенных (вторая инъекция
            // защищается гардом __apbFullscreenRelay).
            .initialization_script(FULLSCREEN_RELAY_JS)
            .initialization_script_for_all_frames(FULLSCREEN_RELAY_JS)
            // MUST match the shell window's args exactly (same user-data
            // folder = same WebView2 environment options requirement).
            .additional_browser_args(crate::network::liveprivacy::browser_args())
            .on_download(|webview, event| {
                let handle = webview.app_handle();
                match event {
                    tauri::webview::DownloadEvent::Requested { url, destination } => {
                        // Default: keep WebView2's suggestion (the OS Downloads
                        // folder). If the user picked a custom dir, use it.
                        let custom = handle
                            .try_state::<SharedState>()
                            .and_then(|_| crate::app::data_root(handle).ok())
                            .map(|root| root.join("downloads-dir.txt"))
                            .filter(|p| p.exists())
                            .and_then(|p| std::fs::read_to_string(p).ok())
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty());
                        let final_path = if let Some(dir) = custom {
                            let dir = std::path::PathBuf::from(&dir);
                            let _ = std::fs::create_dir_all(&dir);
                            let name = destination
                                .file_name()
                                .map(|s| s.to_string_lossy().into_owned())
                                .unwrap_or_else(|| format!("file-{}", chrono::Utc::now().timestamp_millis()));
                            unique_path(&dir, &name)
                        } else {
                            destination.clone()
                        };
                        *destination = final_path.clone();
                        let item = DownloadItem {
                            id: uuid::Uuid::new_v4().to_string(),
                            url: url.to_string(),
                            file_name: final_path
                                .file_name()
                                .map(|s| s.to_string_lossy().into_owned())
                                .unwrap_or_default(),
                            path: final_path.to_string_lossy().into_owned(),
                            status: "downloading".into(),
                            progress: -1,
                            recv: 0,
                            total: 0,
                            source: webview.label().to_string(),
                            etag: String::new(),
                            sha256: String::new(),
                            error: String::new(),
                            resumable: true,
                            created_at: chrono::Utc::now().to_rfc3339(),
                        };
                        append_backend_log(&format!("[dl] requested {} -> {}", item.url, item.path));
                        if let Ok(mut log) = handle.state::<DownloadsLog>().inner().0.lock() {
                            log.push(item.clone());
                        }
                        if let Some(dl_log) = handle.try_state::<DownloadsLog>() {
                            dl_log.save_to_disk(handle);
                        }
                        let _ = handle.emit("dl-update", item.clone());
                        // Собственный движок закачки (ureq): отдаём WebView2
                        // false = SetCancel — браузер вообще НЕ начинает
                        // качать (и не держит файл). Тянет файл наш поток:
                        // честный байтовый прогресс в dl-update, и главное —
                        // ✕ в списке загрузок убивает поток мгновенно
                        // (WebView2 в полёте не прерывается, грабля wry).
                        crate::features::downloads::spawn_own_download(
                            &handle,
                            item.id.clone(),
                            item.url.clone(),
                            item.path.clone(),
                            item.source.clone(),
                        );
                        false
                    }
                    tauri::webview::DownloadEvent::Finished { url, path: _, success } => {
                        // НИЧЕГО не делаем: все закачки ведёт собственный
                        // ureq-движок, а WebView2 мы отменяем на старте
                        // (SetCancel). Этот event стреляет именно от того
                        // SetCancel (StateChanged → state=INTERRUPTED,
                        // success=false) — старый код здесь ПОМЕЧАЛ живую
                        // ureq-закачку «failed». Статусы ставит сам движок.
                        append_backend_log(&format!("[dl] webview finished (cancelled-at-start) url={} ok={}", url, success));
                        true
                    }
                    _ => true,
                }
            });
        if let Some(js) = fingerprint_js {
            builder = builder.initialization_script(js);
        }
        if let Some(js) = privacy_js {
            builder = builder.initialization_script(js);
        }
        if let Some(js) = cosmetic_js {
            builder = builder.initialization_script(js);
        }
        if let Some(js) = req_js {
            builder = builder.initialization_script(js);
        }
        // Рантайм расширений: контент-скрипты по маскам, API по правам.
        // all_frames=true → во все фреймы, иначе только верхний.
        for cs in &ext_scripts {
            let js = extension_script_wrapper(cs);
            if cs.all_frames {
                builder = builder.initialization_script_for_all_frames(js);
            } else {
                builder = builder.initialization_script(js);
            }
        }
        let page = window
            .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        #[cfg(windows)]
        {
            let shell_hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
            let diag_label = label_for_main.clone();
            page.with_webview(move |platform| unsafe {
                let mut parent = windows::Win32::Foundation::HWND::default();
                match platform.controller().ParentWindow(&mut parent) {
                    Ok(()) => {
                        use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetWindowLongPtrW, GA_ROOT, GWL_STYLE, WS_CHILD};
                        let root = GetAncestor(parent, GA_ROOT);
                        let style = GetWindowLongPtrW(parent, GWL_STYLE) as u32;
                        append_backend_log(&format!(
                            "[embedding] {diag_label} shell={shell_hwnd:#x} parent={:#x} root={:#x} parent_is_child={} inside_shell={}",
                            parent.0 as usize, root.0 as usize, style & WS_CHILD.0 != 0, root.0 as usize == shell_hwnd
                        ));
                    }
                    Err(e) => append_backend_log(&format!("[embedding] {diag_label} ParentWindow failed: {e}")),
                }
            }).map_err(|e| e.to_string())?;
        }
        // Фоновая вкладка: сразу уводим вебвью за экран — позиция add_child
        // = rect текущей вкладки, и до первого relayout/активации фон
        // висел бы ПОВЕРХ активной страницы.
        if !focus {
            if let Some(wv) = app_for_main.get_webview(&label_for_main) {
                let _ = wv.set_bounds(HIDDEN_RECT);
            }
        }
        append_backend_log(&format!(
            "[open] {label_for_main} ok exts={} bg={}",
            ext_scripts.len(),
            !focus
        ));
        Ok(())
    })??;

    {
        let tabs = app.state::<PageTabs>();
        let mut guard = tabs.tabs.lock().unwrap();
        // Background tab: registered hidden — relayout (не вызывали) и так
        // не покажет его; при первом page_activate получит свой rect.
        guard.push(PageTab {
            id: id.clone(),
            label: label.clone(),
            url: url.clone(),
            visible: focus,
        });
    }

    invoke_record_visit(&app, &url);
    Ok(id)
}

// Made by MrDuck
#[tauri::command]
pub(crate) async fn page_navigate(app: AppHandle, id: String, url: String) -> Result<(), String> {
    let parsed: tauri::Url = url.parse().map_err(|_| format!("неверный URL: {url}"))?;
    let label = {
        let tabs = app.state::<PageTabs>();
        let guard = tabs.tabs.lock().unwrap();
        guard
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.label.clone())
            .ok_or_else(|| "вкладка не найдена".to_string())?
    };

    let app_for_main = app.clone();
    let label_for_main = label.clone();
    let script = format!("location.replace({:?})", parsed.as_str());
    on_main_thread(&app, move || -> Result<(), String> {
        let webview = app_for_main.get_webview(&label_for_main).ok_or_else(|| "вкладка не найдена".to_string())?;
        webview.eval(&script).map_err(|e| e.to_string())
    })??;

    let tabs = app.state::<PageTabs>();
    let mut g = tabs.tabs.lock().unwrap();
    if let Some(t) = g.iter_mut().find(|t| t.id == id) {
        t.url = url.clone();
    }
    drop(g);
    invoke_record_visit(&app, &url);
    Ok(())
}

#[tauri::command]
pub(crate) async fn page_activate(app: AppHandle, id: String) -> Result<(), String> {
    let tabs = app.state::<PageTabs>();
    {
        let mut guard = tabs.tabs.lock().unwrap();
        for t in guard.iter_mut() {
            t.visible = t.id == id;
        }
    }
    relayout(&app);
    Ok(())
}

// ---------------------------------------------------------------------
// Split view — две живые вкладки рядом (50/50)
// ---------------------------------------------------------------------

/// Включить разделённый экран: left_id — левая половина, right_id — правая.
#[tauri::command]
pub(crate) async fn page_split_set(
    app: AppHandle,
    left_id: String,
    right_id: String,
) -> Result<(), String> {
    if left_id == right_id {
        return Err("нужны две разные вкладки".into());
    }
    let tabs = app.state::<PageTabs>();
    {
        let guard = tabs.tabs.lock().unwrap();
        for id in [&left_id, &right_id] {
            if !guard.iter().any(|t| &t.id == id) {
                return Err(format!("вкладка не найдена: {id}"));
            }
        }
    }
    *tabs.split.lock().unwrap() = Some((left_id, right_id));
    relayout(&app);
    Ok(())
}

/// Выключить разделённый экран.
// Made by MrDuck
#[tauri::command]
pub(crate) async fn page_split_off(app: AppHandle) -> Result<(), String> {
    let tabs = app.state::<PageTabs>();
    *tabs.split.lock().unwrap() = None;
    relayout(&app);
    Ok(())
}

/// Hide every page webview — used when an internal page (settings, vault,
/// extensions) or the home screen takes over the content area.
#[tauri::command]
pub(crate) async fn page_hide_all(app: AppHandle) -> Result<(), String> {
    {
        let tabs = app.state::<PageTabs>();
        let mut guard = tabs.tabs.lock().unwrap();
        for t in guard.iter_mut() {
            t.visible = false;
        }
    }
    relayout(&app);
    Ok(())
}

/// Live-apply the current ad/tracker blocking policy to already-open tabs.
/// Initialization scripts are baked into a webview at creation time, so a
/// plain `page_navigate`/reload would re-run the OLD constants; only new
/// webviews pick up new policy. Instead we eval a toggle snippet into every
/// open http(s) tab: enabling mounts the cosmetic stylesheet + DOM sweeper
/// + request blocker, disabling pauses them (`__apbAggPaused`,
/// `__apbReqBlockOff`) and removes the cosmetic `<style>` so hidden ads
/// reappear. Returns the number of tabs patched.
#[tauri::command]
pub(crate) async fn privacy_apply_to_open_tabs(app: AppHandle) -> Result<usize, String> {
    let ads_now = {
        let state = app.state::<crate::state::SharedState>();
        let guard = state.lock().unwrap();
        let p = guard.active_or_err()?.privacy.effective_policy();
        p.block_ads || p.block_trackers
    };
    let js = if ads_now {
        let agg = apb_privacy::blocklists::aggressive_filter_script();
        let req = apb_privacy::blocklists::request_blocker_script(
            &apb_privacy::blocklists::builtin_request_patterns_aggressive(),
        );
        format!(
            "(function(){{try{{window.__apbAggPaused=false;window.__apbReqBlockOff=false;}}catch(e){{}}}})();{agg}{req}"
        )
    } else {
        "(function(){try{window.__apbAggPaused=true;window.__apbReqBlockOff=true;var s=document.getElementById('apb-cosmetic');if(s&&s.parentNode)s.parentNode.removeChild(s);}catch(e){}})();"
            .to_string()
    };
    let targets = {
        let tabs = app.state::<PageTabs>();
        let guard = tabs.tabs.lock().unwrap();
        guard
            .iter()
            .filter(|t| {
                let u = t.url.as_str();
                u.starts_with("http://") || u.starts_with("https://")
            })
            .map(|t| t.label.clone())
            .collect::<Vec<_>>()
    };
    let wapp = app.clone();
    on_main_thread(&app, move || {
        let mut n = 0usize;
        for label in &targets {
            if let Some(wv) = wapp.get_webview(label) {
                if wv.eval(&js).is_ok() {
                    n += 1;
                }
            }
        }
        Ok(n)
    })?
}

#[tauri::command]
pub(crate) async fn page_close(app: AppHandle, id: String) -> Result<bool, String> {
    let tabs = app.state::<PageTabs>();
    // Если закрыли члена сплита — сплит распадается, партнёр остаётся видимым
    {
        let mut split = tabs.split.lock().unwrap();
        if let Some((l, r)) = split.as_ref() {
            if *l == id || *r == id {
                let other = if *l == id { r.clone() } else { l.clone() };
                *split = None;
                if let Some(t) = tabs.tabs.lock().unwrap().iter_mut().find(|t| t.id == other) {
                    t.visible = true;
                }
            }
        }
    }
    let removed = {
        let mut guard = tabs.tabs.lock().unwrap();
        let pos = guard.iter().position(|t| t.id == id);
        match pos {
            Some(i) => guard.remove(i),
            None => return Ok(false),
        }
    };

    let was_visible = removed.visible;
    let removed_label = removed.label;
    // Закрываемая вкладка могла быть в fullscreen — иначе relayout() навсегда
    // прячет ВСЕ вебвью за экран (fullscreen-ветка в relayout), и шелл
    // выглядит замороженным.
    {
        let mut fs = tabs.fullscreen.lock().unwrap();
        if fs.as_deref() == Some(id.as_str()) {
            *fs = None;
        }
    }
    let app_for_main = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(webview) = app_for_main.get_webview(&removed_label) {
            // Сначала останавливаем страницу: полного уничтожения webview в
            // tauri 2 нет (закрыто только "спрятать за экран"), а скрытый
            // WebView2 продолжает молотить и играть аудио/видео — юзер видел
            // баг «выключил видео вкладкой, а звук остался навсегда».
            // Навигация на about:blank мгновенно выгружает страницу и её
            // медиа-процессы — звук умирает вместе с ней.
            let _ = webview.navigate(tauri::Url::parse("about:blank").unwrap());
            let _ = webview.set_bounds(page_rect(-60000.0, -60000.0, 1.0, 1.0));
        }
    });

    // Only steal focus if we actually closed the tab that was visible —
    // closing a background tab must never jump you away from what you're
    // looking at.
    if was_visible {
        let next = {
            let guard = tabs.tabs.lock().unwrap();
            guard.last().map(|t| t.id.clone())
        };
        if let Some(next_id) = next {
            let mut guard = tabs.tabs.lock().unwrap();
            for t in guard.iter_mut() {
                t.visible = t.id == next_id;
            }
        }
    }
    relayout(&app);
    Ok(true)
}

#[tauri::command]
pub(crate) async fn page_relayout(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let tabs = app.state::<PageTabs>();
    *tabs.measured_rect.lock().unwrap() =
        Some((x, y, width.max(50.0), height.max(50.0)));
    drop(tabs);
    relayout(&app);
    Ok(())
}

#[tauri::command]
pub(crate) fn open_in_system(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(&url).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(&url).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Build the cookie/storage/referrer enforcement script. Injected into every
/// frame of a tab webview (initialization scripts survive navigations).
fn privacy_shim_js(
    block_tp_cookies: bool,
    strict_storage: bool,
    referrer: apb_privacy::ReferrerPolicy,
) -> String {
    use apb_privacy::ReferrerPolicy as RP;
    let meta: String = match referrer {
        RP::Default => "",
        RP::StrictOriginWhenCrossOrigin => "strict-origin-when-cross-origin",
        RP::SameOriginOnly => "same-origin",
        RP::NeverCrossOrigin => "no-referrer",
    }
    .to_string();
    let tp = if block_tp_cookies { "true" } else { "false" };
    let ss = if strict_storage { "true" } else { "false" };
    format!(
        r#"(() => {{
  const REF = "{meta}";
  try {{
    if (REF && !document.querySelector('meta[name="referrer"]')) {{
      const m = document.createElement("meta");
      m.setAttribute("name", "referrer");
      m.setAttribute("content", REF);
      (document.head || document.documentElement).appendChild(m);
    }}
  }} catch (e) {{}}
  const TP = {tp}, SS = {ss};
  if (!TP && !SS) return;
  let inFrame = false;
  try {{ inFrame = window.top !== window.self; }} catch (e) {{ inFrame = false; }}
  if (!inFrame) return;
  let cross = false;
  try {{
    const t = window.top.location;
    cross = t.host !== window.location.host || t.protocol !== window.location.protocol;
  }} catch (e) {{ cross = true; }}
  if (!cross) return;
  if (TP) {{
    try {{
      Object.defineProperty(document, "cookie", {{
        configurable: false,
        get: () => "",
        set: () => {{}},
      }});
    }} catch (e) {{}}
  }}
  if (SS) {{
    for (const name of ["localStorage", "sessionStorage"]) {{
      try {{
        const s = window[name];
        for (const k of ["setItem", "removeItem", "clear"]) {{
          try {{ s[k] = () => {{ throw new Error("apb-isolated"); }}; }} catch (e) {{}}
        }}
      }} catch (e) {{}}
    }}
  }}
}})();"#
    )
}

// Made by MrDuck

// ---------------------------------------------------------------------
// Fullscreen (видео/сайт на весь экран). WebView2 в этом окружении не
// может нативно рисовать fullscreen: страница живёт в child-webview ПОВЕРХ
// HTML-панелей шелла, и Chromium Fullscreen API просто не отрабатывает —
// это и есть баг «видео нельзя открыть на полное окно». Решение: сайт НЕ
// тянет нативный fullscreen; JS-шим ловит requestFullscreen/exitFullscreen
// и зовёт page_fullscreen_enter/exit. Здесь полноэкранная вкладка растяги-
// вается на всё клиентское окно (relayout + full_rect), остальные прячутся.
// ---------------------------------------------------------------------

/// Сайт запросил полный экран — разворачиваем ЭТУ вкладку через relayout.
#[tauri::command]
pub(crate) async fn page_fullscreen_enter(webview: tauri::Webview) -> Result<(), String> {
    let app = webview.app_handle().clone();
    let raw_label = webview.label().to_string();
    let tabs = app.state::<PageTabs>();
    {
        let guard = tabs.tabs.lock().unwrap();
        if !guard.iter().any(|t| t.label == raw_label) {
            return Err("вкладка-автор не найдена".into());
        }
    }
    // Полноэкранная вкладка становится ЕДИНСТВЕННОЙ видимой.
    {
        let mut guard = tabs.tabs.lock().unwrap();
        for t in guard.iter_mut() {
            t.visible = t.label == raw_label;
        }
    }
    append_backend_log(&format!("[fs] enter {raw_label}"));
    *tabs.fullscreen.lock().unwrap() = Some(raw_label);
    // Настоящий OS-fullscreen окна: только так видео (child-webview поверх
    // шелла) займёт ВЕСЬ монитор — рамка и панель задач уходят под окно.
    // topmost + явный размер по полному монитору нужны, потому что простого
    // set_fullscreen недостаточно: полоса панели задач остаётся видимой.
    if let Some(w) = app.get_window("shell") {
        let _ = w.set_fullscreen(true);
        let _ = w.set_always_on_top(true);
        if let Ok(Some(mon)) = w.current_monitor() {
            let _ = w.set_position(tauri::Position::Physical(*mon.position()));
            let _ = w.set_size(tauri::Size::Physical(*mon.size()));
        }
    }
    relayout(&app);
    // set_fullscreen меняет размер окна асинхронно — после готовности
    // раскладка должна пересчитаться ещё раз, иначе full_rect будет старым.
    {
        let app2 = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(250));
            relayout(&app2);
        });
    }
    Ok(())
}

/// Выход из полного экрана (Esc / сайт вызвал exitFullscreen).
#[tauri::command]
pub(crate) async fn page_fullscreen_exit(app: AppHandle) -> Result<(), String> {
    {
        let tabs = app.state::<PageTabs>();
        *tabs.fullscreen.lock().unwrap() = None;
    }
    if let Some(w) = app.get_window("shell") {
        let _ = w.set_always_on_top(false);
        let _ = w.set_fullscreen(false);
    }
    append_backend_log("[fs] exit");
    relayout(&app);
    {
        let app2 = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(250));
            relayout(&app2);
        });
    }
    Ok(())
}

// Шим полного экрана: эмулирует Fullscreen API, чтобы сайтам (видеоплеерам,
// галереям) не нужны были правки — они видят те же события, что при нативном
// fullscreen, но вместо системного режима вкладка растягивается в шелле.
const FULLSCREEN_RELAY_JS: &str = r#"(function(){
  if (window.__apbFullscreenRelay) return; window.__apbFullscreenRelay = true;
  var inFs = false, fsEl = null;
  function invoke(name, args){
    try {
      var i = window.__TAURI_INTERNALS__;
      if (i && i.invoke) { i.invoke(name, args || {}).catch(function(){}); return true; }
    } catch(e){}
    return false;
  }
  function send(name, args){
    if (invoke(name, args)) return;
    // Дочерний фрейм без IPC: просим верхний фрейм (живёт в том же webview).
    try { window.parent.postMessage({ __apbFs: name, __apbFsArgs: args || {} }, "*"); } catch(e){}
  }
  function diag(msg){ send("page_diag", { msg: "fs-shim " + msg }); }
  // Самопроверка: каждая загрузка документа пишет жив-ли шим в бэкенд-лог.
  try { diag("alive " + location.href); } catch(e){}
  function setState(on, el){
    inFs = on; fsEl = on ? el : null;
    try {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, get: function(){ return fsEl; } });
      Object.defineProperty(document, "webkitFullscreenElement", { configurable: true, get: function(){ return fsEl; } });
      document.dispatchEvent(new Event("fullscreenchange"));
      try { document.dispatchEvent(new Event("webkitfullscreenchange")); } catch(e){}
    } catch(e){}
  }
  function enter(el, how){
    try { setState(true, el); } catch(e){}
    send("page_fullscreen_enter");
    diag(how);
  }
  // requestFullscreen не должен уходить в НАСТОЯЩИЙ fullscreen (он в этом
  // окружении не работает и ломает раскладку) — только накладываем на окно.
  Element.prototype.requestFullscreen = function(){ enter(this, "requestFullscreen"); return Promise.resolve(); };
  try { Element.prototype.webkitRequestFullscreen = Element.prototype.requestFullscreen; } catch(e){}
  // Некоторые плееры зовут webkit-путь видео, минуя requestFullscreen.
  try {
    HTMLVideoElement.prototype.webkitEnterFullscreen = function(){ enter(this, "webkitEnterFullscreen"); };
    HTMLVideoElement.prototype.webkitEnterFullScreen = HTMLVideoElement.prototype.webkitEnterFullscreen;
  } catch(e){}
  document.exitFullscreen = function(){
    try { setState(false); } catch(e){}
    send("page_fullscreen_exit");
    diag("exitFullscreen");
    return Promise.resolve();
  };
  try { document.webkitExitFullscreen = document.exitFullscreen; } catch(e){}
  try { Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: function(){ return true; } }); } catch(e){}
  // iframe → верх: принимаем мостовые сообщения и дёргаем IPC от имени webview.
  window.addEventListener("message", function(ev){
    if (ev.source === window) return;
    var d = ev && ev.data;
    if (d && typeof d.__apbFs === "string") invoke(d.__apbFs, d.__apbFsArgs);
  });
  // Esc из нашего слоя: покидаем fullscreen (в нативном его гасит сам
  // браузер; здесь обязаны обработать мы).
  window.addEventListener("keydown", function(e){
    if (e.key === "Escape" && inFs) { try { document.exitFullscreen(); } catch(_){} }
  }, true);
})();"#;