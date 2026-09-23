// Made by MrDuck
// ---------------------------------------------------------------------
// Address bar — smart URL vs. search resolution.
// ---------------------------------------------------------------------

// Search configuration belongs to the omnibox feature. During the frontend
// architecture split these globals were accidentally left behind in the old
// monolith, so typing a search query threw before navigation could start.
const SEARCH_ENGINES = Object.freeze({
  duckduckgo: "https://duckduckgo.com/?q=",
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  startpage: "https://www.startpage.com/sp/search?query=",
});
const SEARCH_ENGINE_KEY = "apb-search-engine";
function getSearchEngine() {
  const select = document.getElementById("searchEngineSelect");
  const stored = localStorage.getItem(SEARCH_ENGINE_KEY);
  const value = stored || (select && select.value) || "duckduckgo";
  return Object.prototype.hasOwnProperty.call(SEARCH_ENGINES, value) ? value : "duckduckgo";
}
function initSearchEngineControl() {
  const select = document.getElementById("searchEngineSelect");
  if (!select) return;
  select.value = getSearchEngine();
  select.addEventListener("change", () => {
    const value = Object.prototype.hasOwnProperty.call(SEARCH_ENGINES, select.value)
      ? select.value : "duckduckgo";
    localStorage.setItem(SEARCH_ENGINE_KEY, value);
  });
}
initSearchEngineControl();

function resolveAddressInput(raw) {
  const value = raw.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return value;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(value)) return "http://" + value;
  if (!/\s/.test(value) && /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(:\d+)?(\/.*)?$/.test(value)) {
    return "https://" + value;
  }
  const base = SEARCH_ENGINES[getSearchEngine()] || SEARCH_ENGINES.duckduckgo;
  return base + encodeURIComponent(value);
}

document.getElementById("addressForm").addEventListener("submit", (e) => {
  e.preventDefault();
  clearTimeout(omniTimer);
  clearTimeout(omniHomeTimer);
  const input = document.getElementById("addressInput");
  let raw = input.value.trim();
  if (!raw) return;
  // Режим названия сайта: в поле написано имя, а не адрес. Enter — просто
  // перейти (перезагрузить) текущую страницу, а не искать это имя.
  const t = (typeof currentTabObj === "function") ? currentTabObj() : null;
  if (t && !t.isNew && t.url && raw === (t.label || "")) raw = t.url;
  const url = resolveAddressInput(raw);
  navigateActiveTab(url, smartLabel(raw, url));
});

// ---------------------------------------------------------------------
// Bookmarks — v2: ПАПКИ (дерево, вложенность) + БУКМАРКЛЕТЫ.
// Папки хранит бэкенд (bookmark_folders, folder_id у закладки); панель
// строит дерево через bookmarks_tree одним пакетом. Букмарклет — закладка
// с URL «javascript:…»: клик исполняет код В АКТИВНОЙ вкладке (page_eval),
// ⚡ в строке. Поиск — по-прежнему substring (search_bookmarks).
// ---------------------------------------------------------------------

let bmFolders = []; // [{id, parent_id, name}]

function bmFolderLabel(id) {
  const f = bmFolders.find((x) => String(x.id) === String(id));
  return f ? f.name : "";
}

// каскад имён папки для селектов: «Работа / Подработка»
function bmPathOf(id, guard = 0) {
  if (guard > 8) return "";
  const f = bmFolders.find((x) => String(x.id) === String(id));
  if (!f) return "";
  const parent = f.parent_id ? bmPathOf(f.parent_id, guard + 1) : "";
  return parent ? parent + " / " + f.name : f.name;
}

function bmFillFolderSelects() {
  const opts = ['<option value="">— без папки —</option>']
    .concat(bmFolders.map((f) => `<option value="${f.id}">${escapeHtml(bmPathOf(f.id))}</option>`));
  document.getElementById("bmFolder").innerHTML = opts.join("");
  const popts = ['<option value="">— в корне —</option>']
    .concat(bmFolders.map((f) => `<option value="${f.id}">${escapeHtml(bmPathOf(f.id))}</option>`));
  document.getElementById("bmFolderParent").innerHTML = popts.join("");
}

// строка закладки (или букмарклета)
function bmRow(b) {
  const li = document.createElement("li");
  const isJs = /^javascript:/i.test(b.url);
  li.innerHTML =
    `<div style="min-width:0"><div class="title">${isJs ? "⚡ " : ""}${escapeHtml(b.title)}</div>` +
    `<div class="meta">${escapeHtml(isJs ? "букмарклет — код исполняется на странице" : b.url)}${b.tags.length ? " · " + escapeHtml(b.tags.join(", ")) : ""}</div></div>`;
  li.onclick = () => {
    if (isJs) {
      // букмарклет: код — в активную вкладку (page_eval)
      const code = b.url.replace(/^javascript:/i, "");
      if (typeof activeTabId !== "undefined" && activeTabId) {
        invoke("page_eval", { id: activeTabId, js: code }).catch(() => {});
      }
      return;
    }
    navigateActiveTab(b.url, b.title || undefined);
  };
  // ✕ — удалить закладку (файлы/страницу не трогаем)
  const del = document.createElement("button");
  del.className = "close";
  del.textContent = "✕";
  del.title = "Удалить закладку";
  del.onclick = (ev) => {
    ev.stopPropagation();
    invoke("bookmark_delete", { id: String(b.id) }).then(() => refreshBookmarks()).catch(() => {});
  };
  li.appendChild(del);
  return li;
}

async function refreshBookmarks(query = "") {
  const list = document.getElementById("bmList");
  if (query) {
    // поиск — плоский список (как раньше), но со ⚡ и ✕
    const results = await invoke("search_bookmarks", { query });
    list.innerHTML = "";
    if (!results.length) {
      list.innerHTML = `<li class="empty">Ничего не найдено</li>`;
      return;
    }
    for (const b of results) list.appendChild(bmRow(b));
    return;
  }
  // дерево: bookmarks_tree одним пакетом
  let tree;
  try { tree = await invoke("bookmarks_tree", {}); } catch { tree = null; }
  if (!tree) { list.innerHTML = `<li class="empty">Ошибка загрузки</li>`; return; }
  bmFolders = tree.folders || [];
  bmFillFolderSelects();
  list.innerHTML = "";
  const items = tree.items || [];
  if (!items.length && !bmFolders.length) {
    list.innerHTML = `<li class="empty">Пока нет закладок</li>`;
    return;
  }
  // корневые закладки (без папки)
  for (const b of items.filter((x) => !x.folder_id)) list.appendChild(bmRow(b));
  // папки: <details> с детьми (вложенность — каскадом имён)
  const byParent = new Map();
  for (const f of bmFolders) {
    const key = f.parent_id ? String(f.parent_id) : "";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(f);
  }
  const emitFolder = (folderId, host, depth) => {
    const kids = (byParent.get(String(folderId)) || []);
    for (const f of kids) {
      const det = document.createElement("details");
      det.className = "bm-folder";
      det.style.marginLeft = (depth * 10) + "px";
      const sum = document.createElement("summary");
      sum.textContent = "📁 " + f.name;
      det.appendChild(sum);
      host.appendChild(det);
      const inner = document.createElement("ul");
      inner.className = "list";
      det.appendChild(inner);
      for (const b of items.filter((x) => String(x.folder_id) === String(f.id))) {
        inner.appendChild(bmRow(b));
      }
      emitFolder(f.id, inner, depth + 1);
    }
  };
  emitFolder(null, list, 0);
}

document.getElementById("bmSearch").addEventListener("input", (e) => refreshBookmarks(e.target.value));

document.getElementById("bmAddBtn").addEventListener("click", async () => {
  const title = document.getElementById("bmTitle").value.trim();
  const url = document.getElementById("bmUrl").value.trim();
  const tags = document.getElementById("bmTags").value.split(",").map((t) => t.trim()).filter(Boolean);
  if (!title || !url) return;
  const folderId = document.getElementById("bmFolder").value || null;
  // add_bookmark с папкой: бэкенд принимает folderId (Option<Uuid>)
  await invoke("add_bookmark", { title, url, tags, note: null, folderId });
  document.getElementById("bmTitle").value = "";
  document.getElementById("bmUrl").value = "";
  document.getElementById("bmTags").value = "";
  await refreshBookmarks();
});

document.getElementById("bmFolderBtn").addEventListener("click", async () => {
  const name = document.getElementById("bmFolderName").value.trim();
  if (!name) return;
  const parentId = document.getElementById("bmFolderParent").value || null;
  await invoke("bookmark_folder_create", { name, parentId }).catch(() => {});
  document.getElementById("bmFolderName").value = "";
  await refreshBookmarks();
});

// ---------------------------------------------------------------------
// History
// ---------------------------------------------------------------------

// Заголовок записи истории: сначала реальный <title> из кэша вкладок (как во
// вкладках и адресной строке — «название видео» вместо домена); иначе если
// бэкенд записал голый хостнейм (поисковик), вытаскиваем поисковый запрос.
function histDisplayTitle(title, url) {
  const cached = (typeof titleCacheFor === "function") ? titleCacheFor(url) : "";
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  if (cached && cached !== host && cached !== url) return cached;
  const t = (title || "").trim();
  try {
    if (!t || t === host || t === url) {
      const q = typeof labelFromUrl === "function" ? labelFromUrl(url) : null;
      if (q) return "🔍 " + q;
    }
  } catch { /* не URL */ }
  return t || "(без названия)";
}

async function refreshHistory() {
  const visits = await invoke("recent_history", { limit: 50 });
  const list = document.getElementById("historyList");
  list.innerHTML = "";
  if (visits.length === 0) {
    list.innerHTML = '<li class="empty">История пуста — либо профиль анонимный и не пишет историю</li>';
    return;
  }
  for (const v of visits) {
    const li = document.createElement("li");
    li.innerHTML = `<div><div class="title">${escapeHtml(histDisplayTitle(v.title, v.url))}</div><div class="meta">${escapeHtml(hostnameOf(v.url))} · ${new Date(v.visited_at).toLocaleString()}</div></div>`;
    li.title = v.url;
    li.onclick = () => createTab(v.url, null, { background: true }); // фоном: текущая вкладка не меняется
    list.appendChild(li);
  }
}

// ---------------------------------------------------------------------
// Full history (Settings → all profiles, detailed rows)
// ---------------------------------------------------------------------

let histAllCache = [];

async function loadFullHistory() {
  const ul = document.getElementById("histAllList");
  if (!ul) return;
  ul.innerHTML = '<li class="empty">Загрузка…</li>';
  const scope = document.getElementById("histScopeSelect").value;
  try {
    histAllCache = await invoke("history_all_profiles", { limitPerProfile: 200, scope });
  } catch {
    histAllCache = [];
  }
  renderFullHistory();
}

function histHost(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "unknown"; } }
function histPeriodStart(value) { const now = new Date(); if (value === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); const days = Number(value); return days ? Date.now() - days * 864e5 : 0; }
function renderFullHistory() {
  const ul = document.getElementById("histAllList"); if (!ul) return;
  const query = (document.getElementById("histFilterInput").value || "").trim().toLowerCase();
  const period = document.getElementById("histPeriodSelect")?.value || "all", start = histPeriodStart(period);
  const sort = document.getElementById("histSortSelect")?.value || "new";
  let rows = histAllCache.filter(r => (!start || new Date(r.visited_at).getTime() >= start) && (!query || `${histDisplayTitle(r.title,r.url)} ${r.title} ${r.url} ${r.profile}`.toLowerCase().includes(query)));
  rows.sort((a,b) => sort === "old" ? new Date(a.visited_at)-new Date(b.visited_at) : sort === "site" ? histHost(a.url).localeCompare(histHost(b.url)) || new Date(b.visited_at)-new Date(a.visited_at) : new Date(b.visited_at)-new Date(a.visited_at));
  const todayStart = histPeriodStart("today"), domains = new Set(rows.map(r=>histHost(r.url))), profiles = new Set(rows.map(r=>r.profile));
  const insight = [rows.length, rows.filter(r=>new Date(r.visited_at).getTime()>=todayStart).length, domains.size, profiles.size];
  document.querySelectorAll("#histInsights b").forEach((el,i)=>el.textContent=String(insight[i] ?? 0));
  const stats=document.getElementById("histStats"); if(stats)stats.textContent=`Показано ${rows.length} из ${histAllCache.length}`;
  const counts={}; for(const r of rows)counts[histHost(r.url)]=(counts[histHost(r.url)]||0)+1;
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6),summary=document.getElementById("histSummary");
  if(summary){summary.innerHTML=top.length?'<span class="hist-summary-label">Чаще всего:</span>':'';for(const[host,count]of top){const chip=document.createElement("button");chip.className="hist-site-chip";chip.innerHTML=`<span>${escapeHtml(host.slice(0,1).toUpperCase())}</span><b>${escapeHtml(host)}</b><small>${count}</small>`;chip.onclick=()=>{document.getElementById("histFilterInput").value=host;renderFullHistory()};summary.appendChild(chip)}}
  ul.innerHTML=""; if(!rows.length){ul.innerHTML='<li class="history-empty"><b>Ничего не найдено</b><span>Измените период или поисковый запрос.</span></li>';return}
  let lastGroup="";
  for(const r of rows.slice(0,500)){
    const d=new Date(r.visited_at),host=histHost(r.url),day=d.toDateString();
    const group=sort==="site"?host:day;
    if(group!==lastGroup){lastGroup=group;const head=document.createElement("li");head.className="hist-day";if(sort==="site")head.textContent=host;else{const today=new Date().toDateString()===day,yest=new Date(Date.now()-864e5).toDateString()===day;head.textContent=today?"Сегодня":yest?"Вчера":d.toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"})}ul.appendChild(head)}
    const li=document.createElement("li");li.className="hist-entry";
    let origin="";try{origin=new URL(r.url).origin}catch{}
    li.innerHTML=`<div class="hist-favicon"><img alt="" src="${escapeHtml(origin?origin+'/favicon.ico':'')}"/><span>${escapeHtml(host.slice(0,1).toUpperCase())}</span></div><div class="h-main"><div class="h-title"></div><div class="h-url"></div><div class="h-meta"></div></div><span class="h-prof"></span><div class="hist-row-actions"><button data-copy title="Копировать адрес">⧉</button><button data-open title="Открыть в новой вкладке">↗</button></div>`;
    const img=li.querySelector("img");img.onerror=()=>img.classList.add("failed");
    li.querySelector(".h-title").textContent=histDisplayTitle(r.title,r.url);li.querySelector(".h-url").textContent=r.url;li.querySelector(".h-meta").textContent=`${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · ${host}`;li.querySelector(".h-prof").textContent=r.profile;
    li.querySelector("[data-copy]").onclick=async e=>{e.stopPropagation();try{await navigator.clipboard.writeText(r.url);toast("Адрес скопирован")}catch{}};
    li.querySelector("[data-open]").onclick=e=>{e.stopPropagation();createTab(r.url,null,{background:true})};li.onclick=()=>createTab(r.url,null,{background:true});ul.appendChild(li)
  }
}
document.getElementById("histReloadBtn").addEventListener("click", loadFullHistory);
document.getElementById("histScopeSelect").addEventListener("change", loadFullHistory);
document.getElementById("histFilterInput").addEventListener("input", renderFullHistory);
document.getElementById("histPeriodSelect")?.addEventListener("change", renderFullHistory);
document.getElementById("histSortSelect")?.addEventListener("change", renderFullHistory);
document.getElementById("histSearchClear")?.addEventListener("click", () => { document.getElementById("histFilterInput").value = ""; renderFullHistory(); document.getElementById("histFilterInput").focus(); });
document.getElementById("histClearActiveBtn")?.addEventListener("click", async () => {
  if (!(await confirm("Очистить всю историю ТЕКУЩЕГО профиля?"))) return;
  await invoke("clear_history");
  await loadFullHistory();
});

async function clearHistoryAndRefresh() {
  await invoke("clear_history");
  await refreshHistory();
}
document.getElementById("historyClearBtn").addEventListener("click", clearHistoryAndRefresh);
document.getElementById("historyClearBtn2").addEventListener("click", clearHistoryAndRefresh);

// ---------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------

async function refreshNotes() {
  const notes = await invoke("list_notes"); // теперь с папками: "Folder/Note.md"
  const list = document.getElementById("notesList");
  list.innerHTML = "";
  if (!notes.length) {
    list.innerHTML = '<li class="empty">Пока нет заметок</li>';
    return;
  }
  const mk = (n) => {
    const li = document.createElement("li");
    li.dataset.file = n; // для контекст-меню
    const base = n.includes("/") ? n.slice(n.lastIndexOf("/") + 1) : n;
    li.innerHTML = `<span class="title">${escapeHtml(base.replace(/\.md$/, ""))}</span>`;
    li.title = n;
    li.onclick = () => openNote(n);
    return li;
  };
  // Группировка по папкам (корневые — сверху)
  const groups = new Map();
  for (const n of notes) {
    const i = n.lastIndexOf("/");
    const folder = i >= 0 ? n.slice(0, i) : "";
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(n);
  }
  const folders = [...groups.keys()].sort((a, b) =>
    a === "" ? -1 : b === "" ? 1 : a.localeCompare(b));
  for (const folder of folders) {
    if (!folder) {
      for (const n of groups.get(folder)) list.appendChild(mk(n));
      continue;
    }
    const det = document.createElement("details");
    det.className = "note-folder";
    det.open = true;
    const sum = document.createElement("summary");
    sum.textContent = "📁 " + folder + " (" + groups.get(folder).length + ")";
    det.appendChild(sum);
    const ul = document.createElement("ul");
    ul.className = "list note-sub";
    for (const n of groups.get(folder)) ul.appendChild(mk(n));
    det.appendChild(ul);
    list.appendChild(det);
  }
}

async function openNote(path) {
  const content = await invoke("read_note", { path });
  openEditor(path, content);
}

document.getElementById("noteBackBtn").addEventListener("click", () => {
  document.getElementById("noteViewer").classList.add("hidden");
});

document.getElementById("noteAddBtn").addEventListener("click", async () => {
  let name = document.getElementById("noteName").value.trim();
  if (!name) return;
  if (!name.endsWith(".md")) name += ".md";
  const content = "# " + name.replace(/\.md$/, "") + "\n\n";
  try {
    await invoke("create_note", { path: name, content });
    document.getElementById("noteName").value = "";
    document.getElementById("noteContent").value = "";
    await refreshNotes();
    openEditor(name, content);
    document.getElementById("edText").focus();
  } catch (e) { alert(e); }
});

// ---------------------------------------------------------------------
// Omnibox suggestions — выпадающий список под адресной строкой:
// совпадения из истории при вводе. Стрелки ↑↓ + Enter, Esc — закрыть.
// ---------------------------------------------------------------------

const omniBox = document.getElementById("addressInput");
const omniForm = document.getElementById("addressForm");
const omniDrop = document.createElement("div");
omniDrop.id = "omniSuggest";
omniDrop.className = "omni-suggest hidden";
omniForm.appendChild(omniDrop);
// Такой же дроп подсказок — для поиска на главном экране («главное меню»).
// ВАЖНО: вешается в document.body, а не в homeForm (фикс журнала 130): внутри
// формы карточка обрезается по капсульному radius родителя и наследует его
// полупрозрачный surface-фон, через который просвечивает #apbBgLayer.
const homeBox = document.getElementById("homeSearchInput");
const homeForm = document.getElementById("homeSearchForm");
const homeDrop = document.createElement("div");
homeDrop.className = "omni-suggest hidden";
document.body.appendChild(homeDrop);
let omniItems = [], omniIdx = -1;
let omniHomeBgState = "";

// Позиционирование homeDrop: fixed по rect() формы поиска + стили important —
// каскад родителя (.home-search: капсульный radius, полупрозрачный фон) не пробьёт.
function omniHomeSurface() {
  if (!homeForm) return;
  const r = homeForm.getBoundingClientRect();
  const rs = getComputedStyle(document.documentElement);
  const s = homeDrop.style;
  s.setProperty("position", "fixed", "important");
  s.setProperty("top", (r.bottom + 6) + "px", "important");
  s.setProperty("left", r.left + "px", "important");
  s.setProperty("width", r.width + "px", "important");
  s.setProperty("margin", "0", "important");
  s.setProperty("background", rs.getPropertyValue("--bg") || "var(--bg-soft)", "important");
  s.setProperty("border", "1px solid " + (rs.getPropertyValue("--border-strong") || "var(--border-strong)"), "important");
  s.setProperty("border-radius", "12px", "important");
  s.setProperty("box-shadow", "var(--shadow-2)", "important");
  s.setProperty("overflow", "hidden", "important");
  // Гасим фоновую картинку интерфейса — иначе она светит сквозь карточку.
  const layer = document.getElementById("apbBgLayer");
  if (layer) { omniHomeBgState = layer.style.display || ""; layer.style.display = "none"; }
}
function omniHomeBgRestore() {
  const layer = document.getElementById("apbBgLayer");
  if (layer && omniHomeBgState !== "") { layer.style.display = omniHomeBgState; omniHomeBgState = ""; }
}

// Кэш истории: recent_history(300) стабилен внутри сессии — дёргать SQLite
// на кажду клавишу не нужно, достаточно раз в минуту (или после префикса).
let omniHistCache = [];
let omniHistCacheAt = 0;
function omniHistoryCached() {
  const now = Date.now();
  if (omniHistCache.length && now - omniHistCacheAt < 60000) {
    return Promise.resolve(omniHistCache);
  }
  return invoke("recent_history", { limit: 300 })
    .then((h) => { omniHistCache = h || []; omniHistCacheAt = now; return omniHistCache; })
    .catch(() => omniHistCache);
}

function omniRestoreWebviews() {
  if (typeof activeTabId !== "undefined" && activeTabId && typeof switchTab === "function") {
    const t = currentTabObj ? currentTabObj() : null;
    if (t && !t.isNew) switchTab(t.id);
  }
}
function omniHideDrop(drop) {
  if (!drop || drop.classList.contains("hidden")) return;
  drop.classList.add("hidden");
  omniIdx = -1;
  // если прятали вебвью ради подсказок — возвращаем вкладку
  omniRestoreWebviews();
  if (drop === homeDrop) omniHomeBgRestore();
}
function omniHide() { omniHideDrop(omniDrop); }

function omniHighlight(drop = omniDrop) {
  Array.from(drop.children).forEach((c, i) => c.classList.toggle("sel", i === omniIdx));
}

// --- Suggest v3: как у нормального браузера — до 5 живых вариантов ---
//  1. «Закладки» — твоё сохранённое (⭐, из search_bookmarks)
//  2. «История» — что уже частично искал/открывал (🕘, из recent_history)
//  3. «Подсказки» движка (⚡, search_suggest — по решению 2026-09-20 живые
//     подсказки ОТ ВЫБРАННОГО ПОИСКОВИКА разрешены; keystrokes уходят
//     движку, как в основном браузере; для URL-подобного ввода — не гоняем)
//  4. «Продолжение» — домены на префикс (✨, история + офлайн-словарь)
//  5. «Прямой URL» (🌐) — если похоже на адрес
//  6. «Искать …» (🔍) — всегда последний, гарантированно через выбранный поисковик
function omniEsc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
// подсветка совпадения внутри текста (безопасно: всё экранировано)
function omniHl(text, q) {
  const t = String(text || "");
  if (!q) return omniEsc(t);
  const i = t.toLowerCase().indexOf(String(q).toLowerCase());
  if (i < 0) return omniEsc(t);
  return omniEsc(t.slice(0, i))
    + '<b class="omni-hl">' + omniEsc(t.slice(i, i + q.length)) + "</b>"
    + omniEsc(t.slice(i + q.length));
}
// офлайн-словарь популярных доменов (только префиксные дополнения)
const OMNI_DOMAINS = [
  "youtube.com", "github.com", "gitlab.com", "vk.com", "habr.com",
  "reddit.com", "wikipedia.org", "telegram.org", "twitter.com", "x.com",
  "instagram.com", "facebook.com", "google.com", "translate.google.com",
  "mail.ru", "yandex.ru", "stackoverflow.com", "openai.com", "notion.so",
  "figma.com", "discord.com", "twitch.tv", "music.youtube.com", "rutracker.org",
];
// строит и добавляет пункт списка
function omniPush(kind, icon, mainHtml, sub, url, title) {
  omniItems.push({ kind, icon, mainHtml, sub, url, title });
}
function omniBuildDom(drop = omniDrop) {
  // item DOM + мышь: mousedown (не click — фокус не теряем до перехода)
  drop.innerHTML = "";
  omniItems.forEach((v, i) => {
    const d = document.createElement("div");
    d.className = "omni-item omni-" + v.kind + (i === omniIdx ? " sel" : "");
    const ic = document.createElement("span"); ic.className = "omni-ic"; ic.textContent = v.icon;
    const tx = document.createElement("span"); tx.className = "omni-t"; tx.innerHTML = v.mainHtml;
    const ur = document.createElement("span"); ur.className = "omni-u"; ur.textContent = v.sub || "";
    d.append(ic, tx, ur);
    d.onmousedown = (e) => {
      e.preventDefault(); // чтобы не терять фокус до перехода
      omniHideDrop(drop);
      navigateActiveTab(v.url, v.title || undefined);
    };
    drop.appendChild(d);
  });
}
function omniRenderFrom(inputEl, dropEl) {
// Made by MrDuck
  const raw = String((inputEl && inputEl.value) || "").trim();
  const query = raw.toLowerCase();
  if (!query) { omniHideDrop(dropEl); return; }
  const eng = (typeof getSearchEngine === "function") ? getSearchEngine() : "duckduckgo";
  const tpl = (typeof SEARCH_ENGINES !== "undefined" && SEARCH_ENGINES[eng]) || "https://duckduckgo.com/?q=";
  const wantUrlish = /^[\wа-яё-]+(\.[\wа-яё-]+){1,}(\/\S*)?$/i.test(raw) || raw.includes("://");
  // История + закладки + живые подсказки ОТ ВЫБРАННОГО ПОИСКОВИКА параллельно:
  // как в нормальном браузере — и что открывал, и что сохранено, и что
  // движок предлагает доопределить (решение 2026-09-20). Для URL-подобного
  // ввода подсказки не гоняем, ошибка движка не ломает локальные.
  Promise.all([
    omniHistoryCached(),
    typeof invoke === "function" ? invoke("search_bookmarks", { query: raw }).catch(() => []) : Promise.resolve([]),
    wantUrlish
      ? Promise.resolve([])
      : (typeof invoke === "function" ? invoke("search_suggest", { query: raw, engine: eng }).catch(() => []) : Promise.resolve([])),
  ]).then(([hist, bms, sugs]) => {
    hist = hist || [];
    bms = bms || [];
    omniItems = [];
    const seenUrl = new Set();
    const bare = /^[\wа-яё-]+$/i.test(raw) && !raw.includes(" ");

    function hostOf(u) {
      try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
    }
    function pushItem(kind, icon, mainHtml, sub, url, title) {
      if (seenUrl.has(url)) return;
      seenUrl.add(url);
      omniPush(kind, icon, mainHtml, sub, url, title);
    }

    // --- 1. Закладки: «это у тебя сохранено» ---
    for (const b of bms) {
      const u = b.url || "";
      const t = (b.title || "") + " " + u;
      if (!t.toLowerCase().includes(query)) continue;
      const title = b.title && b.title !== u ? b.title : u;
      pushItem("bm", "⭐", omniHl(title, raw), hostOf(u), u, b.title || u);
      if (omniItems.length >= 2) break;
    }
    // --- 2. История: «уже частично искал/открывал» ---
    for (const v of hist) {
      const u = v.url || "";
      if (!u) continue;
      const ul = u.toLowerCase();
      const t = (v.title || "").toLowerCase();
      if (!ul.includes(query) && !t.includes(query)) continue;
      const title = v.title && v.title !== u ? v.title : u;
      const mainTitle = omniHl(title, raw);
      pushItem("hist", "🕘", mainTitle, hostOf(u), u, v.title || u);
      if (omniItems.length >= 4) break;
    }
    // --- 3. Подсказки из выбранного поисковика: «что я искал / хотел
    //     найти» — выше истории, как в нормальном браузере ---
    for (const s of (sugs || [])) {
      const t_ = String(s || "").trim();
      if (!t_) continue;
      if (t_.toLowerCase() === query) continue;
      pushItem("sug", "⚡", omniHl(t_, raw), t("подсказка"), tpl + encodeURIComponent(t_), t_);
      if (omniItems.length >= 4) break;
    }
    // --- 4. «Что я мог хотеть»: продолжения доменов (для «голого» слова) ---
    if (bare) {
      const comp = new Set();
      for (const v of hist) {
        try {
          const h = new URL(v.url).hostname.replace(/^www\./, "");
          if (h.startsWith(query) && h.length > raw.length) comp.add(h);
        } catch {}
      }
      for (const d of OMNI_DOMAINS) if (d.startsWith(query) && d !== raw) comp.add(d);
      for (const h of comp) {
        const url = "https://" + h + "/";
        const mainHtml = omniEsc(raw) + '<span class="omni-comp">' + omniEsc(h.slice(raw.length)) + "</span>";
        pushItem("want", "✨", mainHtml, t("продолжение"), url, h);
        if (omniItems.length >= 5) break;
      }
    }
    // --- 5. Прямой URL ---
    if (wantUrlish) {
      const url = raw.includes("://") ? raw : "https://" + raw;
      pushItem("url", "🌐", omniEsc(raw), t("открыть сайт"), url, raw);
    }
    // --- 6. Поиск всегда последним (как у всех) ---
    const surl = tpl + encodeURIComponent(raw);
    pushItem("search", "🔍", t("Искать") + " «" + omniEsc(raw) + "»", t("поиск"), surl, raw);
    // Показываем максимум 5 вариантов (поиск всегда последний)
    const lastIsSearch = !!omniItems.length && omniItems[omniItems.length - 1].kind === "search";
    const searchItem = lastIsSearch ? omniItems[omniItems.length - 1] : null;
    omniItems = omniItems.slice(0, 5);
    if (searchItem && !omniItems.includes(searchItem)) {
      omniItems[omniItems.length - 1] = searchItem;
    }
    if (!omniItems.length) { omniHideDrop(dropEl); return; }
    if (omniIdx >= omniItems.length) omniIdx = -1;
    omniBuildDom(dropEl);
    // Палитра/подсказки — это HTML, а сайт рисуется ПОВЕРХ: прячем вебвью
    if (typeof activeTabId !== "undefined" && activeTabId) {
      const t = typeof currentTabObj === "function" ? currentTabObj() : null;
      if (t && !t.isNew) invokeV2("page_hide_all", {}).catch(() => {});
    }
    dropEl.classList.remove("hidden");
    if (dropEl === homeDrop) omniHomeSurface();
  }).catch(() => omniHideDrop(dropEl));
}

function omniKeyNav(e, drop) {
  if (!drop || drop.classList.contains("hidden")) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    omniIdx = Math.min(omniIdx + 1, omniItems.length - 1);
    omniHighlight(drop);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    omniIdx = Math.max(omniIdx - 1, -1);
    omniHighlight(drop);
  } else if (e.key === "Enter" && omniIdx >= 0) {
    e.preventDefault();
    const v = omniItems[omniIdx];
    omniHideDrop(drop);
    navigateActiveTab(v.url, v.title || undefined);
  } else if (e.key === "Escape") {
    omniHideDrop(drop);
  }
}
let omniTimer = null;
let omniHomeTimer = null;
omniBox.addEventListener("input", () => {
  clearTimeout(omniTimer);
  omniIdx = -1;
  // Debounce ~150ms: рендером подсказок (IPC в SQLite + page_hide_all)
  // занимаемся после паузы в наборе, а не на каждую клавишу.
  omniTimer = setTimeout(() => omniRenderFrom(omniBox, omniDrop), 150);
});
omniBox.addEventListener("keydown", (e) => omniKeyNav(e, omniDrop));
omniBox.addEventListener("blur", () => setTimeout(omniHide, 160));

// --- Тот же движок подсказок — для поиска на главном экране ---
if (homeBox && homeDrop) {
  homeBox.addEventListener("input", () => {
    clearTimeout(omniHomeTimer);
    omniIdx = -1;
    omniHomeTimer = setTimeout(() => omniRenderFrom(homeBox, homeDrop), 150);
  });
  homeBox.addEventListener("keydown", (e) => omniKeyNav(e, homeDrop));
  homeBox.addEventListener("blur", () => setTimeout(() => omniHideDrop(homeDrop), 160));
}

// ---------------------------------------------------------------------
// Command palette (Ctrl+K)
// ---------------------------------------------------------------------

const paletteOverlay = document.getElementById("paletteOverlay");
const paletteInput = document.getElementById("paletteInput");

// Палитра — HTML, а нативные вкладки рисуются ПОВЕРХ шелла. Поэтому при
// открытии прячем все вебвью, при закрытии возвращаем активную вкладку.
function paletteShowFix() {
  if (typeof activeTabId !== "undefined" && activeTabId) {
    try { invokeV2("page_hide_all", {}); } catch (_) {}
  }
}
function paletteCloseRestore() {
  if (typeof activeTabId !== "undefined" && activeTabId && typeof switchTab === "function") {
    try { switchTab(activeTabId); } catch (_) {}
  }
}

document.addEventListener("keydown", (e) => {
  // e.code — физическая клавиша: работает и на русской раскладке
  const k = (e.key || "").toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (k === "k" || e.code === "KeyK")) {
    e.preventDefault();
    paletteOverlay.classList.toggle("hidden");
    if (!paletteOverlay.classList.contains("hidden")) {
      paletteInput.value = "";
      paletteInput.focus();
      renderPalette("");
      paletteShowFix();
    } else {
      paletteCloseRestore();
    }
  }
  if (e.key === "Escape") {
    const wasPalette = !paletteOverlay.classList.contains("hidden");
    paletteOverlay.classList.add("hidden");
    if (internalOpen) closeInternal();
    if (wasPalette) paletteCloseRestore();
  }
  if ((e.ctrlKey || e.metaKey) && (k === "t" || e.code === "KeyT")) {
    e.preventDefault();
    // Новая вкладка = г��авный экран (как кнопка «+»)
    document.getElementById("newTabBtn").click();
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "e") {
    e.preventDefault();
    toggleEmergencyShortcut().catch((err) => alert(err));
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "Delete" || e.key === "Backspace")) {
    e.preventDefault();
    runPanicButton().catch((err) => alert(err));
  }
});

paletteOverlay.addEventListener("click", (e) => {
  if (e.target === paletteOverlay) {
    paletteOverlay.classList.add("hidden");
    paletteCloseRestore();
  }
});

paletteInput.addEventListener("input", (e) => renderPalette(e.target.value));

async function renderPalette(query) {
  const results = await invoke("search_commands", { query });
  const list = document.getElementById("paletteList");
  list.innerHTML = "";
  for (const c of results) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="title">${escapeHtml(c.title)}</span><span class="meta">${c.shortcut || ""}</span>`;
    li.onclick = () => runCommand(c.id);
    list.appendChild(li);
  }
}

async function runCommand(id) {
  paletteOverlay.classList.add("hidden");
  paletteCloseRestore();
  switch (id) {
    case "tabs.new":
      document.getElementById("newTabBtn").click();
      break;
    case "notes.create":
      openSidePanel("notes");
      document.querySelector("#notes .add-form").setAttribute("open", "");
      break;
    case "bookmarks.add":
      openSidePanel("bookmarks");
      document.querySelector("#bookmarks .add-form").setAttribute("open", "");
      break;
    case "profiles.switch":
      openInternal("settings");
      break;
    case "history.clear":
      await clearHistoryAndRefresh();
      break;
    case "privacy.emergency":
      await toggleEmergencyShortcut();
      break;
    case "privacy.audit":
      openInternal("privacy");
      await refreshPrivacy();
      break;
    case "vault.lock":
      await invoke("vault_lock");
      openInternal("vault");
      await refreshVault();
      break;
    case "ai.chat":
      toggleAiPane(true);
      break;
    case "panic.button":
      await runPanicButton();
      break;
  }
}

// ---------------------------------------------------------------------
// Privacy Engine
// ---------------------------------------------------------------------

const PRIVACY_FLAGS = [
  ["flagTrackers", "block_trackers"],
  ["flagAds", "block_ads"],
  ["flagFpScripts", "block_fingerprinting_scripts"],
  ["flagThirdPartyCookies", "block_third_party_cookies"],
  ["flagHttpsOnly", "https_only"],
  ["flagClearOnExit", "clear_cookies_on_exit"],
];

let currentPrivacyPolicy = null;

// ---------------------------------------------------------------------
// Shield-индикатор в тулбаре (виден всегда — тулбар не перекрывается
// вебвью). MAX = фиолетовый бейдж, Emergency = красный пульсирующий.
// ---------------------------------------------------------------------
async function updateShieldIndicator(ovPre) {
  const el = document.getElementById("shieldBadge");
  if (!el) return;
  try {
    const ov = ovPre || await invoke("get_privacy_overview");
    const emg = !!ov.emergency;
    const max = String(ov.level) === "Maximum";
    el.classList.toggle("emergency", emg);
    el.classList.toggle("max", !emg && max);
    if (emg) {
      el.textContent = "🚨 Экстренный режим";
      el.title = "Emergency Privacy Mode включён — клик открывает настройки приватности";
      el.classList.remove("hidden");
    } else if (max) {
      el.textContent = "🛡 МАКС защита";
      el.title = "Включён максимальный уровень приватности — клик открывает настройки";
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  } catch (e) { /* профиль ещё не готов */ }
}

document.getElementById("shieldBadge").addEventListener("click", async () => {
  openInternal("privacy");
  await refreshPrivacy();
});

setTimeout(() => { try { if (typeof updateShieldIndicator === "function") updateShieldIndicator(); } catch {} }, 0);

async function refreshPrivacy() {
  const ov = await invoke("get_privacy_overview");
  currentPrivacyPolicy = ov.policy;

  const levelSel = document.getElementById("privacyLevelSelect");
  levelSel.value = String(ov.level);

  document.getElementById("emergencyBtn").classList.toggle("active-danger", !!ov.emergency);
  document.getElementById("emergencyBtn").textContent =
    (ov.emergency ? "🚨 Emergency Mode ВКЛЮЧЁН — выключить" : "🚨 Emergency Privacy Mode");

  for (const [elId, key] of PRIVACY_FLAGS) {
    const el = document.getElementById(elId);
    el.checked = !!ov.policy[key];
    el.onchange = async () => {
      if (!currentPrivacyPolicy) return;
      currentPrivacyPolicy[key] = el.checked;
      currentPrivacyPolicy.level = "Custom";
      await invoke("update_privacy_policy", { policy: currentPrivacyPolicy });
      await refreshPrivacy();
    };
  }

  const wrSel = document.getElementById("webrtcSelect");
  wrSel.value = ov.policy.webrtc || "Enabled";
  wrSel.onchange = async () => {
    if (!currentPrivacyPolicy) return;
    currentPrivacyPolicy.webrtc = wrSel.value;
    currentPrivacyPolicy.level = "Custom";
    await invoke("update_privacy_policy", { policy: currentPrivacyPolicy });
    await refreshPrivacy();
  };

  const eh = document.getElementById("enforceHint");
  if (eh && ov.enforcement) {
    eh.textContent = `Маршрут: ${ov.enforcement.upstream || "прямой"} · DNS: ${ov.enforcement.doh || "системный"} · ${ov.enforcement.webrtc || ""}`;
  }

  const auditList = document.getElementById("auditList");
  auditList.innerHTML = "";
  for (const f of ov.findings || []) {
    const li = document.createElement("li");
    const cls = f.status === "Ok" ? "audit-ok" : f.status === "Critical" ? "audit-critical" : "audit-warn";
    li.innerHTML = `<span class="dot ${cls}"></span><div><div class="title">${escapeHtml(f.area)}</div><div class="meta">${escapeHtml(f.message)}</div></div>`;
    auditList.appendChild(li);
  }

  const bc = document.getElementById("blockedCounter");
  const st = ov.stats || {};
  bc.textContent = `Заблокировано запросов: ${st.total_blocked || 0}` +
    (st.proxy_live ? "" : " (прокси не активен)") +
    (st.rules ? ` · правил в базе: ${st.rules}` : "");

  let rst = document.getElementById("blockedResetBtn");
  if (!rst) {
    rst = document.createElement("button");
    rst.id = "blockedResetBtn";
    rst.className = "ghost-btn";
    rst.style.cssText = "margin-top:6px;font-size:12px";
    rst.textContent = "⟳ Сбросить счётчик блокировок";
    rst.addEventListener("click", async () => {
      await invoke("privacy_reset_stats");
      await refreshPrivacy();
    });
    bc.parentElement.insertBefore(rst, bc.nextSibling);
  }

  let bs = document.getElementById("blockedSites");
  if (!bs) {
    bs = document.createElement("ul");
    bs.id = "blockedSites";
    bs.className = "list";
    rst.parentElement.insertBefore(bs, rst.nextSibling);
  }
  bs.innerHTML = "";
  for (const s of (st.per_site || [])) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="meta">🚫 ${escapeHtml(s.site)} — <strong>${s.count}</strong></div>`;
    bs.appendChild(li);
  }

  // Свои списки блокировки: показываем и даём удалить
  const addForm = document.getElementById("blocklistAddBtn")?.closest("details");
  if (addForm) {
    let cl = document.getElementById("customLists");
    if (!cl) {
      cl = document.createElement("ul");
      cl.id = "customLists";
      cl.className = "list";
      addForm.parentElement.insertBefore(cl, addForm.nextSibling);
    }
    cl.innerHTML = "";
    for (const l of (ov.custom_lists || [])) {
      const li = document.createElement("li");
      const lines = l.text.split("\n").filter((s) => s.trim() && !s.trim().startsWith("#")).length;
      li.innerHTML = `<div><div class="title">${escapeHtml(l.name)}</div>` +
        `<div class="meta">${lines} доменов · ${escapeHtml(l.category)}</div></div>`;
      const x = document.createElement("button");
      x.className = "close";
      x.textContent = "✕";
      x.title = "Удалить список";
      x.onclick = async (ev) => {
        ev.stopPropagation();
        if (!(await confirm(`Удалить список «${l.name}» (${lines} доменов)?`))) return;
        try {
          await invoke("remove_blocklist", { name: l.name });
          await refreshPrivacy();
          toast("Список удалён");
        } catch (err) { alert("Ошибка: " + err); }
      };
      li.appendChild(x);
      cl.appendChild(li);
    }
  }

  // Исключения сайтов: сетевой блокировщик пропускает домен + поддомены
  const ovList = document.getElementById("siteOverridesList");
  if (ovList) {
    ovList.innerHTML = "";
    for (const o of (ov.site_overrides || [])) {
      const li = document.createElement("li");
      li.innerHTML =
        `<div><div class="title">🛡 ${escapeHtml(o.host)}</div>` +
        `<div class="meta">${o.allow_trackers ? "трекеры разрешены" : "в списке исключений"}</div></div>`;
      const x = document.createElement("button");
      x.className = "close";
      x.textContent = "✕";
      x.title = "Убрать исключение";
      x.onclick = async (ev) => {
        ev.stopPropagation();
        try {
          await invoke("site_override_remove", { host: o.host });
          await refreshPrivacy();
          toast("Исключение убрано");
        } catch (err) { alert("Ошибка: " + err); }
      };
      li.appendChild(x);
      ovList.appendChild(li);
    }
  }

  const dashboard = ov.dashboard || [];
  if (dashboard.length && !document.getElementById("fpDash")) {
    const p = document.createElement("p");
    p.className = "panel-subtitle";
    p.textContent = "Fingerprint-панель";
    auditList.parentElement.insertBefore(p, document.getElementById("blockedCounter").nextSibling);
    const ul = document.createElement("ul");
    ul.id = "fpDash";
    ul.className = "list";
    auditList.parentElement.insertBefore(ul, document.getElementById("blockedCounter"));
  }
  const fp = document.getElementById("fpDash");
  if (fp) {
    fp.innerHTML = "";
    for (const s of dashboard) {
      const li = document.createElement("li");
      li.innerHTML = `<div class="meta">${escapeHtml(s.surface)}: <strong>${escapeHtml(s.status)}</strong></div>`;
      fp.appendChild(li);
    }
  }

  updateShieldIndicator(ov);
}

document.getElementById("privacyLevelSelect").addEventListener("change", async (e) => {
  await invoke("set_privacy_level", { level: e.target.value });
  await refreshPrivacy();
});

document.getElementById("emergencyBtn").addEventListener("click", async () => {
  const on = !document.getElementById("emergencyBtn").classList.contains("active-danger");
  await invoke("set_emergency_mode", { on });
  await refreshPrivacy();
});

document.getElementById("privacyApplyBtn").addEventListener("click", async () => {
  const btn = document.getElementById("privacyApplyBtn");
  const old = btn.textContent;
  btn.textContent = "⟳ Применяю…";
  btn.disabled = true;
  try {
    const n = await invoke("privacy_apply_to_open_tabs");
    toast(n > 0
      ? `Политика блокировки применена к открытым вкладкам (${n})`
      : "Нет открытых веб-страниц — политика применится к новым вкладкам");
  } catch (e) {
    toast(`Не удалось применить: ${e}`);
  } finally {
    btn.textContent = old;
    btn.disabled = false;
  }
});

document.getElementById("blocklistAddBtn").addEventListener("click", async () => {
  const name = document.getElementById("blocklistName").value.trim() || "Мой список";
  const text = document.getElementById("blocklistText").value;
  if (!text.trim()) return;
  const added = await invoke("add_blocklist", { name, category: "Advertising", text });
  alert(`Добавлено доменов: ${added}`);
  document.getElementById("blocklistText").value = "";
  await refreshPrivacy();
});

// Готовые фильтры уровня расширений: EasyList / EasyPrivacy / AdGuard DNS.
// add_blocklist_from_url качает список, режет домены из hosts/ABP-синтаксиса
// и ставит их персистентно (повторный клик = обновление копии).
const PRESETS = [
  ["presetEasyList", "EasyList", "https://easylist.to/easylist/easylist.txt"],
  ["presetEasyPrivacy", "EasyPrivacy", "https://easylist.to/easylist/easyprivacy.txt"],
  ["presetAdGuard", "AdGuard DNS", "https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt"],
];
for (const [id, name, url] of PRESETS) {
  const b = document.getElementById(id);
  if (!b) continue;
  b.addEventListener("click", async () => {
    const old = b.textContent;
    b.textContent = "⏳ Скачиваю…";
    b.disabled = true;
    try {
      const n = await invoke("add_blocklist_from_url", { name, url });
      toast(`«${name}»: загружено ${n} доменов`);
      await refreshPrivacy();
    } catch (err) {
      alert("Не удалось установить список: " + err);
    } finally {
      b.textContent = old;
      b.disabled = false;
    }
  });
}

document.getElementById("overrideAllowBtn").addEventListener("click", async () => {
  const input = document.getElementById("overrideHostInput");
  let host = input.value.trim();
  if (!host) {
    // Пустой ввод → берём домен активной вкладки (если это сайт)
    const t = typeof activeTab === "function" ? activeTab() : null;
    if (t && t.url && /^https?:/i.test(t.url)) {
      try { host = new URL(t.url).hostname; } catch (e) {}
    }
  }
  if (!host) return alert("Укажите домен, например example.com");
  try {
    const saved = await invoke("site_override_set", { host, allow: true });
    input.value = "";
    toast(`«${saved}» исключён из блокировки`);
    await refreshPrivacy();
  } catch (err) { alert("Ошибка: " + err); }
});

async function toggleEmergencyShortcut() {
  const ov = await invoke("get_privacy_overview");
  await invoke("set_emergency_mode", { on: !ov.emergency });
  openInternal("privacy");
  await refreshPrivacy();
}

// ---------------------------------------------------------------------
// Panic Button (Ctrl+Shift+Delete)
// ---------------------------------------------------------------------

async function runPanicButton() {
// Made by MrDuck
  const done = await invoke("panic_button");
  openInternal("privacy");
  await Promise.all([refreshHistory(), refreshPrivacy()]);
  alert("Panic Button выполнено:\n\n• " + done.join("\n• "));
}

// ---------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------

let networkSettings = null;

async function refreshNetwork() {
  networkSettings = await invoke("get_network_settings");
  const mode = networkSettings.dns?.mode || "System";
  document.getElementById("dnsModeSelect").value = mode;
  document.getElementById("dohUrlInput").value = networkSettings.dns?.doh_url || "";

  const chainName = networkSettings.default_chain;
  let hop = null;
  if (chainName) hop = (networkSettings.chains?.[chainName]?.hops || [])[0] || null;
  document.getElementById("proxyTypeSelect").value = hop ? hop.kind : "";
  document.getElementById("proxyHostInput").value = hop ? hop.host : "";
  document.getElementById("proxyPortInput").value = hop ? hop.port : "";
}

document.getElementById("netSaveBtn").addEventListener("click", async () => {
  if (!networkSettings) networkSettings = {};
  networkSettings.dns = {
    mode: document.getElementById("dnsModeSelect").value,
    doh_url: document.getElementById("dohUrlInput").value.trim(),
    dot_host: "",
    custom_servers: [],
  };
  const ptype = document.getElementById("proxyTypeSelect").value;
  if (ptype) {
    const host = document.getElementById("proxyHostInput").value.trim();
    const port = parseInt(document.getElementById("proxyPortInput").value, 10) || 1080;
    networkSettings.add_chain = { name: "default", hops: [{ kind: ptype, host, port, username: null, password: null }] };
  } else {
    networkSettings.default_chain = null;
  }
  await invoke("save_network_settings", { settings: networkSettings });
  await refreshNetwork();
  alert("Настройки сети сохранены");
});

document.getElementById("routePreviewBtn").addEventListener("click", async () => {
  const host = document.getElementById("routeHostInput").value.trim();
  if (!host) return;
  const route = await invoke("route_preview", { host });
  const ul = document.getElementById("routePreview");
  ul.innerHTML = "";
  for (const n of route) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="meta">${n.encrypted ? "🔐" : "→"} ${escapeHtml(n.label)}</div>`;
    li.title = n.note || "";
    ul.appendChild(li);
  }
});

document.getElementById("netDiagBtn").addEventListener("click", async () => {
  const results = await invoke("run_network_diagnostics");
  const ul = document.getElementById("diagList");
  ul.innerHTML = "";
  for (const r of results) {
    const li = document.createElement("li");
    li.innerHTML = `<div><div class="title">${r.ok ? "✅" : "❌"} ${escapeHtml(r.name)}</div><div class="meta">${escapeHtml(r.detail || "")}</div></div>`;
    ul.appendChild(li);
  }
});

// ---------------------------------------------------------------------
// Secure Vault
// ---------------------------------------------------------------------

function setVaultUi(created, unlocked) {
 const setup=document.getElementById('vaultSetupBox'),line=document.getElementById('vaultStatusLine');
 setup.classList.toggle('hidden',created&&unlocked);document.getElementById('vaultContentBox').classList.toggle('hidden',!unlocked);document.getElementById('vaultLockBtn').classList.toggle('hidden',!unlocked);
 document.getElementById('vaultCreateFields').classList.toggle('hidden',created);document.getElementById('vaultCreateBtn').classList.toggle('hidden',created);document.getElementById('vaultUnlockField').classList.toggle('hidden',!created);document.getElementById('vaultUnlockBtn').classList.toggle('hidden',!created);
 line.textContent=created?'Сейф заблокирован':'Создайте мастер-фразу';document.getElementById('vaultExplain').textContent=created?'Введите мастер-фразу для расшифровки локальных данных':'AES-256-GCM · Argon2id · мастер-фраза не хранится на диске';
}

let vaultCache = [];
let vaultUnlocked = false;
let vaultLastTouch = 0;

async function refreshVault() {
  let st;
  try { st = await invoke("vault_status"); } catch { return; }
  setVaultUi(st.created, st.unlocked);
  vaultUnlocked = !!st.unlocked;
  const autoSel = document.getElementById("vaultAutoLock"); if (autoSel && st.auto_lock_secs) autoSel.value = String(st.auto_lock_secs);
  const crypto = document.getElementById("vaultCryptoStatus"); if (crypto) crypto.textContent = `${st.kdf || "Argon2id"} · ${st.cipher || "AES-256-GCM"} · случайная соль ${st.salt_bytes || 16} байт`;
  if (st.retry_after > 0) document.getElementById("vaultGateError").textContent = `Слишком много попыток. Повторите через ${st.retry_after} сек.`;
  vaultCache = [];
  if (st.unlocked) {
    try { vaultCache = await invoke("vault_list"); } catch { /* locked meanwhile */ }
  }
  renderVaultEntries();
}

function renderVaultEntries() {
  const grid = document.getElementById("vaultEntries");
  if (!grid) return;
  const qEl = document.getElementById("vaultSearch");
  const q = qEl ? qEl.value.trim().toLowerCase() : "";
  grid.innerHTML = "";
  const rows = vaultCache.filter((r) => {
    if (!q) return true;
    const hay = `${r[1]} ${r[2]}`.toLowerCase();
    return hay.includes(q);
  });
  if (!rows.length) {
    grid.innerHTML = '<div class="hint" style="grid-column:1/-1;text-align:center;padding:26px 0">' +
      (q ? "Ничего не найдено" : "Записей пока нет — добавьте первую через форму ниже") + "</div>";
    return;
  }
  for (const [id, title, meta] of rows) {
    const card = document.createElement("div");
    card.className = "pw-card";
    const head = document.createElement("div");
    head.className = "pc-title";
    const fav = document.createElement("span");
    fav.className = "pc-fav";
    fav.textContent = (title[0] || "?").toUpperCase();
    const tt = document.createElement("span");
    tt.textContent = title;
    head.append(fav, tt);
    const user = document.createElement("div");
    user.className = "pc-user";
    user.textContent = meta && meta !== "—" ? meta : "без логина";
    const btns = document.createElement("div");
    btns.className = "pc-btns";
    const mk = (label, fn) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = fn;
      return b;
    };
    btns.appendChild(mk("👁 Показать", async () => {
      try {
        const e = await invoke("vault_reveal", { id });
        uiDialog({
          message:
            `${e.title}\n\nЛогин: ${e.username || "—"}\nПароль: ${e.password || "—"}` +
            (e.url ? `\nURL: ${e.url}` : ""),
          kind: "alert",
        });
      } catch (err) { alert(err); }
    }));
    btns.appendChild(mk("📋 Логин", async () => {
      try {
        const e = await invoke("vault_reveal", { id });
        if (e.username) { await navigator.clipboard.writeText(e.username); toast("Логин скопирован"); }
      } catch (err) { alert(err); }
    }));
    btns.appendChild(mk("🔑 Пароль", async () => {
      try {
        const e = await invoke("vault_reveal", { id });
        if (e.password) { await navigator.clipboard.writeText(e.password); toast("Пароль скопирован"); }
      } catch (err) { alert(err); }
    }));
    card.append(head, user, btns);
    grid.appendChild(card);
  }
}
document.getElementById("vaultSearch")?.addEventListener("input", renderVaultEntries);

function vaultStrength(pass){let n=0;if(pass.length>=12)n++;if(pass.length>=18)n++;if(/[a-zа-я]/.test(pass)&&/[A-ZА-Я]/.test(pass))n++;if(/\d/.test(pass)&&/[^\w\s]/.test(pass))n++;return n}
function paintVaultStrength(){const p=document.getElementById('vaultPassInput').value,n=vaultStrength(p),bar=document.getElementById('vaultStrengthBar'),text=document.getElementById('vaultStrengthText');bar.style.width=(n*25)+'%';bar.dataset.level=String(n);text.textContent=['Слишком короткая','Слабая','Нормальная','Надёжная','Очень надёжная'][n]}
document.getElementById('vaultPassInput')?.addEventListener('input',paintVaultStrength);
document.getElementById("vaultCreateBtn").addEventListener("click", async () => {const pass=document.getElementById('vaultPassInput').value,confirm=document.getElementById('vaultPassConfirm').value,err=document.getElementById('vaultGateError');err.textContent='';if(pass.length<8){err.textContent='Мастер-фраза должна содержать не менее 8 символов';return}if(!confirm){err.textContent='Повторите мастер-фразу';return}if(pass!==confirm){err.textContent='Мастер-фразы не совпадают';return}if(!document.getElementById('vaultSecurityCheck').checked){err.textContent='Подтвердите предупреждение о восстановлении';return}try{await invoke('vault_create',{passphrase:pass});document.getElementById('vaultPassInput').value='';document.getElementById('vaultPassConfirm').value='';await refreshVault();if(localStorage.getItem('apb-pending-password-import')){localStorage.removeItem('apb-pending-password-import');document.getElementById('pwImportFile')?.click()}}catch(e){err.textContent='Не удалось создать сейф: '+e}});
document.getElementById("vaultUnlockBtn").addEventListener("click", async () => {const pass=document.getElementById('vaultUnlockInput').value,err=document.getElementById('vaultGateError');err.textContent='';if(!pass)return;try{await invoke('vault_unlock',{passphrase:pass});document.getElementById('vaultUnlockInput').value='';await refreshVault()}catch(e){err.textContent=String(e).replace(/^Error:\s*/, '')}});

document.getElementById("vaultLockBtn").addEventListener("click", async () => {
  await invoke("vault_lock");
  await refreshVault();
});

document.getElementById("veAddBtn").addEventListener("click", async () => {
  const title = document.getElementById("veTitle").value.trim();
  const username = document.getElementById("veUser").value.trim();
  const password = document.getElementById("vePass").value;
  const url = document.getElementById("veUrl").value.trim() || null;
  if (!title || !password) return;
  try {
    await invoke("vault_add_entry", {
      // Backend serde tag is "kind" with snake_case variants.
      kind: { kind: "password", title, username, password, url, totp_secret: null },
    });
    document.getElementById("veTitle").value = "";
    document.getElementById("veUser").value = "";
    document.getElementById("vePass").value = "";
    document.getElementById("veUrl").value = "";
  } catch (e) { alert(e); }
  await refreshVault();
});

// Highlight vault buttons once the passphrase is typed
document.getElementById("vaultPassInput")?.addEventListener("input", (e) => {
  const ready = e.target.value.trim().length >= 8;
  document.getElementById("vaultCreateBtn").classList.toggle("ready", ready);
  document.getElementById("vaultUnlockBtn").classList.toggle("ready", ready);
});

document.getElementById("pwGenBtn").addEventListener("click", async () => {
  const pw = await invoke("vault_generate_password", { length: 20 });
  document.getElementById("pwGenOut").textContent = pw;
  document.getElementById("pwGenRow").classList.remove("hidden");
});
document.getElementById("pwGenAgain")?.addEventListener("click", async () => {
  const pw = await invoke("vault_generate_password", { length: 20 });
  document.getElementById("pwGenOut").textContent = pw;
});
document.getElementById("pwGenCopy")?.addEventListener("click", async () => {
  const v = document.getElementById("pwGenOut").textContent;
  if (v) await navigator.clipboard.writeText(v);
});

// --- Import / export passwords (CSV, Chrome-compatible) ---

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function parseCSV(text) {
  // RFC-4180-ish parser
  const rows = [];
  let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

document.getElementById("pwExportBtn")?.addEventListener("click", async () => {
  try { const path = await invoke("vault_export_encrypted"); toast("Зашифрованный сейф экспортирован: " + path, "ok"); }
  catch (e) { toast("Ошибка экспорта: " + e, "err"); }
});
document.getElementById("pwBackupBtn")?.addEventListener("click", async () => {
  try { const path = await invoke("vault_backup_now"); toast("Зашифрованный бэкап создан: " + path, "ok"); }
  catch (e) { toast("Ошибка бэкапа: " + e, "err"); }
});
document.getElementById("vaultAutoLock")?.addEventListener("change", async (e) => {
  try { await invoke("vault_set_auto_lock", { seconds: Number(e.target.value) }); toast("Автоблокировка обновлена", "ok"); }
  catch (err) { toast("Не удалось изменить автоблокировку: " + err, "err"); }
});
// Только активность внутри страницы сейфа продлевает unlocked-сессию.
for (const type of ["pointerdown", "keydown", "input"]) document.getElementById("vault")?.addEventListener(type, () => {
  if (!vaultUnlocked || Date.now() - vaultLastTouch < 15000) return;
  vaultLastTouch = Date.now(); invoke("vault_touch").catch(() => refreshVault());
}, true);
setInterval(() => { if (vaultUnlocked) refreshVault(); }, 15000);

document.getElementById("pwImportBtn")?.addEventListener("click", () => document.getElementById("pwImportFile").click());
document.getElementById("pwImportFile")?.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
// Made by MrDuck
  let rows;
  try { rows = parseCSV(await file.text()); }
  catch { alert("Не удалось прочитать файл как CSV."); return; }
  if (!rows.length) { alert("Файл пуст."); return; }
  // Header detection: сначала точные имена колонок Chrome/Bitwarden, потом
  // общие слова. \uFEFF срезаем — наш экспорт кладёт BOM ради Excel.
  const head = rows[0].map((h) => h.replace(/^\uFEFF/, "").trim().toLowerCase());
  const findCol = (...patterns) => {
    for (const re of patterns) {
      const i = head.findIndex((h) => re.test(h));
      if (i >= 0) return i;
    }
    return -1;
  };
  // "username" содержит "name" — отсекаем негативным lookahead, иначе
  // имя записи уедет в логин (например, на CSV из Firefox).
  let iName = findCol(/^(name|title|имя)$/, /^(?!.*(user|логин)).*(name|title|имя)/);
  let iUrl = findCol(/^(url|login_uri)$/, /url|uri|website|сайт/);
  let iUser = findCol(/^(username|login_username)$/, /username|login|user|логин/);
  let iPass = findCol(/^(password|login_password)$/, /pass|пароль/);
  let dataRows;
  if (iPass < 0) { // заголовок не распознан: считаем колонки name,url,user,pass с первой строки
    iName = 0; iUrl = 1; iUser = 2; iPass = 3;
    dataRows = rows;
  } else {
    dataRows = rows.slice(1);
  }
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const valid = dataRows
    .map((r) => ({
      title: (r[iName] || "").trim(),
      url: (r[iUrl] || "").trim() || null,
      username: (iUser >= 0 ? (r[iUser] || "") : "").trim() || null,
      password: (r[iPass] || "").trim(),
    }))
    .map((r) => ({ ...r, title: r.title || hostOf(r.url || "") })) // Firefox отдаёт записи без name-колонки
    .filter((r) => r.title && r.password && r.password.toLowerCase() !== "password");
  if (!valid.length) { alert("Не найдено ни одной записи с названием и паролем."); return; }
  if (!(await confirm(`Импортировать ${valid.length} записей в сейф?`))) return;
  let ok = 0;
  for (const r of valid) {
    try {
      await invoke("vault_add_entry", {
        kind: { kind: "password", title: r.title, username: r.username, password: r.password, url: r.url, totp_secret: null },
      });
      ok++;
    } catch { /* skip broken row */ }
  }
  toast(`Импортировано записей: ${ok} из ${valid.length}`);
  await refreshVault();
});

// ---------------------------------------------------------------------
// AI assistant — right-side chat pane (like the note editor).
// First open shows provider setup; after saving, a normal chat.
// ---------------------------------------------------------------------

const AI_KIND_TO_ENUM = {
  ollama: "Ollama",
  open_ai_compatible: "OpenAiCompatible",
  anthropic_compatible: "AnthropicCompatible",
  custom_http: "CustomHttp",
};

const aiPane = document.getElementById("aiPane");

function aiConfigured() { return localStorage.getItem("apb-ai-configured") === "1"; }

function showAiSetup() {
  document.getElementById("aiSetup").classList.remove("hidden");
  document.getElementById("aiChatWrap").classList.add("hidden");
}
function showAiChat() {
  document.getElementById("aiSetup").classList.add("hidden");
  document.getElementById("aiChatWrap").classList.remove("hidden");
}

async function toggleAiPane(forceOpen = false) {
  const willOpen = forceOpen || aiPane.classList.contains("hidden");
  if (!willOpen) {
    aiPane.classList.add("hidden");
    syncPageLayout();
    return;
  }
  closeInternal(false);
  closeSidePanelKeepRect();
  aiPane.classList.remove("hidden");
  syncPageLayout(true);
  setTimeout(syncPageLayout, 220);
  await refreshAi();
  if (aiConfigured()) showAiChat(); else showAiSetup();
}

function closeSidePanelKeepRect() {
  sidePanel.classList.remove("open");
  document.querySelectorAll(".rail-item").forEach((b) => b.classList.toggle("active", b.dataset.tab === "ai"));
}

document.getElementById("aiClose").addEventListener("click", () => toggleAiPane(false));
document.getElementById("aiCfgToggle").addEventListener("click", () => {
  const setupHidden = document.getElementById("aiSetup").classList.contains("hidden");
  if (setupHidden) showAiSetup(); else showAiChat();
});

async function refreshAi() {
  let cfg;
  try { cfg = await invoke("ai_get_config"); } catch { return; }
  const enumToValue = Object.fromEntries(Object.entries(AI_KIND_TO_ENUM).map(([k, v]) => [v, k]));
  document.getElementById("aiKindSelect").value = enumToValue[cfg.kind] || "ollama";
  document.getElementById("aiBaseUrl").value = cfg.base_url || "";
  document.getElementById("aiModel").value = cfg.model || "";
  document.getElementById("aiKeyEnv").value = cfg.api_key_env || "";
}

document.getElementById("aiSaveCfgBtn").addEventListener("click", async () => {
  const status = document.getElementById("aiSetupStatus");
  const value = document.getElementById("aiKindSelect").value;
  try {
    await invoke("ai_save_config", {
      config: {
        kind: AI_KIND_TO_ENUM[value],
        base_url: document.getElementById("aiBaseUrl").value.trim(),
        model: document.getElementById("aiModel").value.trim() || "llama3.2",
        api_key_env: document.getElementById("aiKeyEnv").value.trim() || null,
        max_context_chars: 6000,
      },
    });
    localStorage.setItem("apb-ai-configured", "1");
    status.textContent = "";
    showAiChat();
  } catch (e) {
    status.textContent = "Ошибка сохранения: " + e;
  }
});

function chatMsgEl(role, text) {
  const d = document.createElement("div");
  d.className = "chat-msg " + role;
  d.textContent = text;
  return d;
}
function scrollChat() {
  const log = document.getElementById("aiReply");
  log.scrollTop = log.scrollHeight;
}
function autosizeAi() {
  const t = document.getElementById("aiPrompt");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 120) + "px";
}
document.getElementById("aiPrompt").addEventListener("input", autosizeAi);

async function sendAi() {
  const input = document.getElementById("aiPrompt");
  const text = input.value.trim();
  const useCtx = document.getElementById("aiCtxBtn")?.classList.contains("active");
  if (!text && !useCtx) return;
  const log = document.getElementById("aiReply");
  const meta = document.getElementById("aiMeta");
  log.appendChild(chatMsgEl("user", text || "(про текущую страницу)"));
  input.value = "";
  autosizeAi();
  scrollChat();
  const btn = document.getElementById("aiAskBtn");
  btn.disabled = true;
  meta.textContent = "Думаю…";

  let pageTitle = null;
  let pageContent = null;
  if (useCtx && activeTab()) {
    try {
      const ext = await invoke("page_extract_text", { url: activeTab().url });
      pageTitle = ext.title || activeTab().label;
      pageContent = ext.text;
      meta.textContent = "Страница прочитана, спрашиваю модель…";
    } catch (e) {
      log.appendChild(chatMsgEl("err", "Не удалось прочитать страницу: " + e));
      btn.disabled = false;
      meta.textContent = "";
      scrollChat();
      return;
    }
  }
  try {
    const report = await invoke("ai_chat", {
      prompt: text || "Кратко перескажи страницу ниже.",
      pageTitle,
      pageContent,
    });
    log.appendChild(chatMsgEl("bot", report.reply));
    meta.textContent =
      `${report.provider_local ? "локальный" : "облачный"} провайдер · секретов отфильтровано: ${report.secrets_blocked}`;
    uiSound(920, 0.05);
  } catch (e) {
    log.appendChild(chatMsgEl("err", "Ошибка: " + e));
    meta.textContent = "";
  }
  btn.disabled = false;
  scrollChat();
}
document.getElementById("aiAskBtn").addEventListener("click", sendAi);
document.getElementById("aiPrompt").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAi(); }
});
document.getElementById("aiCtxBtn")?.addEventListener("click", (e) => {
  const on = e.currentTarget.classList.toggle("active");
  e.currentTarget.title = on
    ? "Текст страницы ДОБАВЛЯЕТСЯ к запросу (клик — выключить)"
    : "Добавлять текст активной страницы в запрос";
});

// Translate the active page. КАРТОЧКА ПЕРЕВОДА — самостоятельный overlay-попап,
// полностью НЕ зависящий от AI-чата (журнал 2026-09-20): перевод через
// бесплатный Google translate_free, чат не открывается и не мусорится.
// Карточка рисуется в overlay.html (режим `tr`): переключатель «язык → язык»,
// галочка «всегда переводить», мини-меню ⋮ («что и как»).
const TRANSLATE_LANGS = [
  { lang: "русский", target: "ru" },
  { lang: "английский", target: "en" },
  { lang: "украинский", target: "uk" },
  { lang: "немецкий", target: "de" },
  { lang: "французский", target: "fr" },
  { lang: "испанский", target: "es" },
  { lang: "итальянский", target: "it" },
  { lang: "португальский", target: "pt" },
  { lang: "турецкий", target: "tr" },
  { lang: "польский", target: "pl" },
  { lang: "китайский", target: "zh-CN" },
  { lang: "японский", target: "ja" },
];

// Скрипт, который инжектится ВО ВКЛАДКУ (page_eval): переводит текст прямо
// на сайте (ЖУРНАЛ 2026-09-20 — требование пользователя: «переводить все
// на странице, а не в попапе»). Режимы через %CMD%: translate — собрать
// текстовые узлы видимых блоков, пакетно перевести (tr_translate_batch,
// параллельно волнами по 6), пропорционально разложить перевод обратно по
// узлам; restore — вернуть оригиналы; toggle — переключить ориг/перевод.
// Прогресс и финиш шлются через tr_report → событие tr-page-report, карточка
// слушает его и обновляет статус. Хранилище оригиналов — window.__apbTrMap
// (тот же JS-контекст вкладки переживает точечные page_eval).
const TR_PAGE_JS = `(function(){
  "use strict";
  var I = window.__TAURI_INTERNALS__;
  if (!I || !I.invoke) return;
  var CMD = "%CMD%", TARGET = "%TARGET%", SOURCE = "%SOURCE%";
  if (!window.__apbTrMap) window.__apbTrMap = new Map();
  var MODE = window.__apbTrMode || "orig";
  var SKIP = {SCRIPT:1,STYLE:1,NOSCRIPT:1,HEAD:1,TITLE:1,META:1,LINK:1,IFRAME:1,SVG:1,CODE:1,PRE:1,TEXTAREA:1,INPUT:1,SELECT:1,OPTION:1,CANVAS:1,OBJECT:1,EMBED:1,OL:1,UL:1};
  var BLOCK_RE = /BLOCK|LIST-ITEM|TABLE-CELL|TABLE-ROW|FLEX|GRID|TABLE/;
  var BLOCK_TAGS = {P:1,DIV:1,LI:1,H1:1,H2:1,H3:1,H4:1,H5:1,H6:1,TD:1,TH:1,HEADER:1,FOOTER:1,SECTION:1,ARTICLE:1,ASIDE:1,MAIN:1,NAV:1,FIGCAPTION:1,DT:1,DD:1,BLOCKQUOTE:1,FIGURE:1,TR:1,CAPTION:1,SUMMARY:1,LEGEND:1,FORM:1};
  function isBlock(el){
    if (el === document.body) return true;
    if (BLOCK_TAGS[el.nodeName]) return true;
    var d = getComputedStyle(el).display;
    return BLOCK_RE.test(d);
  }
  function visible(el){
    var p = el.parentElement;
    if (!p) return false;
    if (p.offsetParent === null && getComputedStyle(p).position !== "fixed") return false;
    return true;
  }
  function skip(el){
    for (var n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (SKIP[n.nodeName]) return true;
      if (n === document.body) return false;
      var cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.contentVisibility === "hidden") return true;
    }
    return false;
  }
  // Для каждой видимой текстовой ноды — ближайший блочный контейнер.
  function collectBlocks(){
    var by = new Map();
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    function letterT(t){ return /[A-Za-zА-Яа-яЁё]{3,}/.test(t); }
    var n;
    while ((n = walker.nextNode())) {
      if (!visible(n)) continue;
      var t = n.data || "";
      if (t.trim().length < 1 || !letterT(t)) continue;
      if (skip(n.parentNode)) continue;
      var blk = n.parentNode;
      while (blk && blk !== document.body && !isBlock(blk)) blk = blk.parentNode;
      if (!blk) blk = document.body;
      var arr = by.get(blk);
      if (!arr) { arr = []; by.set(blk, arr); }
      arr.push(n);
    }
    var blocks = [];
    by.forEach(function (nodes, el) { if (nodes.length) blocks.push({ el: el, nodes: nodes }); });
    return blocks;
  }
  // Группа: соединяем тексты внутри блока, режем по 1400 символов.
  function chunksOf(blocks){
    var chunks = [];
    for (var b = 0; b < blocks.length; b++) {
      var blk = blocks[b];
      var cur = [], len = 0;
      for (var i = 0; i < blk.nodes.length; i++) {
        var L = blk.nodes[i].data.length + 1;
        if (cur.length && len + L > 1400) { chunks.push(cur); cur = []; len = 0; }
        cur.push(blk.nodes[i]); len += L;
      }
      if (cur.length) chunks.push(cur);
    }
    return chunks;
  }
  function applyAll(mode){
    var any = false;
    window.__apbTrMap.forEach(function (e, n) {
      if (!n || n.nodeType !== 3 || !n.parentNode) return;
      n.data = (mode === "trans") ? e.trans : e.orig;
      any = true;
    });
    window.__apbTrMode = mode;
    return any;
  }
  function applyChunk(nodes, tr){
    var Ls = nodes.map(function (n) { return n.data.length > 0 ? n.data.length : 1; });
    var total = 0; for (var i = 0; i < Ls.length; i++) total += Ls[i];
    if (!total) total = 1;
    var pos = 0;
    for (var i = 0; i < nodes.length; i++) {
      var e = window.__apbTrMap.get(nodes[i]) || null;
      if (!e) { e = { orig: nodes[i].data, trans: "" }; window.__apbTrMap.set(nodes[i], e); }
      var cut = Math.round(tr.length * Ls[i] / total);
      if (i < nodes.length - 1) {
        var frag = tr.slice(pos, pos + cut);
        var sp = frag.lastIndexOf(" ");
        if (sp > 0) { cut = sp + 1; }
      }
      var piece = tr.slice(pos, pos + cut);
      e.trans = piece;
      nodes[i].data = piece;
      pos += cut;
    }
    if (pos < tr.length && nodes.length) {
      var last = nodes[nodes.length - 1];
      var e2 = window.__apbTrMap.get(last);
      e2.trans = e2.trans + tr.slice(pos);
      last.data = e2.trans;
    }
  }
  async function translate(){
    if (window.__apbTrWorking) return;
    applyAll("orig");
    window.__apbTrMap.clear();
    var blocks = collectBlocks();
    var chunks = chunksOf(blocks);
    if (!chunks.length) { try { await I.invoke("tr_report", { url: location.href, done: true, count: 0 }); } catch(e){} return; }
    window.__apbTrWorking = true;
    try {
      for (var c = 0; c < chunks.length; c += 6) {
        var sub = chunks.slice(c, c + 6);
        var texts = sub.map(function (ch) { return ch.map(function (n) { return n.data; }).join(" "); });
        var res = null;
        try { res = await I.invoke("tr_translate_batch", { texts: texts, target: TARGET, source: SOURCE }); } catch (e) {}
        if (res && res.length) {
          for (var k = 0; k < sub.length && k < res.length; k++) {
            if (res[k] && res[k].trim()) applyChunk(sub[k], res[k]);
          }
        }
      }
    } finally {
      window.__apbTrWorking = false;
    }
    MODE = "trans";
    window.__apbTrMode = "trans";
    try { await I.invoke("tr_report", { url: location.href, done: true, count: chunks.length }); } catch(e){}
  }
  if (CMD === "restore") { applyAll("orig"); return; }
  if (CMD === "toggle") {
    applyAll(MODE === "trans" ? "orig" : "trans");
    return;
  }
  translate();
})();`;

const TR_STORE_KEY = "apb-always-translate";
const TR_NEVER_KEY = "apb-never-translate";
function trStoreLoad(key) { try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch { return {}; } }
function trStoreSave(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* нет localStorage */ } }
function trOriginOf(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^www\./, "") : ""; } catch { return ""; }
}

let trPopup = null;
let trState = null;

function trPayload() {
  const s = trState;
  return {
    tr: {
      origin: s.origin,
      langs: TRANSLATE_LANGS,
      from: s.from,
      to: s.to,
      always: s.always,
      status: s.status,
      count: s.count,
      show: s.show,
      err: s.err,
    },
  };
}
function trRender() {
  if (trPopup && trState) trPopup.update(trPayload());
}
function trPageEval(js) {
  const t = (typeof currentTabObj === "function") ? currentTabObj() : null;
  if (!t || !t.id) return Promise.reject("нет активной вкладки");
  return invoke("page_eval", { id: t.id, js });
}
function trPageJs(cmd, to, from) {
  return TR_PAGE_JS
    .replace("%CMD%", cmd)
    .replace("%TARGET%", to)
    .replace("%SOURCE%", from);
}
async function trTranslate() {
  if (!trState) return;
  const t = (typeof currentTabObj === "function") ? currentTabObj() : null;
  if (!t || t.id !== trState.tabId) { trState = null; return; }
  trState.status = "loading";
  trState.show = "trans";
  trState.count = 0;
  trState.err = "";
  trRender();
  try {
    await trPageEval(trPageJs("translate", trState.to, trState.from));
  } catch (e) {
    trState.err = String(e);
    trState.status = "error";
    trRender();
  }
  // Финал приходит асинхронно через tr-page-report (скрипт вкладки).
}
function trAction(action, value) {
  const s = trState;
  if (!s) return;
  if (action === "tr-lang") {
    s.from = (value && value.from) || "auto";
    s.to = (value && value.to) || "ru";
    trTranslate();
  } else if (action === "tr-always") {
    s.always = !!(value && value.on);
    const m = trStoreLoad(TR_STORE_KEY);
    if (s.always) m[s.origin] = s.to; else delete m[s.origin];
    trStoreSave(TR_STORE_KEY, m);
    trRender();
  } else if (action === "tr-dot") {
    const item = (value && value.item) || "";
    if (item === "toggle") {
      const next = s.show === "trans" ? "orig" : "trans";
      trPageEval(trPageJs("toggle", s.to, s.from)).then(() => {
        s.show = next;
        trRender();
      }).catch(() => {});
    } else if (item === "retranslate") {
      trTranslate();
    } else if (item === "copy") {
      const js = `(function(){var i=window.__TAURI_INTERNALS__;if(!i||!i.invoke)return;var t=(document.body&&document.body.innerText||"");t=t.replace(/\\n{3,}/g,"\\n\\n").slice(0,200000);if(t)i.invoke("clipboard_write",{text:t}).catch(function(){});})();`;
      trPageEval(js).then(() => toast("Текст страницы скопирован", "ok")).catch(() => toast("Не удалось скопировать", "err"));
    } else if (item === "never") {
      trPageEval(trPageJs("restore", s.to, s.from)).catch(() => {});
      const n = trStoreLoad(TR_NEVER_KEY); n[s.origin] = true; trStoreSave(TR_NEVER_KEY, n);
      const m = trStoreLoad(TR_STORE_KEY); delete m[s.origin]; trStoreSave(TR_STORE_KEY, m);
      toast("Перевод для " + s.origin + " отключён", "ok");
      if (trPopup) trPopup.close();
    } else if (item === "reset") {
      trPageEval(trPageJs("restore", s.to, s.from)).catch(() => {});
      const m = trStoreLoad(TR_STORE_KEY); delete m[s.origin]; trStoreSave(TR_STORE_KEY, m);
      const n = trStoreLoad(TR_NEVER_KEY); delete n[s.origin]; trStoreSave(TR_NEVER_KEY, n);
      s.always = false;
      s.show = "orig";
      s.status = "done";
      toast("Настройки перевода для сайта сброшены", "ok");
      trRender();
    }
  } else if (action === "tr-copy") {
    const js = `(function(){var i=window.__TAURI_INTERNALS__;if(!i||!i.invoke)return;var t=(document.body&&document.body.innerText||"");t=t.replace(/\\n{3,}/g,"\\n\\n").slice(0,200000);if(t)i.invoke("clipboard_write",{text:t}).catch(function(){});})();`;
    trPageEval(js).then(() => toast("Текст страницы скопирован", "ok")).catch(() => toast("Не удалось скопировать", "err"));
  }
}
function trOpenCard(t, lang) {
  const origin = trOriginOf(t.url);
  if (!origin) { toast("Нет страницы для перевода", "err"); return; }
  if (trStoreLoad(TR_NEVER_KEY)[origin]) { toast("Перевод для " + origin + " отключён (⋮ → не переводить)", "err"); return; }
  if (trPopup && trState && trState.tabId === t.id && APBPopup.isOpen(trPopup.id)) {
    if (lang) trState.to = lang.target;
    trTranslate();
    return;
  }
  const always = trStoreLoad(TR_STORE_KEY);
  trState = {
    tabId: t.id,
    origin,
    from: "auto",
    to: (lang && lang.target) || always[origin] || "ru",
    always: !!always[origin],
    show: "trans",
    status: "idle",
    count: 0,
    err: "",
  };
  const btn = document.getElementById("aiTranslateBtn");
  const r = btn ? btn.getBoundingClientRect() : null;
  const x = r ? Math.max(4, Math.min(r.right - 380, window.innerWidth - 388)) : 40;
  const y = r ? r.bottom + 6 : 40;
  trPopup = APBPopup.card(
    { x, y, width: 380, height: 322, toggleable: true, ...trPayload() },
    trAction,
    () => { trPopup = null; trState = null; }
  );
  trTranslate();
}
window.trOpenCard = trOpenCard;

document.getElementById("aiTranslateBtn")?.addEventListener("click", () => {
  const t = (typeof currentTabObj === "function") ? currentTabObj() : null;
  if (!t) { toast("Нет открытой страницы для перевода.", "err"); return; }
  trOpenCard(t, null);
});

// Скрипт вкладки докладывает о завершении перевода — обновляем карточку.
try {
  window.__TAURI__.event.listen("tr-page-report", (e) => {
    const p = e.payload || {};
    if (!trState || trState.status !== "loading") return;
    const t = (typeof currentTabObj === "function") ? currentTabObj() : null;
    if (!t) return;
    if (trOriginOf(p.url || "") !== trState.origin) return;
    if (p.done) {
      trState.count = p.count || 0;
      trState.status = "done";
      trState.show = "trans";
      trRender();
    }
  });
} catch { /* event API недоступен */ }

// Авто-перевод «всегда на этом сайте»: страница сменила URL и для origin
// включён флаг — открыть карточку и перевести без лишних нажатий.
try {
  window.__TAURI__.event.listen("page-url-changed", (e) => {
    const { id, url } = e.payload || {};
    const t = (typeof currentTabObj === "function") ? currentTabObj() : null;
    if (!t || t.id !== id) return;
    const origin = trOriginOf(url);
    if (!origin) return;
    if (trStoreLoad(TR_NEVER_KEY)[origin]) return;
    if (!trStoreLoad(TR_STORE_KEY)[origin]) return;
    setTimeout(() => {
      const cur = (typeof currentTabObj === "function") ? currentTabObj() : null;
      if (cur && cur.id === id && cur.url === url) trOpenCard(cur, null);
    }, 260);
  });
} catch { /* event API недоступен */ }

// ---------------------------------------------------------------------
// Extensions
// ---------------------------------------------------------------------

async function refreshExtensions() {
  // Расширения СПРЯТАНЫ (сессия 111): страницы нет в DOM — тихо пропускаем,
  // код оставлен для расширений v2.
  if (!document.getElementById("extList")) return;
  const exts = await invoke("ext_list");
  const ul = document.getElementById("extList");
  ul.innerHTML = "";
  if (exts.length === 0) {
    ul.innerHTML = '<li class="empty">Расширения не установлены</li>';
    return;
  }
  for (const e of exts) {
    const li = document.createElement("li");
    const masks = (e.manifest.matches || []).join(", ") || "—";
    li.innerHTML = `<div><div class="title">${escapeHtml(e.manifest.name)} v${escapeHtml(e.manifest.version)}</div><div class="meta">id: ${escapeHtml(e.manifest.id)} · ${e.enabled_globally ? "включено" : "выключено"} · скрипт: ${escapeHtml(e.manifest.entry_point)} · сайты: ${escapeHtml(masks)}${e.manifest.permissions?.length ? " · права: " + e.manifest.permissions.join(", ") : ""}</div></div>`;

    const toggle = document.createElement("button");
    toggle.className = "ghost-btn";
    toggle.textContent = e.enabled_globally ? "Выключить" : "Включить";
    toggle.onclick = async () => {
      await invoke("ext_set_enabled", { extId: e.manifest.id, enabled: !e.enabled_globally });
      await refreshExtensions();
    };

    // Выдача прав: кнопка на каждое ЗАЯВЛЕННОЕ в манифесте право (выдать
    // можно только заявленное — бэкенд это проверяет). Опасные права после
    // выдачи требуют отдельного подтверждения (ext_approve_dangerous).
    const DANGEROUS = ["all_websites", "cookies", "history", "network", "filesystem", "ai_context"];
    for (const p of e.manifest.permissions || []) {
      const pb = document.createElement("button");
      pb.className = "ghost-btn";
      pb.textContent = "＋ " + p;
      pb.onclick = async () => {
        try {
          await invoke("ext_grant", { extId: e.manifest.id, perms: [p] });
          if (DANGEROUS.includes(p)) {
            const ok = await confirm(`Расширение «${e.manifest.name}» получит опасное право ${p}. Подтвердить?`);
            if (ok) await invoke("ext_approve_dangerous", { extId: e.manifest.id, perm: p });
          }
          const pol = await invoke("ext_sandbox_policy", { extId: e.manifest.id });
          alert("Право выдано: " + p + ".\nАктивные возможности: " + (pol.capabilities.join("; ") || "нет"));
        } catch (err) { alert(err); }
        await refreshExtensions();
      };
      li.appendChild(pb);
    }

    li.appendChild(toggle);
    ul.appendChild(li);
  }
}

document.getElementById("extInstallBtn")?.addEventListener("click", async () => {
  const path = document.getElementById("extPathInput").value.trim();
  if (!path) return;
  try {
    const installed = await invoke("ext_install", { path });
    alert(`Установлено: ${installed.manifest.name}. По умолчанию прав нет — выдайте нужные явно.`);
  } catch (e) { alert("Ошибка установки: " + e); }
  await refreshExtensions();
});


// Made by MrDuck\n// v8 AI interaction polish\ndocument.querySelectorAll('[data-ai-prompt]').forEach(b=>b.addEventListener('click',()=>{const p=document.getElementById('aiPrompt');p.value=b.dataset.aiPrompt;p.focus()}));document.getElementById('aiPrompt')?.addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(140,e.target.scrollHeight)+'px'});const aiLog=document.getElementById('aiReply');if(aiLog)new MutationObserver(()=>{document.getElementById('aiWelcome')?.classList.toggle('hidden',aiLog.children.length>0);aiLog.lastElementChild?.scrollIntoView({behavior:'smooth',block:'end'})}).observe(aiLog,{childList:true});\n