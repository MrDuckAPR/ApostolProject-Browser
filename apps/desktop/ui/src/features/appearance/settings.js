// Made by MrDuck
// ---------------------------------------------------------------------
// First-run onboarding — shown exactly once, at first launch
// ---------------------------------------------------------------------

function showOnboarding(){
 if(document.getElementById('onboardingOverlay')) return;
 const steps=['Привет','Тема','Поиск','Интерфейс','Импорт','Виджеты','Готово'];let i=0,pendingVault=false;
 const ov=document.createElement('div');ov.id='onboardingOverlay';ov.className='apb-onboard intro-v8';ov.innerHTML=`<div class="ob-shell"><aside class="ob-side"><div class="ob-logo"></div><b>ApostolProject Browser</b><p class="hint">Быстрая настройка</p><div class="ob-dots">${steps.map((x,j)=>`<div class="ob-dot" data-n="${j}"><i>${j+1}</i>${x}</div>`).join('')}</div></aside><main class="ob-main"><div class="ob-progress"><i></i></div><section class="ob-stage"></section><footer class="ob-foot"><button class="ghost-btn ob-back">Назад</button><button class="primary-btn ob-next">Далее</button></footer></main></div>`;document.body.append(ov);const st=ov.querySelector('.ob-stage'),nx=ov.querySelector('.ob-next'),bk=ov.querySelector('.ob-back');
 const one=(sel,fn)=>st.querySelectorAll(sel).forEach(x=>x.onclick=()=>{st.querySelectorAll(sel).forEach(y=>y.classList.remove('active'));x.classList.add('active');fn(x.dataset.v)});
 function render(){ov.querySelector('.ob-progress i').style.width=((i+1)/steps.length*100)+'%';ov.querySelectorAll('.ob-dot').forEach((x,j)=>x.classList.toggle('active',i===j));bk.style.visibility=i?'visible':'hidden';nx.textContent=i===steps.length-1?'Начать пользоваться':'Далее';
 if(i===0)st.innerHTML=`<span class="ob-kicker">Первый запуск</span><h1>Настроим браузер под тебя</h1><p>Выбери тему, поиск и расположение интерфейса. Это займёт меньше минуты, а изменить всё можно позже.</p><div class="ob-info"><div><b>Приватно</b><span>Профили, история и сейф хранятся локально.</span></div><div><b>Без привязки</b><span>Можно пропустить любой выбор и оставить рекомендуемый.</span></div></div>`;
 if(i===1){st.innerHTML=`<span class="ob-kicker">Оформление</span><h1>Выбери настроение</h1><div class="ob-cards ob-theme-picks"><button class="ob-card" data-v="cosmos"><b>Космос</b><small>Тёмный</small></button><button class="ob-card" data-v="ocean"><b>Океан</b><small>Холодный</small></button><button class="ob-card" data-v="forest"><b>Лес</b><small>Спокойный</small></button><button class="ob-card ob-random" data-v="random"><b>🎲 Случайная</b><small>Создать палитру</small></button></div>`;one('.ob-card',v=>v==='random'?window.APBAppearance?.random():window.APBAppearance?.preset(v));}
 if(i===2){const cur=typeof getSearchEngine==='function'?getSearchEngine():'duckduckgo';st.innerHTML=`<span class="ob-kicker">Омнибокс</span><h1>Поисковая система</h1><p>Используется, когда введён не адрес сайта, а обычный запрос.</p><div class="ob-cards"><button class="ob-card ${cur==='duckduckgo'?'active':''}" data-v="duckduckgo"><b>DuckDuckGo</b><small>Приватный поиск</small></button><button class="ob-card ${cur==='google'?'active':''}" data-v="google"><b>Google</b><small>Привычная выдача</small></button><button class="ob-card ${cur==='bing'?'active':''}" data-v="bing"><b>Bing</b><small>Microsoft</small></button><button class="ob-card ${cur==='startpage'?'active':''}" data-v="startpage"><b>Startpage</b><small>Google без слежения</small></button></div>`;one('.ob-card',v=>{localStorage.setItem('apb-search-engine',v);const e=document.getElementById('searchEngineSelect');if(e)e.value=v});}
 if(i===3){st.innerHTML=`<span class="ob-kicker">Интерфейс</span><h1>Как удобнее работать?</h1><div class="ob-cards"><button class="ob-card" data-v="left"><b>Вкладки слева</b><small>Больше места и названий</small></button><button class="ob-card" data-v="top"><b>Вкладки сверху</b><small>Как в классических браузерах</small></button></div><label class="ob-toggle"><input id="obMotion" type="checkbox" checked> Плавные анимации интерфейса</label>`;one('.ob-card',v=>pzUpdate({tabsPos:v}));st.querySelector('#obMotion').onchange=e=>pzUpdate({motion:e.target.checked});}
 if(i===4){st.innerHTML=`<span class="ob-kicker">Перенос данных</span><h1>Начни со своих данных</h1><p>Тему можно импортировать сейчас. Пароли импортируются только после создания зашифрованного сейфа.</p><div class="ob-cards"><button class="ob-card" id="obThemeImport"><b>Импорт темы</b><small>.apbtheme</small></button><button class="ob-card" id="obPasswordImport"><b>Импорт паролей</b><small>CSV после создания сейфа</small></button><button class="ob-card" id="obNothing"><b>Начать с нуля</b><small>Ничего не импортировать</small></button></div>`;st.querySelector('#obThemeImport').onclick=()=>document.getElementById('skinImportFile')?.click();st.querySelector('#obPasswordImport').onclick=e=>{pendingVault=true;e.currentTarget.classList.add('active');e.currentTarget.querySelector('small').textContent='Откроем сейф после настройки'};}
 if(i===5){st.innerHTML=`<span class="ob-kicker">Главная</span><h1>Добавь нужные виджеты</h1><p>Строка поиска — отдельной строкой, положение выбирается в настройках: по центру или сверху. Остальные карточки — по желанию: переставляйте за заголовок, растягивайте за угол, задавайте фон и шрифт, закрепляйте замком.</p><div class="ob-widget-list">${[['clock','Время'],['calendar','Календарь'],['weather','Погода'],['tasks','Задачи'],['focus','Фокус'],['quote','Идея дня']].map(x=>`<label><input type="checkbox" data-widget-choice="${x[0]}"> ${x[1]}</label>`).join('')}</div>`;st.querySelectorAll('[data-widget-choice]').forEach(x=>x.onchange=()=>window.APBWidgets?.toggle(x.dataset.widgetChoice,x.checked));}
 if(i===6)st.innerHTML=`<span class="ob-kicker">Готово</span><h1>Браузер настроен</h1><div class="ob-shortcuts"><div><kbd>Ctrl T</kbd><span>Новая вкладка</span></div><div><kbd>Ctrl K</kbd><span>Команды</span></div><div><kbd>Ctrl F</kbd><span>Поиск на странице</span></div></div><p>${pendingVault?'После запуска откроется создание сейфа для безопасного импорта паролей.':'Все параметры доступны в настройках.'}</p>`;}
 function done(){localStorage.setItem('apb-onboarded-v8','1');localStorage.setItem('apb-intro-required-v8','done');ov.classList.add('ob-closing');setTimeout(()=>{ov.remove();showHome();if(pendingVault){openInternal('vault');localStorage.setItem('apb-pending-password-import','1')}},220)}nx.onclick=()=>i<steps.length-1?(i++,render()):done();bk.onclick=()=>{if(i){i--;render()}};render();
}

// ---------------------------------------------------------------------
// Personalization (Vivaldi-style): accent, radius, density, sidebar
// width, glass, motion — persisted in localStorage ("apb-ui").
// ---------------------------------------------------------------------

const PZ_DEFAULTS = { accent: "", radius: 12, sidebar: 232, density: "normal", glass: true, motion: true, glassA: "", tabsPos: "left", sidebarSide: "left", panelSide: "left", hideTools: false, wsCount: true, sideHover: false, font: "system", fontData: "", fontName: "", headFont: "", fontSize: 13, bgColor: "", bgImg: "", bgDim: 35, bgFit: "cover", bgBlur: 0, bgHomeOnly: true, thBg: "", thSoft: "", thText: "", thTextDim: "", thLink: "", thAccent: "", thSurface: "", thSurface2: "", thBorder: "", thDanger: "", thOnAccent: "", thSuccess: "", thWarning: "", thSelection: "", thShadow: "", sound: true, settingsCols: false, settingsW: 640, hsPos: "top" };

// Curated font stacks for the UI font setting
const AP_FONTS = {
  system: '-apple-system, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
  segoe: '"Segoe UI", system-ui, sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
  georgia: 'Georgia, "Times New Roman", serif',
  mono: 'Consolas, ui-monospace, monospace',
};

function pzLoad() {
  try { return { ...PZ_DEFAULTS, ...(JSON.parse(localStorage.getItem("apb-ui")) || {}) }; }
  catch { return { ...PZ_DEFAULTS }; }
}

function pzApply() {
  const p = pzLoad();
  const rs = document.documentElement.style;
  if (p.accent) rs.setProperty("--accent", p.accent);
  else rs.removeProperty("--accent");
  if (p.bgColor) rs.setProperty("--apb-user-bg", p.bgColor);
  else rs.removeProperty("--apb-user-bg");
  rs.setProperty("--r-sm", Math.max(0, p.radius - 5) + "px");
  rs.setProperty("--r", Math.max(2, p.radius - 2) + "px");
  rs.setProperty("--r-lg", p.radius + "px");
  rs.setProperty("--sidebar-w", p.sidebar + "px");
  rs.setProperty("--panel-w", (p.panelW || 330) + "px");
  if (p.editorW) rs.setProperty("--editor-w", p.editorW + "px"); else rs.removeProperty("--editor-w");
  if (p.aiW) rs.setProperty("--ai-w", p.aiW + "px"); else rs.removeProperty("--ai-w");
  document.body.classList.remove("density-compact", "density-normal", "density-spacious");
  document.body.classList.add("density-" + (p.density || "normal"));
  document.body.classList.toggle("no-panel-blur", !p.glass);
  document.body.classList.toggle("no-motion", !p.motion);
  document.body.classList.toggle("hs-center", (p.hsPos || "top") === "center");

  // --- Appearance page ---
  // Font (+ свой шрифт из файла — FontFace с data:URL, живёт в apb-ui)
  const CUSTOM_STACK = '"APB Custom", ' + AP_FONTS.system;
  if (p.fontData) {
    try {
      // файл могли сменить: старый FontFace надо снять с document.fonts,
      // иначе в семье "APB Custom" остаются два лица и побеждает случайное
      if (pzCustomFontFace && pzCustomFontFaceUrl !== p.fontData) {
        try { document.fonts.delete(pzCustomFontFace); } catch {}
        pzCustomFontFace = null;
      }
      if (!pzCustomFontFace) {
        pzCustomFontFace = new FontFace("APB Custom", 'url("' + p.fontData + '")');
        pzCustomFontFaceUrl = p.fontData;
        document.fonts.add(pzCustomFontFace);
      }
      pzCustomFontFace.load().catch(() => {});
    } catch {}
  }
  rs.setProperty("--font-body", p.font === "custom" && p.fontData ? CUSTOM_STACK : (AP_FONTS[p.font] || AP_FONTS.system));
  rs.setProperty("--ui-font-size", (p.fontSize || 13) + "px");
  document.body.style.fontSize = (p.fontSize || 13) + "px";
  const fontSizeValue = document.getElementById("apFontSizeValue"); if (fontSizeValue) fontSizeValue.textContent = (p.fontSize || 13) + " px";
  // Шрифт заголовков: пусто = как основной; "custom" = свой файл.
  rs.setProperty("--font-head", p.headFont === "custom" && p.fontData ? CUSTOM_STACK : (AP_FONTS[p.headFont] || "var(--font-body)"));
  // Tabs position / tools visibility
  document.body.classList.toggle("tabbar-top", p.tabsPos === "top");
  document.body.classList.toggle("sidebar-right", p.sidebarSide === "right");
  document.body.classList.remove("panel-right");
  document.body.classList.toggle("hide-tools", !!p.hideTools);
  document.body.classList.toggle("no-ws-count", !p.wsCount);
  document.body.classList.toggle("side-hover", !!p.sideHover);
  // Settings layout (optional 2 columns + adjustable width)
  document.body.classList.remove("settings-2col");
  const settingsWidth=[640,840,1040,1200].reduce((a,b)=>Math.abs(b-(p.settingsW||840))<Math.abs(a-(p.settingsW||840))?b:a,640);
  rs.setProperty("--settings-w", settingsWidth + "px");
  // Glass transparency
  // Material opacity belongs to APBAppearance.
  // Custom theme overrides
  if (p.thBg) rs.setProperty("--bg", p.thBg); else rs.removeProperty("--bg");
  if (p.thSoft) rs.setProperty("--bg-soft", p.thSoft); else rs.removeProperty("--bg-soft");
  if (p.thText) { rs.setProperty("--text", p.thText); } else rs.removeProperty("--text");
  if (p.thTextDim) rs.setProperty("--text-dim", p.thTextDim); else rs.removeProperty("--text-dim");
  // Was already saved/restored via presets & export but never actually
  // applied to a CSS variable, or restored into its own control on load —
  // fixing so the "Ссылки и акцент-текст" picker actually does something.
  if (p.thLink) rs.setProperty("--link", p.thLink); else rs.removeProperty("--link");
  if (p.thAccent) rs.setProperty("--accent", p.thAccent); else rs.removeProperty("--accent");
  if (p.thDanger) rs.setProperty("--danger", p.thDanger); else rs.removeProperty("--danger");
  if (p.thOnAccent) rs.setProperty("--on-accent", p.thOnAccent); else rs.removeProperty("--on-accent");
  if (p.thSuccess) rs.setProperty("--success", p.thSuccess); else rs.removeProperty("--success");
  if (p.thWarning) rs.setProperty("--warning", p.thWarning); else rs.removeProperty("--warning");
  if (p.thSelection) rs.setProperty("--selection", p.thSelection); else rs.removeProperty("--selection");
  if (p.thShadow) { rs.setProperty("--shadow-color", p.thShadow); rs.setProperty("--shadow-1", `0 2px 12px color-mix(in srgb, ${p.thShadow} 50%, transparent)`); rs.setProperty("--shadow-2", `0 14px 40px color-mix(in srgb, ${p.thShadow} 62%, transparent)`); } else { rs.removeProperty("--shadow-color"); rs.removeProperty("--shadow-1"); rs.removeProperty("--shadow-2"); }
  if (p.thSurface) {
    rs.setProperty("--surface", p.thSurface);
  } else { rs.removeProperty("--surface"); }
  // «Наведение и активные»: цвет из пикера; без него — прежний автотон
  // (примесь текста), чтобы ховеры оставались видимыми на любой теме.
  if (p.thSurface2) rs.setProperty("--surface-2", p.thSurface2);
  else if (p.thSurface) rs.setProperty("--surface-2", `color-mix(in srgb, ${p.thSurface} 88%, var(--text) 12%)`);
  else rs.removeProperty("--surface-2");
  if (p.thBorder) { rs.setProperty("--border", p.thBorder); rs.setProperty("--border-strong", p.thBorder); }
  else { rs.removeProperty("--border"); rs.removeProperty("--border-strong"); }
  // Фон: два адресата — слой ВСЕГО интерфейса (#apbBgLayer, см. pzEnsureBgLayer)
  // и/или главная страница. bgHomeOnly=true → только главная (как раньше);
  // false → картинка-фон под всем UI (панели полупрозрачны через --glass).
  const be = document.getElementById("browserEmpty");
  if (be) {
    const dim = Math.max(0, Math.min(80, p.bgDim == null ? 35 : p.bgDim)) / 100;
    if (p.bgImg && (p.bgHomeOnly !== false)) {
      be.style.backgroundColor = p.bgColor || "";
      be.style.backgroundImage = `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${p.bgImg}")`;
      be.style.backgroundSize = p.bgFit === "repeat" ? "auto" : (p.bgFit || "cover");
      be.style.backgroundPosition = "center";
      be.style.backgroundRepeat = p.bgFit === "repeat" ? "repeat" : "no-repeat";
      be.style.backgroundAttachment = p.bgFit === "repeat" ? "local" : "fixed";
    } else {
      // фон главной сбрасываем в цвет (или прозрачность, если слой UI снизу)
      be.style.backgroundImage = "";
      be.style.backgroundColor = p.bgImg && !p.bgHomeOnly ? "transparent" : (p.bgColor || "");
      be.style.backgroundSize = ""; be.style.backgroundPosition = "";
      be.style.backgroundRepeat = ""; be.style.backgroundAttachment = "";
    }
  }
  // Слой интерфейса: создан один раз, живёт ПОД контентом (z-index за
  // .browser-empty и панелями), управляется переменными bg-*
  const layer = pzEnsureBgLayer();
  if (layer) {
    const dim = Math.max(0, Math.min(80, p.bgDim == null ? 35 : p.bgDim)) / 100;
    const blur = Math.max(0, Math.min(30, p.bgBlur || 0));
    if (p.bgImg && p.bgHomeOnly === false) {
      layer.style.backgroundImage = `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${p.bgImg}")`;
      layer.style.backgroundSize = p.bgFit === "repeat" ? "auto" : (p.bgFit || "cover");
      layer.style.backgroundPosition = "center";
      layer.style.backgroundRepeat = p.bgFit === "repeat" ? "repeat" : "no-repeat";
      layer.style.filter = blur ? `blur(${blur}px)` : "";
      // блюр по краям рамки — тёмные края от фильтра не вылезают
      layer.style.transform = blur ? "scale(1.04)" : "";
      layer.style.backgroundColor = p.bgColor || "";
      layer.style.display = "";
    } else {
      layer.style.display = "none";
    }
  }
}

// Слой фоновой картинки интерфейса: <div id="apbBgLayer"> сразу под body
// (fixed, за всем контентом). Создаётся лениво в pzApply.
let pzBgLayer = null;
function pzEnsureBgLayer() {
  if (pzBgLayer && document.getElementById("apbBgLayer")) return pzBgLayer;
  let el = document.getElementById("apbBgLayer");
  if (!el) {
    el = document.createElement("div");
    el.id = "apbBgLayer";
    // первый ребёнок body: сайдбар/тулбар/контент идут позже → выше по
    // стеку без z-index-войн; сам слой fixed и невидим для событий.
    document.body.insertBefore(el, document.body.firstChild);
  }
  pzBgLayer = el;
  return el;
}

// Кэш FontFace своего шрифта (fontData живёт в apb-ui, вес ~100-500КБ).
// Url хранится, чтобы заметить смену файла и пересоздать лицо.
let pzCustomFontFace = null;
let pzCustomFontFaceUrl = "";

function pzUpdate(patch) {
  const p = { ...pzLoad(), ...patch };
  localStorage.setItem("apb-ui", JSON.stringify(p));
  pzApply();
  if ("sidebar" in patch || "radius" in patch || "density" in patch) {
    syncPageLayout(true);
    setTimeout(syncPageLayout, 220);
  }
}

function pzSyncControls() {
  const p = pzLoad();
  document.getElementById("pzAccent").value = p.accent || "#8a8a92";
  document.getElementById("pzRadius").value = p.radius;
  document.getElementById("pzSidebar").value = p.sidebar;
  document.getElementById("pzDensity").value = p.density;
  document.getElementById("pzGlass").checked = !!p.glass;
  document.getElementById("pzMotion").checked = !!p.motion;
  // Appearance
  const ap = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
  ap("apTabsPos", (el) => { el.value = p.tabsPos || "left"; });
  ap("apSidebarSide", (el) => { el.value = p.sidebarSide || "left"; });
  ap("apPanelSide", (el) => { el.value = p.panelSide || "left"; });
  ap("apHideTools", (el) => { el.checked = !!p.hideTools; });
  ap("apFontSel", (el) => { el.value = p.font || "system"; });
  ap("apFontSize", (el) => { el.value = p.fontSize || 13; });
  // свой шрифт: имя файла рядом с кнопкой, селектор — "custom" при наличии
  ap("apFontName", (el) => { el.textContent = p.fontName ? "📄 " + p.fontName : ""; el.title = p.fontName || ""; });
  ap("apHeadFontSel", (el) => { el.value = p.headFont || ""; });
  ap("thBg", (el) => { el.value = p.thBg || "#000000"; });
  ap("thSoft", (el) => { el.value = p.thSoft || "#0b0b0d"; });
  ap("thText", (el) => { el.value = p.thText || "#f2f2f4"; });
  ap("thTextDim", (el) => { el.value = p.thTextDim || "#a6a6b0"; });
  ap("thLink", (el) => { el.value = p.thLink || "#7fb0ff"; });
  ap("thAccent", (el) => { el.value = p.thAccent || "#7fb0ff"; });
  ap("thDanger", (el) => { el.value = p.thDanger || "#ff6575"; });
  ap("thOnAccent", (el) => { el.value = p.thOnAccent || "#08080a"; });
  ap("thSuccess", (el) => { el.value = p.thSuccess || "#43c17a"; });
  ap("thWarning", (el) => { el.value = p.thWarning || "#e5b04a"; });
  ap("thSelection", (el) => { el.value = p.thSelection || "#7fb0ff"; });
  ap("thShadow", (el) => { el.value = p.thShadow || "#000000"; });
  ap("apBgScope", (el) => { el.value = p.bgHomeOnly !== false ? "home" : "all"; });
  ap("thSurface", (el) => { el.value = p.thSurface || "#1a1a1e"; });
  ap("thSurface2", (el) => { el.value = p.thSurface2 || "#232329"; });
  ap("thBorder", (el) => { el.value = p.thBorder || "#333338"; });
  ap("apBgColor", (el) => { el.value = p.bgColor || "#000000"; });
  ap("apBgImg", (el) => { el.value = p.bgImg && !p.bgImg.startsWith("data:") ? p.bgImg : ""; });
  ap("apBgFit", (el) => { el.value = p.bgFit || "cover"; });
  ap("apBgBlur", (el) => { el.value = p.bgBlur || 0; });
  ap("apBgHomeOnly", (el) => { el.checked = p.bgHomeOnly !== false; });
  ap("apGlassA", (el) => { el.value = p.glassA || (document.documentElement.getAttribute("data-theme") === "light" ? 90 : 85); });
  ap("apBgDim", (el) => { el.value = p.bgDim == null ? 35 : p.bgDim; });
  ap("apWsCount", (el) => { el.checked = p.wsCount !== false; });
  ap("apSideHover", (el) => { el.checked = !!p.sideHover; });
  ap("apSettingsCols", (el) => { el.checked = !!p.settingsCols; });
  ap("apHomeSearchPos", (el) => { el.value = p.hsPos || "top"; });
  ap("apSettingsW", (el) => {
    el.value = [640,840,1040,1200].reduce((a,b)=>Math.abs(b-(p.settingsW||840))<Math.abs(a-(p.settingsW||840))?b:a,640);
    const disp = document.getElementById("apSettingsWVal");
    if (disp) disp.textContent = el.value + "px";
  });
}

document.getElementById("pzAccent")?.addEventListener("input", (e) => pzUpdate({ accent: e.target.value }));
document.getElementById("pzRadius")?.addEventListener("input", (e) => pzUpdate({ radius: +e.target.value }));
document.getElementById("pzSidebar")?.addEventListener("input", (e) => pzUpdate({ sidebar: +e.target.value }));
document.getElementById("pzDensity")?.addEventListener("change", (e) => pzUpdate({ density: e.target.value }));
document.getElementById("apHomeSearchPos")?.addEventListener("change", (e) => pzUpdate({ hsPos: e.target.value }));
document.getElementById("pzGlass")?.addEventListener("change", (e) => pzUpdate({ glass: e.target.checked }));
document.getElementById("pzMotion")?.addEventListener("change", (e) => pzUpdate({ motion: e.target.checked }));
document.getElementById("pzReset")?.addEventListener("click", () => {
  localStorage.removeItem("apb-ui");
  if (window.APBAppearance && window.APBAppearance.reset) window.APBAppearance.reset();
  pzApply();
  pzSyncControls();
  syncPageLayout(true);
  toast("Оформление сброшено");
});

// --- Appearance page listeners ---
const apOn = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);
apOn("apTabsPos", "change", (e) => { pzUpdate({ tabsPos: e.target.value }); syncPageLayout(true); setTimeout(syncPageLayout, 240); });
apOn("apSidebarSide", "change", (e) => { pzUpdate({ sidebarSide: e.target.value }); syncPageLayout(true); setTimeout(syncPageLayout, 240); });
apOn("apPanelSide", "change", (e) => { pzUpdate({ panelSide: e.target.value }); syncPageLayout(true); setTimeout(syncPageLayout, 240); });
apOn("apHideTools", "change", (e) => pzUpdate({ hideTools: e.target.checked }));
apOn("apSideHover", "change", (e) => pzUpdate({ sideHover: e.target.checked }));
apOn("apFontSel", "change", (e) => pzUpdate({ font: e.target.value }));
apOn("apFontSize", "input", (e) => pzUpdate({ fontSize: +e.target.value }));
// Свой шрифт с диска: читается как data-URL и живёт прямо в apb-ui
// (localStorage; .ttf/.otf/.woff обычно 100–500 КБ — влезает). Через
// FontFace "APB Custom" в pzApply становится доступным всему интерфейсу.
apOn("apFontPickBtn", "click", () => document.getElementById("apFontPick")?.click());
apOn("apFontPick", "change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (file.size > 6_000_000) { alert("Файл шрифта слишком большой (макс. 6 МБ)."); e.target.value = ""; return; }
  const reader = new FileReader();
  reader.onload = () => {
    // старое лицо снимет сам pzApply (url не совпадёт)
    pzUpdate({ fontData: reader.result, fontName: file.name, font: "custom" });
    toast("Шрифт «" + file.name + "» применён");
  };
  reader.readAsDataURL(file);
  e.target.value = "";
});
apOn("apFontResetBtn", "click", () => {
  // снять лицо из document.fonts — pzApply уже не увидит fontData
  if (pzCustomFontFace) { try { document.fonts.delete(pzCustomFontFace); } catch {} }
  pzCustomFontFace = null; pzCustomFontFaceUrl = "";
  pzUpdate({ fontData: "", fontName: "", font: "system" });
});
apOn("apHeadFontSel", "change", (e) => pzUpdate({ headFont: e.target.value }));
apOn("thBg", "input", (e) => pzUpdate({ thBg: e.target.value }));
apOn("thSoft", "input", (e) => pzUpdate({ thSoft: e.target.value }));
apOn("thSurface", "input", (e) => pzUpdate({ thSurface: e.target.value }));
apOn("thSurface2", "input", (e) => pzUpdate({ thSurface2: e.target.value }));
apOn("thBorder", "input", (e) => pzUpdate({ thBorder: e.target.value }));
apOn("thText", "input", (e) => pzUpdate({ thText: e.target.value }));
apOn("thTextDim", "input", (e) => pzUpdate({ thTextDim: e.target.value }));
apOn("thLink", "input", (e) => pzUpdate({ thLink: e.target.value }));
apOn("thAccent", "input", (e) => pzUpdate({ thAccent: e.target.value }));
apOn("thDanger", "input", (e) => pzUpdate({ thDanger: e.target.value }));
apOn("thOnAccent", "input", (e) => pzUpdate({ thOnAccent: e.target.value }));
apOn("thSuccess", "input", (e) => pzUpdate({ thSuccess: e.target.value }));
apOn("thWarning", "input", (e) => pzUpdate({ thWarning: e.target.value }));
apOn("thSelection", "input", (e) => pzUpdate({ thSelection: e.target.value }));
apOn("thShadow", "input", (e) => pzUpdate({ thShadow: e.target.value }));
apOn("apBgColor", "input", (e) => pzUpdate({ bgColor: e.target.value }));
apOn("apBgImg", "change", (e) => pzUpdate({ bgImg: e.target.value.trim() }));
apOn("apBgFit", "change", (e) => pzUpdate({ bgFit: e.target.value }));
apOn("apBgBlur", "input", (e) => pzUpdate({ bgBlur: +e.target.value }));
apOn("apBgHomeOnly", "change", (e) => pzUpdate({ bgHomeOnly: e.target.checked }));
apOn("apBgScope", "change", (e) => { const home = e.target.value === "home"; const hidden = document.getElementById("apBgHomeOnly"); if (hidden) hidden.checked = home; pzUpdate({ bgHomeOnly: home }); });
apOn("apBgReset", "click", () => {
  pzUpdate({ bgColor: "", bgImg: "", bgFit: "cover", bgBlur: 0, bgHomeOnly: true });
  pzSyncControls();
});
apOn("exitTopBtn", "click", () => { pzUpdate({ tabsPos: "left" }); syncPageLayout(true); });
apOn("ntTopBtn", "click", () => document.getElementById("newTabBtn").click());
apOn("apGlassA", "input", (e) => pzUpdate({ glassA: +e.target.value }));
apOn("apSound", "change", (e) => pzUpdate({ sound: e.target.checked }));
apOn("apWsCount", "change", (e) => pzUpdate({ wsCount: e.target.checked }));
apOn("apBgDim", "input", (e) => pzUpdate({ bgDim: +e.target.value }));
apOn("apSettingsCols", "change", (e) => pzUpdate({ settingsCols: e.target.checked }));
// The width slider lives on the very panel it resizes. Applying the width
// live on "input" used to make the panel — and the slider's own row
// inside it — visibly shift under the cursor while dragging (a feedback
// loop, since `.pz-row` stretches to the panel's current width and
// spreads label/control apart with justify-content:space-between). Fixed
// properly by giving #apSettingsWRow a fixed max-width in index.html so
// it no longer grows with the panel — the slider now stays put while you
// drag, and it's safe to go back to live "input" updates so you can
// actually see the rest of the page resize as you move it.
apOn("apSettingsW", "change", (e) => {
  const disp = document.getElementById("apSettingsWVal");
  if (disp) disp.textContent = e.target.value + "px";
  pzUpdate({ settingsW: +e.target.value });
});

// --- Downloads folder setting ---
// Made by MrDuck
async function dlDirRefresh() {
  try {
    const cur = await invoke("dl_dir_get");
    const inp = document.getElementById("dlDirInput");
    if (inp) inp.value = cur || "";
  } catch {}
}
apOn("dlDirSave", "click", async () => {
  const v = document.getElementById("dlDirInput").value.trim();
  try {
    await invoke("dl_dir_set", { path: v });
    toast(v ? "Папка загрузок сохранена" : "Возвращено значение по умолчанию");
  } catch (e) { alert(e); }
});
apOn("dlDirClear", "click", async () => {
  await invoke("dl_dir_set", { path: "" });
  document.getElementById("dlDirInput").value = "";
  toast("По умолчанию — Загрузки Windows");
});
apOn("dlDirOpen", "click", async () => {
  const dir = await invoke("downloads_dir");
  invokeV2("open_in_system", { url: dir }).catch(() => {});
});

// --- Custom theme presets ---
function getPresets() {
  try { return JSON.parse(localStorage.getItem("apb-themes")) || {}; } catch { return {}; }
}
function thPresetRefresh() {
  const sel = document.getElementById("thPresetSel");
  if (!sel) return;
  const ps = getPresets();
  sel.innerHTML = '<option value="">— мои темы —</option>' +
    Object.keys(ps).map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
}
// Reads every "Своя тема" color input at once — kept in one place so
// thApply / thPresetSave stay in sync with whatever fields exist.
function thReadFields() {
  return {
    thBg: document.getElementById("thBg").value,
    thSoft: document.getElementById("thSoft").value,
    thSurface: document.getElementById("thSurface").value,
    thSurface2: document.getElementById("thSurface2").value,
    thBorder: document.getElementById("thBorder").value,
    thText: document.getElementById("thText").value,
    thTextDim: document.getElementById("thTextDim").value,
    thLink: document.getElementById("thLink").value,
    thAccent: document.getElementById("thAccent").value,
    thDanger: document.getElementById("thDanger").value,
    thOnAccent: document.getElementById("thOnAccent").value,
    thSuccess: document.getElementById("thSuccess").value,
    thWarning: document.getElementById("thWarning").value,
    thSelection: document.getElementById("thSelection").value,
    thShadow: document.getElementById("thShadow").value,
  };
}

function apbReadableOnAccent(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#08080a";
  const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 155 ? "#08080a" : "#ffffff";
}
function apbThemeRecord(name = "Текущая тема") {
  const appearance = window.APBAppearance?.get?.() || {};
  return {
    version: 2, name, baseTheme: localStorage.getItem("apb-theme") || "dark",
    palette: thReadFields(),
    appearance: {
      background: appearance.background, primary: appearance.primary, secondary: appearance.secondary,
      intensity: appearance.intensity, speed: appearance.speed, density: appearance.density,
      interactive: appearance.interactive, motion: appearance.motion, windowMode: "off"
    }
  };
}
window.APBThemeStudio = {
  syncFromEffect(primary, secondary) {
    const p = pzLoad();
    if (p.thAccent === primary && p.thLink === secondary && p.accent === primary) return;
    pzUpdate({ accent: primary, thAccent: primary, thLink: secondary, thSelection: primary, thOnAccent: apbReadableOnAccent(primary) });
    pzSyncControls();
  },
  capture: apbThemeRecord
};

apOn("thApply", "click", () => {
  const fields = thReadFields();
  pzUpdate({ ...fields, accent: fields.thAccent });
  window.APBAppearance?.update({ primary: fields.thAccent, secondary: fields.thLink }, true, "palette");
  pzSyncControls();
  toast("Цвета интерфейса и фона синхронизированы");
});
apOn("thReset", "click", () => {
  pzUpdate({ thBg: "", thSoft: "", thSurface: "", thSurface2: "", thBorder: "", thText: "", thTextDim: "", thLink: "", thAccent: "", thDanger: "", thOnAccent: "", thSuccess: "", thWarning: "", thSelection: "", thShadow: "" });
  pzSyncControls();
});
apOn("thPresetSave", "click", async () => {
  const name = await prompt("Название темы:", "Моя тема");
  if (!name || !name.trim()) return;
  const clean = name.trim().slice(0, 60), ps = getPresets();
  ps[clean] = apbThemeRecord(clean);
  localStorage.setItem("apb-themes", JSON.stringify(ps));
  thPresetRefresh(); document.getElementById("thPresetSel").value = clean;
  toast(`Тема «${clean}» сохранена полностью`);
});
apOn("thPresetLoad", "click", () => {
  const name = document.getElementById("thPresetSel").value, stored = getPresets()[name];
  if (!name || !stored) return;
  const palette = stored.palette || stored;
  pzUpdate({ ...palette, accent: palette.thAccent || "" });
  if (stored.baseTheme) applyTheme(stored.baseTheme);
  if (stored.appearance) window.APBAppearance?.update({ ...stored.appearance, windowMode: "off" }, true, "saved-theme");
  else window.APBAppearance?.update({ primary: palette.thAccent, secondary: palette.thLink }, true, "legacy-theme");
  pzSyncControls(); toast(`Тема «${name}» применена`);
});
apOn("thPresetDel", "click", () => {
  const name = document.getElementById("thPresetSel").value;
  if (!name) return;
  const ps = getPresets();
  delete ps[name];
  localStorage.setItem("apb-themes", JSON.stringify(ps));
  thPresetRefresh();
});
thPresetRefresh();

// --- Import / export a complete appearance package (.apbtheme v2) ---
function apbPick(obj, keys) { const out = {}; for (const k of keys) if (obj && k in obj) out[k] = obj[k]; return out; }
apOn("skinExportBtn", "click", async () => {
  const selected = document.getElementById("thPresetSel")?.value || "APB Theme";
  const record = apbThemeRecord(selected);
  const payload = { app: "apb-theme", version: 2, exportedAt: new Date().toISOString(), ...record, ui: pzLoad(), savedThemes: getPresets() };
  try {
    const path = await invoke("save_text_file", { name: "apb-theme-" + new Date().toISOString().slice(0,10) + ".apbtheme", contents: JSON.stringify(payload, null, 2) });
    toast("Тема экспортирована: " + path);
  } catch (e) { alert("Ошибка экспорта: " + e); }
});
apOn("skinImportBtn", "click", () => document.getElementById("skinImportFile").click());
apOn("skinImportFile", "change", async (e) => {
  const file = e.target.files && e.target.files[0]; e.target.value = ""; if (!file) return;
  if (file.size > 8_000_000) { alert("Файл темы слишком большой (макс. 8 МБ)."); return; }
  let data; try { data = JSON.parse(await file.text()); } catch { alert("Файл повреждён: JSON не читается."); return; }
  if (!data || !["apb-theme","apb-settings"].includes(data.app)) { alert("Это не пакет темы APB."); return; }
  if (!(await confirm(`Импортировать тему «${data.name || file.name}»? Прозрачность останется выключенной.`))) return;
  const uiKeys = Object.keys(PZ_DEFAULTS), sourceUi = data.ui || data.palette || {};
  const nextUi = { ...pzLoad(), ...apbPick(sourceUi, uiKeys), ...(data.palette ? apbPick(data.palette, uiKeys) : {}) };
  localStorage.setItem("apb-ui", JSON.stringify(nextUi));
  if (data.baseTheme || data.theme) applyTheme(data.baseTheme || data.theme);
  const appearanceKeys = ["background","primary","secondary","intensity","speed","density","interactive","motion"];
  const appearance = apbPick(data.appearance || {}, appearanceKeys);
  if (Object.keys(appearance).length) window.APBAppearance?.update({ ...appearance, windowMode: "off" }, true, "import");
  if (data.savedThemes && typeof data.savedThemes === "object" && !Array.isArray(data.savedThemes)) localStorage.setItem("apb-themes", JSON.stringify(data.savedThemes));
  pzApply(); pzSyncControls(); thPresetRefresh(); renderHome(); syncPageLayout(true); setTimeout(syncPageLayout, 240);
  toast("Тема импортирована и синхронизирована ✓");
});
// Background image from local file — downscaled and stored as data-URL
apOn("apBgFileBtn", "click", () => document.getElementById("apBgFile").click());
apOn("apBgFile", "change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const img = new Image();
  const reader = new FileReader();
  reader.onload = () => { img.src = reader.result; };
  img.onload = () => {
    // Downscale so it fits comfortably into localStorage
    const maxW = 1920;
    const scale = Math.min(1, maxW / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    let data;
    try { data = canvas.toDataURL("image/jpeg", 0.85); } catch { alert("Не удалось обработать картинку"); return; }
    if (data.length > 4_500_000) { alert("Картинка слишком большая даже после сжатия — выберите другую."); return; }
    pzUpdate({ bgImg: data });
    const inp = document.getElementById("apBgImg");
    if (inp) inp.value = "";
  };
  reader.readAsDataURL(file);
  e.target.value = "";
});

pzApply();

// ---------------------------------------------------------------------
// Resizable panes — drag the left edge of editor/AI panes and the right
// edge of the side panel to resize them with the mouse.
// ---------------------------------------------------------------------

function makeResizer(handleId, paneId, { persistKey, min = 280 }) {
  const h = document.getElementById(handleId);
  const p = document.getElementById(paneId);
  if (!h || !p) return;
  let startX = 0, startW = 0, leftEdge = false;
  h.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startW = p.getBoundingClientRect().width;
    // Направление зависит от того, на КАКОМ краю панели сидит ручка:
    // левый край → тянем влево = шире; правый край → тянем вправо = шире.
    // Определяем по факту при каждом захвате: панель можно перевесить
    // на другую сторону (panel-left/panel-right), а редактор/AI всегда
    // справа с левой ручкой — всем подходит одна логика.
    const pr = p.getBoundingClientRect();
    const hr = h.getBoundingClientRect();
    leftEdge = (hr.left + hr.width / 2) < (pr.left + pr.width / 2);
    document.body.classList.add("resizing");
    h.classList.add("active");
  });
  h.addEventListener("pointermove", (e) => {
    if (!h.hasPointerCapture || !h.hasPointerCapture(e.pointerId)) return;
    const dx = leftEdge ? (startX - e.clientX) : (e.clientX - startX);
    const w = Math.round(startW + dx);
    p.style.width = Math.min(Math.max(w, min), Math.round(window.innerWidth * 0.7)) + "px";
    p.style.flex = "0 0 " + p.style.width;
  });
  const end = (e) => {
    if (!h.hasPointerCapture || !h.hasPointerCapture(e.pointerId)) return;
    h.releasePointerCapture(e.pointerId);
    document.body.classList.remove("resizing");
    h.classList.remove("active");
    syncPageLayout(true);
    setTimeout(syncPageLayout, 80);
    if (persistKey) {
      const w = parseInt(p.style.width, 10);
      if (w) pzUpdate({ [persistKey]: w });
    }
  };
  h.addEventListener("pointerup", end);
  h.addEventListener("pointercancel", end);
}
makeResizer("edResizer", "editorPane", { persistKey: "editorW", min: 340 });
makeResizer("aiResizer", "aiPane", { persistKey: "aiW", min: 320 });
makeResizer("panelResizer", "sidePanel", { persistKey: "panelW", min: 240 });

// ---------------------------------------------------------------------
// UI TOUR — игровые подсказки: мини-панель возле элемента + пульсирующая
// подсветка. Экран НЕ блокирует (без оверлея), интерфейс остаётся живым.
// Тур идёт НЕ только по главной: шаги сами открывают внутренние страницы
// (настройки/оформление/история/сейф/расширения) и боковые панели.
// Показывается один раз после онбординга; повтор — Настройки → Оформление.
// ---------------------------------------------------------------------

const TOUR_KEY = "apb-ui-tour";
// Made by MrDuck
const TOUR_STEPS = [
  { center: true, title: "👋 Добро пожаловать в AP Browser",
    text: "AP Browser (ApostolProject Browser) — десктопный браузер с упором на приватность. Внутри: настоящие вкладки на движке WebView2, воркспейсы со своими наборами вкладок, изолированные профили, заметки с графом знаний, сейф паролей и AI-ассистент, который умеет работать полностью локально. Никакой телеметрии — все данные остаются только на твоём компьютере. Жми «Далее» — проведу по главным кнопкам." },
  { sel: "#collapseBtn", title: "Сворачивание панели",
    text: "Схлопывает боковую панель в узкий рельс с иконками. Повторный клик разворачивает обратно. Открытие по наведению включается в Оформлении." },
  { sel: "#newTabBtn", title: "Новая вкладка",
    text: "Кнопка или Ctrl+T. Новые вкладки появляются вверху списка, у каждой открытой — иконка сайта." },
  { sel: "#tabstripScroll", title: "Вкладки",
    text: "Клик — перейти, × — закрыть, ПКМ по вкладке — контекстное меню." },
  { sel: "#wsStrip", title: "Воркспейсы",
    text: "Отдельные рабочие пространства со своим набором вкладок. + — создать, двойной клик — переименовать, ПКМ — дублировать или удалить." },
  { sel: "#addressInput", title: "Омнибокс",
    text: "Адрес или поисковый запрос — Enter. Кнопка ☾ справа включает принудительную тёмную тему для сайтов без своей." },
  { sel: ".nav-group", title: "Навигация",
    text: "Назад, вперёд и обновить. История ведётся отдельно для каждой вкладки." },
  { sel: "#profileSelect", title: "Профили",
    text: "Полная изоляция: свои cookie, история и загрузки. Кнопка + рядом создаёт профиль, в том числе анонимный без следов." },
  { sel: ".side-tools", title: "Инструменты",
    text: "Закладки, история, загрузки, заметки с графом связей, приватность и AI-чат — всегда внизу панели." },

  { action: () => { openInternal("settings"); }, sel: ".isec-nav",
    title: "Внутренние страницы",
    text: "Настройки, оформление, история, пароли и расширения живут в одной оболочке — переключаются этими вкладками." },
  { action: () => { openInternal("appearance"); }, sel: "#appearance .internal-title",
    title: "Оформление",
    text: "Темы, акценты, шрифты, фон главной страницы. Здесь же экспорт/импорт настроек и кнопка ❓ повторного тура подсказок." },
  { action: () => { openInternal("history"); }, sel: "#histScopeSelect",
    title: "История",
    text: "Полная история с фильтром. Можно смотреть либо текущий профиль, либо сразу все — записи сгруппированы по дням." },
  { action: () => { openInternal("vault"); }, sel: ["#vaultContentBox", "#vaultSetupBox"],
    title: "Сейф паролей",
    text: "Локальное хранилище паролей: AES-256-GCM + Argon2id. Данные никогда не покидают компьютер. Импорт/экспорт JSON." },
  // Расширения спрятаны (сессия 111) — команда палитры убрана до расширений v2.

  { action: () => {
      const ih = document.getElementById("internalHost");
      if (ih && !ih.classList.contains("hidden")) closeInternal(false);
      showHome();
      const p = document.getElementById("aiPane");
      if (p.classList.contains("hidden")) document.querySelector('.rail-item[data-tab="ai"]').click();
    }, sel: "#aiPane .editor-head",
    title: "AI-ассистент",
    text: "Чат прямо в браузере: Ollama работает полностью локально, поддерживаются OpenAI-совместимые API. Умеет учитывать текст открытой страницы и переводить её." },
  { action: () => {
      const p = document.getElementById("aiPane");
      if (!p.classList.contains("hidden")) document.getElementById("aiClose").click();
      document.querySelector('.rail-item[data-tab="bookmarks"]').click();
    }, sel: "#bookmarks .panel-title",
    title: "Закладки",
    text: "Поиск по названию, адресу и тегам. Добавление — через + или ПКМ на странице." },
  { action: () => {
      document.querySelector('.rail-item[data-tab="downloads"]').click();
    }, sel: "#downloads .panel-title",
    title: "Загрузки",
    text: "Файлы ловятся автоматически и складываются в папку загрузок активного профиля. Клик по строке — открыть папку." },
  { action: () => {
      // Гарантированно открываем секцию заметок и форму создания
      openSidePanel("notes");
      const det = document.querySelector("#notes .add-form");
      if (det) det.setAttribute("open", "");
    }, sel: "#notes .panel-title",
    title: "Заметки — markdown с суперсилой",
    text: "Создавай заметку кнопкой «Сохранить» — имя может содержать папку: Работа/Идея.md. Внутри: markdown, [[вики-ссылки]] между заметками, #теги, чекбоксы, картинки и даже формулы LaTeX ($E=mc^2$ или $$\\frac{a}{b}$$). Кнопка «?» на панели редактора — шпаргалка по синтаксису." },
  { action: async () => {
      // Открываем первую заметку в редакторе (если есть)
      const li = document.querySelector("#notesList li[data-file]");
      if (!li) return;
      try {
        const content = await invoke("read_note", { path: li.dataset.file });
        openEditor(li.dataset.file, content);
      } catch (_) {}
    }, sel: ".editor-tabs",
    title: "Редактор: Рисование и Просмотр",
    text: "Над текстом четыре вкладки. «Рисование» — рисуй мышью пером, маркером и фигурами, а кнопка «⬇ В заметку» вставит рисунок прямо в текст. «Просмотр» — красивый рендер: заголовки, списки, таблицы, картинки и формулы LaTeX ($x^2$, $$\\frac{a}{b}$$). Кнопка «⬇» в шапке сохраняет заметку как .md файл." },
  { action: async () => {
      // Открываем первую заметку и сразу вид «Граф» (если заметки есть)
      const li = document.querySelector("#notesList li[data-file]");
      if (!li) return;
      const file = li.dataset.file;
      try {
        const content = await invoke("read_note", { path: file });
        openEditor(file, content);
        setEtab("graph");
      } catch (_) {}
    }, sel: "#etabGraph .graph-tools",
    title: "Граф знаний",
    text: "Визуальная доска связей. 2×ПКМ по фону — создать блок, ПКМ-тянуть от фигуры или за ● точку на её краю — провести связь, колесо — зум, ПКМ — панорама, ЛКМ-рамка — выделить группу, Del удаляет блоки и линии, Ctrl+Z отменяет. Блоки можно перетаскивать, клик по заметке открывает её. Все жесты — в ❓ Подсказке внутри графа." },
  { action: () => {
      const p = document.getElementById("aiPane");
      if (!p.classList.contains("hidden")) document.getElementById("aiClose").click();
      closeSidePanel();
      const ec = document.getElementById("edClose");
      if (ec) ec.click();
      showHome();
    }, center: true, title: "🎉 Готово! Вы во всём разобрались",
    text: "Шпаргалка на будущее: Ctrl+T — новая вкладка, Ctrl+K — палитра команд, ПКМ почти везде открывает своё меню. Профили полностью изолируют данные, сейф паролей шифруется AES-256-GCM с ключом Argon2id и не покидает компьютер, а AI-чат работает даже без интернета через Ollama. Заметки понимают markdown, [[вики-ссылки]] и рисуются графом связей — открой любую заметку → вкладка «Граф». Вернуть этот тур: Настройки → Оформление → ❓ Подсказки. Приятного пользования!" },
];

let _tourIdx = -1;
let _tourDimEl = null, _tourGhostEl = null;

function _tourEls() {
  return {
    hl: document.getElementById("tourHl"),
    pop: document.getElementById("tourPop"),
  };
}

function _tourTarget(sel) {
  const list = Array.isArray(sel) ? sel : [sel];
  for (const s of list) {
    const el = document.querySelector(s);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 && r.height < 2) continue;
    return el;
  }
  return null;
}

function startUITour(force) {
  if (!force && localStorage.getItem(TOUR_KEY) === "done") return;
  stopUITour(true); // перезапуск поверх

  // Затемнение-блокировка: ровно 4 шторы вокруг одной «дырки» (цели).
  // Изначально каждая покрывает весь экран → на старте плавно схлопываются.
  const dim = document.createElement("div");
  dim.id = "tourDim";
  for (let i = 0; i < 4; i++) {
    const s = document.createElement("div");
    s.className = "td-shade";
    s.style.top = "0px";
    s.style.left = "0px";
    s.style.width = window.innerWidth + "px";
    s.style.height = window.innerHeight + "px";
    dim.appendChild(s);
  }
  document.body.appendChild(dim);
  _tourDimEl = dim;
  requestAnimationFrame(() => dim.classList.add("show"));

  // Прозрачный «мост» над кнопками окна: они остаются ЗАТЕМНЁННЫМИ
  // визуально, но клики сквозь шторы пробрасываются на настоящие кнопки.
  const ghost = document.createElement("div");
  ghost.id = "tourWcGhost";
  const fwd = (e) => {
    ghost.style.pointerEvents = "none";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    ghost.style.pointerEvents = "";
    if (!el || el === ghost) return;
    const Ev = e.type.startsWith("pointer") ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ev(e.type, {
      bubbles: true, cancelable: true,
      clientX: e.clientX, clientY: e.clientY, button: 0,
    }));
    e.preventDefault();
  };
  ghost.addEventListener("pointerdown", fwd);
  ghost.addEventListener("pointerup", fwd);
  ghost.addEventListener("click", fwd);
  document.body.appendChild(ghost);
  _tourGhostEl = ghost;

  const hl = document.createElement("div");
  hl.id = "tourHl";
  const pop = document.createElement("div");
  pop.id = "tourPop";
  document.body.append(hl, pop);
  window.addEventListener("resize", _tourOnResize);
  document.addEventListener("keydown", _tourOnKey, true);
  // Стартуем с чистого экрана: закрываем настройки/панели и идём на главную
  try {
    const ih = document.getElementById("internalHost");
    if (ih && !ih.classList.contains("hidden")) closeInternal(false);
    const apn = document.getElementById("aiPane");
    if (apn && !apn.classList.contains("hidden")) {
      const x = document.getElementById("aiClose");
      if (x) x.click();
    }
    closeSidePanel();
    showHome();
  } catch (_) {}
  _tourIdx = -1;
  _tourNext();
}

function stopUITour(markDone) {
  const { hl, pop } = _tourEls();
  if (hl) hl.remove();
  if (pop) pop.remove();
  if (_tourDimEl) {
    const d = _tourDimEl;
    d.classList.remove("show");           // плавное затухание
    setTimeout(() => d.remove(), 300);
  }
  _tourDimEl = null;
  if (_tourGhostEl) { _tourGhostEl.remove(); _tourGhostEl = null; }
// Made by MrDuck
  window.removeEventListener("resize", _tourOnResize);
  document.removeEventListener("keydown", _tourOnKey, true);
  _tourIdx = -1;
  if (markDone === true) localStorage.setItem(TOUR_KEY, "done");
}

// Спотлайт: 4 шторы с фиксированными ролями вокруг одной дырки (цели).
// Роли не меняются между шагами → шторы плавно переезжают, без прыжков.
// Кнопки окна остаются затемнёнными, но ghost-слой пробрасывает им клики.
function _tourSpotlight(targetRect) {
  if (!_tourDimEl) return;
  const vw = window.innerWidth, vh = window.innerHeight, pad = 8;
  let hx = 0, hy = 0, hw = 0, hh = 0;
  if (targetRect) {
    hx = Math.max(0, targetRect.left - pad);
    hy = Math.max(0, targetRect.top - pad);
    hw = Math.min(vw - hx, targetRect.width + pad * 2);
    hh = Math.min(vh - hy, targetRect.height + pad * 2);
  }
  const st = (el, o) => {
    for (const k of ["top", "left", "width", "height"]) el.style[k] = o[k] + "px";
  };
  const shades = _tourDimEl.querySelectorAll(".td-shade");
  if (!shades || shades.length < 4) return;
  st(shades[0], { top: 0, left: 0, width: vw, height: hy });                 // сверху
  st(shades[1], { top: hy + hh, left: 0, width: vw, height: vh - hy - hh }); // снизу
  st(shades[2], { top: hy, left: 0, width: hx, height: hh });                // слева
  st(shades[3], { top: hy, left: hx + hw, width: vw - hx - hw, height: hh }); // справа

  if (_tourGhostEl) {
    const wc = document.querySelector(".win-controls");
    if (wc) {
      const wr = wc.getBoundingClientRect();
      _tourGhostEl.style.display = "";
      _tourGhostEl.style.top = wr.top - 4 + "px";
      _tourGhostEl.style.left = wr.left - 4 + "px";
      _tourGhostEl.style.width = wr.width + 8 + "px";
      _tourGhostEl.style.height = wr.height + 8 + "px";
    } else {
      _tourGhostEl.style.display = "none";
    }
  }
}

function _tourOnResize() {
  if (_tourIdx < 0 || _tourIdx >= TOUR_STEPS.length) return;
  const st = TOUR_STEPS[_tourIdx];
  if (st.center) return; // центральная карточка не зависит от ресайза целей
  const el = _tourTarget(st.sel);
  if (el) {
    _tourSpotlight(el.getBoundingClientRect());
    _tourRender(st, el);
  }
}
function _tourOnKey(e) {
  if (e.key !== "Escape") return;
  e.stopPropagation();
  stopUITour(true);
}

function _tourNext() {
  void _tourAdvance(1);
}

function _tourBack() {
  void _tourAdvance(-1);
}

/** Общий проход по шагам: выполняет action (может быть async — например,
 *  открыть заметку и включить вид «Граф»), затем рендерит подходящий шаг. */
async function _tourAdvance(dir) {
  for (let guard = 0; guard < 60; guard++) {
    const ni = _tourIdx + dir;
    if (ni < 0 || ni >= TOUR_STEPS.length) {
      if (dir > 0) {
        stopUITour(true);
        toast("Тур завершён. Вернуть: Настройки → Оформление → ❓ Подсказки", "ok");
      }
      return;
    }
    _tourIdx = ni;
    const st = TOUR_STEPS[ni];
    try { if (st.action) await st.action(); } catch (_) {}
    if (st.center || _tourTarget(st.sel)) return _tourRender(st);
    // скрытая цель — молча идём дальше в том же направлении
  }
}

function _tourRender(step, targetEl) {
  const { hl, pop } = _tourEls();
  if (!pop) { stopUITour(true); return; }

  let r = null;
  if (step.center) {
    // Центральная карточка: без кольца, спотлайт схлопывается в точку
    if (hl) hl.remove();
    _tourSpotlight(null);
    pop.classList.add("tp-center");
    pop.style.left = ""; pop.style.top = "";
  } else {
    pop.classList.remove("tp-center");
    const el = targetEl || _tourTarget(step.sel);
    // ВАЖНО: hl здесь может быть null (после центр-шага кольцо удалено) —
    // это не ошибка, кольцо пересоздаётся ниже. Глушим тур только без цели.
    if (!el) { stopUITour(true); return; }
    r = el.getBoundingClientRect();
    _tourSpotlight(r);
    // Кольцо пересоздаётся каждый шаг — анимации появления переигрываются
    if (hl) hl.remove();
    const ring = document.createElement("div");
    ring.id = "tourHl";
    ring.style.left = r.left - 4 + "px";
    ring.style.top = r.top - 4 + "px";
    ring.style.width = r.width + 8 + "px";
    ring.style.height = r.height + 8 + "px";
    document.body.appendChild(ring);
  }

  const last = _tourIdx === TOUR_STEPS.length - 1;
  pop.innerHTML = `
    <div class="tp-in">
    <div class="tp-head">
      <span class="tp-step">${_tourIdx + 1} / ${TOUR_STEPS.length}</span>
      <button class="tp-x" title="Закрыть подсказки">×</button>
    </div>
    <h3>${step.title}</h3>
    <p>${step.text}</p>
    <div class="tp-foot">
      <button class="ghost-btn small tp-skip">Пропустить всё</button>
      ${_tourIdx === 0 ? "" : `<button class="ghost-btn small tp-back">Назад</button>`}
      <button class="primary-btn tp-next">${last ? "Готово ✓" : "Далее →"}</button>
    </div>
    </div>`;

  // Центральная карточка: без позиционирования (CSS .tp-center), только хендлеры
  if (step.center) {
    pop.querySelector(".tp-x").onclick = () => stopUITour(true);
    pop.querySelector(".tp-skip").onclick = () => stopUITour(true);
    pop.querySelector(".tp-next").onclick = () => _tourNext();
    const bbC = pop.querySelector(".tp-back");
    if (bbC) bbC.onclick = () => _tourBack();
    return;
  }

  // УМНОЕ ПОЗИЦИРОВАНИЕ: выбираем сторону с максимальным запасом места,
  // приоритет снизу→сверху→справа→слева; высокие цели обходим сбоку.
  pop.style.visibility = "hidden";
  pop.style.left = "0px"; pop.style.top = "0px";
  requestAnimationFrame(() => {
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight, m = 12, edge = 12;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const tall = r.height > vh * 0.5;
    let cands;
    if (tall) {
      cands = [
        { x: r.right + m, y: Math.min(r.top + 8, vh - ph - edge) },
        { x: r.left - pw - m, y: Math.min(r.top + 8, vh - ph - edge) },
      ];
    } else {
      cands = [
        { x: cx - pw / 2, y: r.bottom + m },          // снизу (приоритет)
        { x: cx - pw / 2, y: r.top - ph - m },        // сверху
        { x: r.right + m, y: cy - ph / 2 },           // справа
        { x: r.left - pw - m, y: cy - ph / 2 },       // слева
      ];
    }
    let best = null;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      const ox = Math.max(0, edge - c.x) + Math.max(0, c.x + pw - (vw - edge));
      const oy = Math.max(0, edge - c.y) + Math.max(0, c.y + ph - (vh - edge));
      const fits = ox === 0 && oy === 0;
      // чем раньше в списке и чем меньше переполнение — тем лучше
      const score = (fits ? 1e6 : 0) - (ox + oy) * 10 - i;
      if (!best || score > best.score) best = { x: c.x, y: c.y, score };
    }
    const clampX = (v) => Math.min(Math.max(v, edge), Math.max(edge, vw - pw - edge));
    const clampY = (v) => Math.min(Math.max(v, edge), Math.max(edge, vh - ph - edge));
    pop.style.left = clampX(best.x) + "px";
    pop.style.top = clampY(best.y) + "px";
    pop.style.visibility = "";
  });

  pop.querySelector(".tp-x").onclick = () => stopUITour(true);
  pop.querySelector(".tp-skip").onclick = () => stopUITour(true);
  pop.querySelector(".tp-next").onclick = () => _tourNext();
  const bb = pop.querySelector(".tp-back");
  if (bb) bb.onclick = () => _tourBack();
}

// Автозапуск для тех, кто уже прошёл онбординг, но тур не видел
setTimeout(() => {
  if (document.getElementById("onboardingOverlay")) return; // онбординг сам запустит
  if (localStorage.getItem("apb-intro-required-v8") === "1") return; // ждём интро
  if (localStorage.getItem(TOUR_KEY) !== "done") startUITour(false);
}, 1400);

// Страховка: шторы тура не должны навсегда блокировать интерфейс.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.getElementById("tourDim")) stopUITour(true);
});
document.addEventListener("pointerdown", (e) => {
  if (e.target instanceof Element && e.target.classList.contains("td-shade")) stopUITour(true);
}, true);

apOn("tourReplayBtn", "click", () => startUITour(true));


// Made by MrDuck
// corrected v8 first-run gate
if(localStorage.getItem('apb-intro-required-v8')!=='done') setTimeout(showOnboarding,700);
