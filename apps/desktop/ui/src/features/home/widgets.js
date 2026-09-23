// Made by MrDuck
// ---------------------------------------------------------------------
// Home screen (Firefox-style): greeting, search, pinned tiles, recents
// ---------------------------------------------------------------------

const DEFAULT_PINNED = [
  { name: "YouTube", url: "https://youtube.com" },
  { name: "GitHub", url: "https://github.com" },
  { name: "Wikipedia", url: "https://wikipedia.org" },
  { name: "Reddit", url: "https://reddit.com" },
  { name: "Habr", url: "https://habr.com" },
  { name: "Telegram", url: "https://web.telegram.org" },
];

function getPinned() {
  try { return JSON.parse(localStorage.getItem("apb-pinned")) || DEFAULT_PINNED; }
  catch { return DEFAULT_PINNED; }
}
function setPinned(list) { localStorage.setItem("apb-pinned", JSON.stringify(list)); }

function hueOf(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function tileEl(item, onRemove) {
  const d = document.createElement("div");
  d.className = "tile";
  d.title = item.url;
  const av = document.createElement("div");
  av.className = "tile-av";
  try {
    const site = new URL(item.url.startsWith("http") ? item.url : "https://" + item.url);
    if (["http:", "https:"].includes(site.protocol)) {
      // Каскад favicon: сначала высокое разрешение (64px), потом DDG-сервис,
      // потом локальный /favicon.ico. Каждый следующий — только при ошибке.
      const sources = [
        "https://www.google.com/s2/favicons?domain=" + site.hostname + "&sz=64",
        "https://icons.duckduckgo.com/ip3/" + site.hostname + ".ico",
        site.origin + "/favicon.ico",
      ];
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      let idx = 0;
      img.onerror = () => {
        idx++;
        if (idx < sources.length) img.src = sources[idx];
        else av.remove();
      };
      img.onload = () => { if (img.naturalWidth < 3 && idx < sources.length) { idx++; img.src = sources[idx]; } };
      img.src = sources[idx];
      av.appendChild(img);
    } else {
      av.remove();
    }
  } catch {
    av.remove();
  }
  const nm = document.createElement("span");
  nm.className = "tile-name";
  nm.textContent = item.name;
  d.append(av, nm);
  d.setAttribute("data-url", item.url);
  d.draggable = true;
  d.addEventListener("dragstart", (e) => {
    if (e.target.closest(".tile-x")) { e.preventDefault(); return; }
    e.dataTransfer.setData("text/plain", item.url);
    e.dataTransfer.effectAllowed = "move";
    d.classList.add("tile-dragging");
  });
  d.addEventListener("dragend", () => d.classList.remove("tile-dragging"));
  d.onclick = () => navigateActiveTab(item.url.startsWith("http") ? item.url : "https://" + item.url);
  if (onRemove) {
    const x = document.createElement("button");
    x.className = "tile-x";
    x.textContent = "×";
    x.title = "Открепить";
    x.onclick = (e) => { e.stopPropagation(); onRemove(); };
    d.appendChild(x);
  }
  return d;
}

async function renderHome() {
  const h = new Date().getHours();
  document.getElementById("homeGreeting").textContent =
    h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";

  // Clock widget
  const tick = () => {
    const now = new Date();
    const t = document.getElementById("wClockTime");
    const d = document.getElementById("wClockDate");
    if (!t) return;
    t.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    d.textContent = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  };
  tick();
  if (!renderHome._clock) renderHome._clock = setInterval(tick, 15000);

  // Calendar widget
  renderCalendar();

  // Weather widget
  initWeather();

  // Quick tasks widget
  renderTasks();

  // Recent notes chips
  const nc = document.getElementById("noteChips");
  nc.innerHTML = "";
  try {
    const notes = await invoke("list_notes");
    for (const n of notes.filter((x) => x !== "untitled.md").slice(-6).reverse()) {
      const c = document.createElement("button");
      c.className = "recent-chip";
      c.type = "button";
      const f = document.createElement("span");
      f.className = "rc-fav";
      f.textContent = "▤";
      const s = document.createElement("span");
      s.textContent = n.replace(/\.md$/, "");
      c.append(f, s);
      c.onclick = () => openNote(n);
      nc.appendChild(c);
    }
    if (!notes.length) nc.innerHTML = '<span class="hint">Заметок пока нет — создайте первую в панели «Заметки»</span>';
  } catch { /* profile switching race */ }

  const grid = document.getElementById("pinnedTiles");
  grid.innerHTML = "";
  const pinned = getPinned();
  for (const p of pinned) {
    grid.appendChild(tileEl(p, () => {
      setPinned(getPinned().filter((x) => x.url !== p.url));
      renderHome();
    }));
  }
  const add = document.createElement("div");
  add.className = "tile tile-add";
  add.title = "Закрепить сайт";
  add.textContent = "+";
  add.onclick = async () => {
    let url = await prompt("URL сайта:", "https://");
    if (!url) return;
    if (!url.startsWith("http")) url = "https://" + url;
    const name = (await prompt("Название:", hostnameOf(url))) || hostnameOf(url);
    setPinned([...getPinned(), { name, url }]);
    renderHome();
  };
  grid.appendChild(add);

  // Перетаскивание плиток между собой: порядок сохраняется в apb-pinned.
  let dragEl = null;
  grid.addEventListener("dragstart", (e) => {
    dragEl = e.target.closest(".tile[data-url]:not(.tile-add)");
  });
  grid.addEventListener("dragover", (e) => {
    e.preventDefault();
    if (!dragEl) return;
    const target = e.target.closest(".tile:not(.tile-add)");
    if (!target || target === dragEl) return;
    const rect = target.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    grid.insertBefore(dragEl, before ? target : target.nextSibling);
  });
  grid.addEventListener("drop", (e) => {
    e.preventDefault();
    const tile = dragEl || e.target.closest(".tile[data-url]:not(.tile-add)");
    if (!tile) return;
    const order = [...grid.querySelectorAll(".tile[data-url]:not(.tile-add)")];
    const urls = order.map((t) => t.getAttribute("data-url"));
    const old = getPinned();
    const byUrl = new Map();
    for (const p of old) byUrl.set(p.url, p);
    const next = urls.map((u) => byUrl.get(u)).filter(Boolean);
    for (const p of old) if (!next.includes(p)) next.push(p);
    setPinned(next);
    renderHome();
  });
  grid.addEventListener("dragend", () => { dragEl = null; });

  const rc = document.getElementById("recentTiles");
  rc.innerHTML = "";
  try {
// Made by MrDuck
    const visits = await invoke("recent_history", { limit: 12 });
    const seen = new Set();
    for (const v of visits) {
      if (seen.has(v.url)) continue;
      seen.add(v.url);
      if (rc.children.length >= 6) break;
      const c = document.createElement("button");
      c.className = "recent-chip";
      c.type = "button";
      c.title = v.url;
      const f = document.createElement("span");
      f.className = "rc-fav";
      f.textContent = ((v.title || "?")[0] || "?").toUpperCase();
      const img=document.createElement('img');img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';
      try{const site=new URL(v.url);if(['http:','https:'].includes(site.protocol)){img.src=site.origin+'/favicon.ico';img.onerror=()=>img.remove();f.appendChild(img)}}catch{}

      const s = document.createElement("span");
      s.textContent = v.title;
      c.append(f, s);
      c.onclick = () => createTab(v.url, null, { background: true }); // фоном: текущая вкладка не меняется
      rc.appendChild(c);
    }
    if (!visits.length) rc.innerHTML = '<span class="hint">Здесь появятся посещённые сайты</span>';
  } catch { /* panel refresh may race profile switch */ }
}

// Shared compact calendar builder (home widget + board widget)
function buildCalNode(offset = 0) {
  const wrap = document.createElement("div");
  const base = new Date();
  const view = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const titleTxt = view.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const tt = document.createElement("div");
  tt.className = "cal-title-mini";
  tt.style.cssText = "font-size:11px;font-weight:700;color:var(--text-faint);margin-bottom:6px;text-transform:capitalize";
  tt.textContent = titleTxt;
  wrap.dataset.title = titleTxt;
  wrap.appendChild(tt);
  const grid = document.createElement("div");
  grid.className = "cal-grid";
  for (const d of ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]) {
    const c = document.createElement("div"); c.className = "cal-dow"; c.textContent = d; grid.appendChild(c);
  }
  let lead = (view.getDay() + 6) % 7;
  const dim = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const today = new Date();
  const isThis = view.getMonth() === today.getMonth() && view.getFullYear() === today.getFullYear();
  const prevDays = new Date(view.getFullYear(), view.getMonth(), 0).getDate();
  for (let i = lead - 1; i >= 0; i--) { const c = document.createElement("div"); c.className = "cal-day other"; c.textContent = prevDays - i; grid.appendChild(c); }
  for (let d = 1; d <= dim; d++) {
    const c = document.createElement("div"); c.className = "cal-day" + (isThis && d === today.getDate() ? " today" : ""); c.textContent = d; grid.appendChild(c);
  }
  while (grid.children.length % 7 !== 0) {
    const c = document.createElement("div"); c.className = "cal-day other"; c.textContent = grid.children.length - lead - dim + 1 > 0 ? grid.children.length - lead - dim + 1 : ""; grid.appendChild(c);
    if (grid.children.length - lead - dim >= 7) break;
  }
  wrap.appendChild(grid);
  return wrap;
}

function showHome() {
  internalOpen = null;
  internalHost.classList.add("hidden");
  showEmptyState(true);
  renderHome();
  // Мысль дня: новый случайный афоризм при каждом заходе на главную.
  try { if (window.__apbQuote && window.__apbQuote.onHome) window.__apbQuote.onHome(); } catch (_) {}
  // Фикс race condition (журнал 130): при возврате на главную прячем
  // нативные WebView2, иначе активная вкладка рисуется поверх шелла
  // и не даёт пользоваться главным экраном.
  try { if (typeof invokeV2 === "function") invokeV2("page_hide_all", {}); } catch (_) {}
  // При возврате на главный экран поле поиска должно быть чистым
  const hs = document.getElementById("homeSearchInput");
  if (hs) hs.value = "";
}

// ---------------------------------------------------------------------
// Calendar widget
// ---------------------------------------------------------------------

let calOffset = 0;
function renderCalendar() {
  const grid = document.getElementById("calGrid");
  const title = document.getElementById("calTitle");
  if (!grid) return;
  const base = new Date();
  const view = new Date(base.getFullYear(), base.getMonth() + calOffset, 1);
  title.textContent = view.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  grid.innerHTML = "";
  for (const d of ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]) {
    const c = document.createElement("div");
    c.className = "cal-dow";
    c.textContent = d;
    grid.appendChild(c);
  }
  // Monday-first offset
  let lead = (view.getDay() + 6) % 7;
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
  const today = new Date();
  const isThisMonth = view.getMonth() === today.getMonth() && view.getFullYear() === today.getFullYear();
  const prevDays = new Date(view.getFullYear(), view.getMonth(), 0).getDate();
  for (let i = lead - 1; i >= 0; i--) {
    const c = document.createElement("div");
    c.className = "cal-day other";
    c.textContent = prevDays - i;
    grid.appendChild(c);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const c = document.createElement("div");
    c.className = "cal-day" + (isThisMonth && d === today.getDate() ? " today" : "");
    c.textContent = d;
    grid.appendChild(c);
  }
  const total = lead + daysInMonth;
  while (total % 7 !== 0 || grid.children.length % 7 !== 0 || (7 - (total % 7)) > 0 && grid.children.length < Math.ceil(total / 7) * 7) {
    if (grid.children.length >= Math.ceil(total / 7) * 7) break;
    const c = document.createElement("div");
    c.className = "cal-day other";
    c.textContent = grid.children.length - total + 1;
    grid.appendChild(c);
  }
}
document.getElementById("calPrev")?.addEventListener("click", () => { calOffset--; renderCalendar(); });
document.getElementById("calNext")?.addEventListener("click", () => { calOffset++; renderCalendar(); });

// ---------------------------------------------------------------------
// Weather widget — Open-Meteo (free, no API key)
// ---------------------------------------------------------------------

// Made by MrDuck
const WX_CODES = {
  0: ["☀️", "Ясно"], 1: ["🌤️", "Преимущ. ясно"], 2: ["⛅", "Переменная облачность"], 3: ["☁️", "Облачно"],
  45: ["🌫️", "Туман"], 48: ["🌫️", "Изморозь"],
  51: ["🌦️", "Морось"], 53: ["🌦️", "Морось"], 55: ["🌧️", "Морось"],
  61: ["🌦️", "Дождь"], 63: ["🌧️", "Дождь"], 65: ["🌧️", "Ливень"],
  66: ["🌧️", "Ледяной дождь"], 67: ["🌧️", "Ледяной дождь"],
  71: ["🌨️", "Снег"], 73: ["🌨️", "Снег"], 75: ["❄️", "Сильный снег"], 77: ["❄️", "Снежные зёрна"],
  80: ["🌦️", "Ливни"], 81: ["🌧️", "Ливни"], 82: ["⛈️", "Сильные ливни"],
  85: ["🌨️", "Снегопад"], 86: ["❄️", "Снегопад"],
  95: ["⛈️", "Гроза"], 96: ["⛈️", "Гроза с градом"], 99: ["⛈️", "Гроза с градом"],
};

async function initWeather(force = false) {
  const body = document.getElementById("weatherBody");
  if (!body) return;
  let cfg = null;
  try { cfg = JSON.parse(localStorage.getItem("apb-weather")); } catch {}
  if (!cfg?.city) { renderWeatherIdle(); renderWeatherPreview(); return; }
  const fresh = cfg.data && Date.now() - cfg.ts < 30 * 60 * 1000;
  if (!force && fresh) { renderWeather(cfg); renderWeatherPreview(cfg); return; }
  body.innerHTML = '<span class="hint">Загрузка погоды…</span>';
  try {
    if (!cfg.lat || force) {
      const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cfg.city)}&count=1&language=ru&format=json`)).json();
      const g = geo.results && geo.results[0];
      if (!g) throw new Error("город не найден");
      cfg.lat = g.latitude; cfg.lon = g.longitude;
      cfg.city = g.name;
    }
    const wx = await (await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${cfg.lat}&longitude=${cfg.lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
      `&hourly=temperature_2m,weather_code` +
      `&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=2`)).json();
    cfg.data = wx.current;
    cfg.dmin = wx.daily?.temperature_2m_min?.[0];
    cfg.dmax = wx.daily?.temperature_2m_max?.[0];
    // Next 7 hours starting from the current hour
    const nowH = new Date().toISOString().slice(0, 13);
    const hIdx = wx.hourly.time.findIndex((t) => t >= nowH);
    cfg.hourly = (hIdx >= 0 ? wx.hourly.time.slice(hIdx, hIdx + 7) : []).map((t, i) => ({
      time: t,
      temp: wx.hourly.temperature_2m[hIdx + i],
      code: wx.hourly.weather_code[hIdx + i],
    }));
    cfg.ts = Date.now();
    localStorage.setItem("apb-weather", JSON.stringify(cfg));
    renderWeather(cfg);
    renderWeatherPreview(cfg);
  } catch (err) {
    body.innerHTML = `<span class="hint">Нет данных о погоде (${String(err.message || err)}).<br>Нажмите ✎ и укажите город.</span>`;
  }
}

function hourlyStrip(hourly) {
  if (!hourly || !hourly.length) return "";
  let s = '<div class="wx-hourly">';
  for (const h of hourly.slice(0, 6)) {
    const [ic] = WX_CODES[h.code] || ["🌡️"];
    const hh = new Date(h.time).getHours().toString().padStart(2, "0") + ":00";
    s += `<div class="wx-h"><span class="wx-h-t">${hh}</span><span class="wx-h-i">${ic}</span><span class="wx-h-v">${Math.round(h.temp)}°</span></div>`;
  }
  return s + "</div>";
}

function renderWeatherIdle() {
  const body = document.getElementById("weatherBody");
  if (body) body.innerHTML = '<span class="hint">Укажите город — нажмите ✎ или в Настройках → Погода</span>';
}

function renderWeather(cfg) {
  const body = document.getElementById("weatherBody");
  if (!body || !cfg.data) return;
  renderWeatherInto(body, cfg);
}

// --- Weather settings page: city search with suggestions + preview ---
let wxSearchTimer = null;
document.getElementById("wxSearchInput")?.addEventListener("input", (e) => {
  clearTimeout(wxSearchTimer);
  const q = e.target.value.trim();
  const list = document.getElementById("wxSuggest");
  if (q.length < 2) { list.innerHTML = ""; return; }
  wxSearchTimer = setTimeout(async () => {
    try {
      const geo = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=ru&format=json`)).json();
      list.innerHTML = "";
      for (const g of geo.results || []) {
        const li = document.createElement("li");
        li.innerHTML = `<div class="title"></div><div class="meta"></div>`;
        li.querySelector(".title").textContent = g.name;
        li.querySelector(".meta").textContent = [g.admin1, g.country].filter(Boolean).join(", ");
        li.onclick = async () => {
          localStorage.setItem("apb-weather", JSON.stringify({
            city: g.name, lat: g.latitude, lon: g.longitude, ts: 0,
          }));
          list.innerHTML = "";
          document.getElementById("wxSearchInput").value = g.name;
          await initWeather(true);
        };
        list.appendChild(li);
      }
      if (!(geo.results || []).length) list.innerHTML = '<li class="empty">Ничего не найдено</li>';
    } catch { list.innerHTML = '<li class="empty">Ошибка поиска (нет сети?)</li>'; }
  }, 350);
});

async function renderWeatherPreview(cfg) {
  const cur = document.querySelector("#wxPreviewCard .weather-body");
  const hourBox = document.getElementById("wxPreviewHourly");
  if (!cur) return;
  try {
    cfg = cfg || JSON.parse(localStorage.getItem("apb-weather"));
    if (!cfg?.city) { cur.innerHTML = '<span class="hint">Укажите город выше</span>'; return; }
    if (!cfg.lat) { await initWeather(true); cfg = JSON.parse(localStorage.getItem("apb-weather")); }
    const fresh = cfg.data && Date.now() - cfg.ts < 30 * 60 * 1000;
    if (!fresh) await initWeather(true), (cfg = JSON.parse(localStorage.getItem("apb-weather")));
    renderWeatherInto(cur, cfg);
    if (hourBox) hourBox.innerHTML = hourlyStrip(cfg.hourly).replace('class="wx-hourly"', 'class="wx-hourly" style="margin-top:10px"');
    const cc = document.getElementById("wxCurCity");
    if (cc) cc.textContent = `Текущий город: ${cfg.city}`;
  } catch (err) {
    cur.innerHTML = `<span class="hint">Ошибка: ${String(err.message || err)}</span>`;
  }
}

// Render weather markup into an arbitrary container (shared by widget+preview)
// Made by MrDuck
function renderWeatherInto(body, cfg) {
 const code=cfg.data?.weather_code??3,[icon,desc]=WX_CODES[code]||['🌡️',''],t=cfg.data?.temperature_2m??0,month=new Date().getMonth();
 const season=month<=1||month===11?'winter':month<=4?'spring':month<=7?'summer':'autumn';
 const condition=code===0?'sun':code>=95?'storm':code>=71&&code<=86?'snow':code>=51&&code<=82?'rain':code>=45&&code<=48?'fog':'cloud';
 body.className='weather-body wx-card wx-'+condition+' wx-'+season;
 const drops=Array.from({length:condition==='rain'||condition==='storm'?16:condition==='snow'?14:season==='autumn'?8:season==='spring'?7:0},(_,i)=>`<i style="--i:${i}"></i>`).join('');
 const seasonName=season==='winter'?'Зима':season==='spring'?'Весна':season==='summer'?'Лето':'Осень';
 body.innerHTML=`<div class="wx-fx" aria-hidden="true"><span class="wx-sun-disc"></span><span class="wx-cloud c1"></span><span class="wx-cloud c2"></span><span class="wx-haze"></span><span class="wx-drops">${drops}</span></div><div class="wx-main"><div class="wx-now"><span class="wx-icon">${icon}</span><span class="wx-temp">${Math.round(t)}°</span><span class="wx-place"><b>${escapeHtml(cfg.city||"")}</b><small>${desc} · ${seasonName}</small></span></div>${hourlyStrip(cfg.hourly)}<div class="wx-stats"><span><i>Ощущается</i><b>${Math.round(cfg.data?.apparent_temperature??0)}°</b></span><span><i>Влажность</i><b>${cfg.data?.relative_humidity_2m??"—"}%</b></span><span><i>Ветер</i><b>${Math.round(cfg.data?.wind_speed_10m??0)} км/ч</b></span><span><i>Сегодня</i><b>↑${Math.round(cfg.dmax??0)}° ↓${Math.round(cfg.dmin??0)}°</b></span></div></div>`;
}

document.getElementById("weatherCityBtn")?.addEventListener("click", async () => {
  const cur = (() => { try { return JSON.parse(localStorage.getItem("apb-weather"))?.city || ""; } catch { return ""; } })();
  const city = await prompt("Город для погоды:", cur || "Москва");
  if (!city || !city.trim()) return;
  localStorage.setItem("apb-weather", JSON.stringify({ city: city.trim(), ts: 0 }));
  initWeather(true);
});

// Quick tasks widget — upgraded model: {text, done, created, due, list}
function getTasks() {
  try {
    const raw = JSON.parse(localStorage.getItem("apb-tasks")) || [];
    // migrate legacy strings
    return raw.map((t) => (typeof t === "string" ? { text: t, done: false, created: Date.now() } : t));
  } catch { return []; }
}
function setTasks(ts) { localStorage.setItem("apb-tasks", JSON.stringify(ts)); }

function fmtDue(t) {
  if (!t.due) return "";
  const d = new Date(t.due);
  if (isNaN(d)) return "";
  const overdue = !t.done && d < new Date();
  return `${overdue ? "⚠ " : "⏰ "}${d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
}

// Shared renderer for home widget / board widget
function renderTasksInto(ul, { compact = false } = {}) {
  if (!ul) return;
  let tasks = getTasks();
  tasks.sort((a, b) => (a.done - b.done) || ((a.due || Infinity) - (b.due || Infinity)) || ((b.created || 0) - (a.created || 0)));
  ul.innerHTML = "";
  if (!tasks.length) {
    ul.innerHTML = compact ? '<li>Пока пусто</li>' : '<li class="empty" style="border:none;padding:2px 0;justify-content:flex-start">Пока пусто — добавьте задачу</li>';
    return;
  }
  tasks.forEach((t) => {
    const li = document.createElement("li");
    li.className = t.done ? "done" : "";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!t.done;
    cb.onchange = () => {
      const ts = getTasks();
      const i = ts.findIndex((x) => x.id === t.id);
      if (i >= 0) { ts[i].done = cb.checked; setTasks(ts); }
      refreshAllTaskWidgets();
    };
    const tx = document.createElement("span");
    tx.className = "t-text";
    tx.textContent = t.text;
    tx.title = `Создано: ${t.created ? new Date(t.created).toLocaleString() : "?"}` + (t.due ? `\nСрок: ${new Date(t.due).toLocaleString()}` : "");
    const meta = document.createElement("span");
    meta.className = "t-due";
    meta.textContent = fmtDue(t);
    const x = document.createElement("button");
    x.className = "t-x";
    x.textContent = "×";
    x.onclick = () => { setTasks(getTasks().filter((y) => y.id !== t.id)); refreshAllTaskWidgets(); };
    li.append(cb, tx, meta, x);
    ul.appendChild(li);
  });
}
function refreshAllTaskWidgets() {
  renderTasksInto(document.getElementById("taskList"));
  document.querySelectorAll("ul[data-role=tasks]").forEach((ul) => renderTasksInto(ul, { compact: true }));
}
function renderTasks() { refreshAllTaskWidgets(); }

document.getElementById("taskAddBtn")?.addEventListener("click", async () => {
  const text = await prompt("Новая задача:", "");
  if (!text || !text.trim()) return;
  const dueRaw = (await prompt("Срок (необязательно), формат: ГГГГ-ММ-ДД ЧЧ:ММ\nНапример: 2026-09-01 18:00", ""))?.trim();
  let due = null;
  if (dueRaw) {
    due = new Date(dueRaw.replace(" ", "T")).getTime();
    if (isNaN(due)) { alert("Не понял дату — задача сохранена без срока."); due = null; }
  }
  const ts = getTasks();
  ts.push({ id: "t" + Date.now().toString(36), text: text.trim(), done: false, created: Date.now(), due });
  setTasks(ts);
  refreshAllTaskWidgets();
});

document.getElementById("homeSearchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = document.getElementById("homeSearchInput").value.trim();
  if (v) {
    const url = resolveAddressInput(v);
    navigateActiveTab(url, smartLabel(v, url));
  }
});

// Made by MrDuck