// Made by MrDuck
// ---------------------------------------------------------------------
// Session persistence — open tabs are restored after a restart
// ---------------------------------------------------------------------

let activeProfileName = "";
let activeStorageMode = "Persistent";
let sessionTimer = null;

// Вкладки, которые попадают в сессию/воркспейс: пустые «новые вкладки»
// (пилюля без вебвью) сохранять нечего — фильтруем.
const savableTabs = () => tabs.filter((t) => !t.isNew && t.url);

// ЗАКРЕПЛЁННЫЕ ВКЛАДКИ (Chrome-style): t.pinned → всегда группируются ВВЕРХУ
// списка. Управление — из КОНТЕКСТНОГО МЕНЮ (правый клик по пилюле).
function togglePinTab(id) {
  const t = tabs.find((x) => x.id === id);
  if (!t || t.isNew) return;
  t.pinned = !t.pinned;
  // закреплённые — к началу массива (внутри своей группы — прежний порядок);
  // группу при закреплении покидаем (пины живут отдельно)
  if (t.pinned && t.group) { t.group = null; }
  const pinned = tabs.filter((x) => x.pinned);
  const rest = tabs.filter((x) => !x.pinned);
  tabs.length = 0;
  for (const p of pinned) tabs.push(p);
  for (const r of rest) tabs.push(r);
  renderTabStrip();
  scheduleSessionSave();
}

// ---------------------------------------------------------------------------
// ГРУППЫ-ПАПКИ ВКЛАДОК (tab groups): вкладка с t.group = id другой вкладки
// образует группу. Рендер: пилюли одной группы заворачиваются в рамку-папку
// (визуальное обозначение по краям); клик по заголовку папки — собрать/
// развернуть (свернутая показывает только заголовок). Создание — ПЕРЕТАСКИ-
// ВАНИЕМ пилюли НА другую (в drop-зоне, см. _makeTabDraggable up()).
// t.group хранит id «хозяина» группы (первой вкладки); сам хозяин group=null.
// ---------------------------------------------------------------------------
const GROUP_GAP = 8;

function groupOf(tab) {
  // группа вкладки = id хозяина (или сама, если она хозяин)
  return tab.group || null;
}

// все члены группы (включая хозяина)
function groupMembers(gid) {
  return tabs.filter((t) => t.id === gid || t.group === gid);
}

// вступить в группу другой вкладки (или выйти, если target null)
function joinGroup(draggedId, targetId) {
  const d = tabs.find((x) => x.id === draggedId);
  const t = tabs.find((x) => x.id === targetId);
  if (!d || !t || d.isNew || t.isNew || d.pinned || t.pinned) return false;
  // хозяин группы цели
  const hostId = t.group || t.id;
  if (d.id === hostId) return false;
  // если тащим ЦЕЛУЮ группу на чужую пилюлю — входят все члены
  const movers = (d.group ? groupMembers(d.id === groupHostOf(d) ? d.id : d.group) : [d]);
  for (const m of movers) m.group = hostId;
  // пересборка: члены группы подряд, сразу после хозяина
  const pinned = tabs.filter((x) => x.pinned);
  const groups = new Map(); // hostId -> [members]
  const loose = [];
  for (const t2 of tabs) {
    if (t2.pinned) continue;
    const hid = t2.group || (groupMembers(t2.id).length > 1 ? t2.id : null);
    if (hid) {
      if (!groups.has(hid)) groups.set(hid, []);
      groups.get(hid).push(t2);
    } else loose.push(t2);
  }
  tabs.length = 0;
  for (const p of pinned) tabs.push(p);
  for (const [hid, mem] of groups) for (const m of mem) tabs.push(m);
  for (const l of loose) tabs.push(l);
  renderTabStrip();
  scheduleSessionSave();
  return true;
}

// хозяин группы, где состоит вкладка (для drag — тащим группу целиком)
function groupHostOf(t) {
  return t.group || null;
}

// выйти из группы (кнопка «вынести» в контекст-меню / разрыв папки)
function leaveGroup(id) {
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  const wasHost = !t.group && groupMembers(t.id).length > 1;
  if (wasHost) {
    // распускание группы хозяина: все члены становятся свободными
    for (const m of groupMembers(t.id)) m.group = null;
  } else {
    t.group = null;
    // если после ухода группа пустеет — чисто
    const hid = t.group || null;
  }
  renderTabStrip();
  scheduleSessionSave();
}

// свернутость групп: Set<hostId>
let _collapsedGroups = new Set();

// контекстное меню пилюли (правый клик): Chrome-набор.
// ОТРИСОВКА — В ОВЕРЛЕЕ (overlay.html): HTML-меню шелла живёт ПОД нативным
// вебвью сайта, а оверлей — нативный прозрачный вебвью ПОВЕРХ вкладок,
// поэтому меню видно над рендерингом сайта, а не снизу него.
let tabMenuUnlisten = null;

function tabContextMenu(ev, tab) {
  ev.preventDefault();
  ev.stopPropagation();
  if (tabMenuUnlisten) { tabMenuUnlisten(); tabMenuUnlisten = null; }
  const actions = {};
  const mk = (label, action, fn, danger) => {
    actions[action] = fn;
    return danger ? { label, action, danger } : { label, action };
  };
  const items = [];
  if (!tab.isNew) {
    items.push(
      tab.pinned
        ? mk("Открепить вкладку", "apb-unpin", () => togglePinTab(tab.id))
        : mk("Закрепить вкладку", "apb-pin", () => togglePinTab(tab.id))
    );
    items.push(mk("Переименовать…", "apb-rename", () => renameTab(tab)));
    const inGroup = tab.group || groupMembers(tab.id).length > 1;
    if (inGroup) items.push(mk("Распустить группу", "apb-ungroup", () => leaveGroup(tab.id)));
    items.push(mk("Закрыть вкладку", "apb-close", () => closeTab(tab.id)));
    items.push(mk("Закрыть другие вкладки", "apb-close-others", () => {
      const keep = new Set([tab.id, ...tabs.filter((t) => t.isNew).map((t) => t.id)]);
      for (const t of [...tabs]) if (!keep.has(t.id)) closeTabNow(t.id);
      renderTabStrip();
      scheduleSessionSave();
    }, true));
  } else {
    items.push(mk("Закрыть вкладку", "apb-close", () => closeTab(tab.id)));
  }
  APBPopup.menu(items.map(it => ({ ...it, fn: actions[it.action] })), ev.clientX, ev.clientY);
}

// ---------------------------------------------------------------------
// Workspaces — named tab groups per profile (Zen-style pills)
// ---------------------------------------------------------------------

let wsDoc = null;

async function wsInit() {
  try { wsDoc = await invoke("workspaces_get"); } catch { return; }
  if (!wsDoc || !Array.isArray(wsDoc.list) || !wsDoc.list.length) return;
  const cur = wsDoc.list[wsDoc.current] || wsDoc.list[0];
  // Migrate: if the workspace is empty but a session was restored, adopt it
  if (cur && (!Array.isArray(cur.tabs) || !cur.tabs.length) && tabs.length) {
    const st = savableTabs();
    cur.tabs = st.map((t) => t.url);
    cur.active = Math.max(0, st.findIndex((t) => t.id === activeTabId));
    await saveWs();
  }
  renderWsPills();
}

async function saveWs() {
  if (!wsDoc) return;
  try { await invoke("workspaces_set", { data: wsDoc }); } catch { /* non-critical */ }
}

function renderWsPills() {
  const strip = document.getElementById("wsStrip");
  if (!strip || !wsDoc) return;
  strip.innerHTML = "";
  (wsDoc.list || []).forEach((w, i) => {
    const pill = document.createElement("div");
    pill.className = "ws-pill" + (i === wsDoc.current ? " active" : "");
    pill.dataset.i = i; // для контекст-меню
    pill.dataset.letter = (w.name || "?").trim()[0] || "?"; // иконка в свёрнутом рельсе
    pill.title = w.name + " · двойной клик — переименовать";
    const nm = document.createElement("span");
    nm.textContent = w.name;
    pill.appendChild(nm);
    const cnt = document.createElement("span");
    cnt.className = "ws-count";
    cnt.textContent = Array.isArray(w.tabs) ? w.tabs.length : 0;
    pill.appendChild(cnt);
    if ((wsDoc.list || []).length > 1) {
      const x = document.createElement("button");
      x.className = "ws-x";
      x.textContent = "×";
      x.title = "Удалить воркспейс";
      x.onclick = (ev) => { ev.stopPropagation(); deleteWs(i); };
      pill.appendChild(x);
    }
    pill.onclick = () => switchWs(i);
    pill.ondblclick = async (ev) => {
      ev.stopPropagation();
      const nn = await prompt("Имя воркспейса:", w.name);
      if (nn && nn.trim()) { w.name = nn.trim(); await saveWs(); renderWsPills(); }
    };
    strip.appendChild(pill);
  });
  const top = document.getElementById("wsStripTop");
  if (top) {
    top.innerHTML = "";
    for (const child of [...strip.children]) top.appendChild(child.cloneNode(true));
    [...top.querySelectorAll(".ws-pill")].forEach((pill, i) => {
      pill.onclick = () => switchWs(i);
      pill.ondblclick = async (ev) => {
        ev.stopPropagation();
        const w = wsDoc.list[i];
        const nn = await prompt("Имя воркспейса:", w.name);
        if (nn && nn.trim()) { w.name = nn.trim(); await saveWs(); renderWsPills(); }
      };
      pill.querySelector(".ws-x")?.addEventListener("click", ev => { ev.stopPropagation(); deleteWs(i); });
    });
  }
}

async function closeAllPageTabs() {
  for (const t of [...tabs]) {
    try { await invoke("page_close", { id: t.id }); } catch { /* already gone */ }
  }
  tabs = [];
  activeTabId = null;
}

async function enterWorkspace(w) {
  await closeAllPageTabs();
  const list = Array.isArray(w.tabs) ? w.tabs : [];
  for (const u of list.slice(-15)) {
    try { await createTab(u, null, { append: true }); } catch { /* skip */ }
  }
  const ai = typeof w.active === "number" && tabs[w.active] ? w.active : tabs.length - 1;
  if (tabs[ai]) switchTab(tabs[ai].id);
  else { openNewTabPage(); }
  renderWsPills();
  scheduleSessionSave();
}

async function switchWs(i) {
  if (!wsDoc || i === wsDoc.current) return;
  await persistSessionNow();          // store tabs into the OLD workspace
  wsDoc.current = i;
  await saveWs();
  await enterWorkspace(wsDoc.list[i]);
}

document.getElementById("wsAdd").addEventListener("click", async () => {
  if (!wsDoc || !Array.isArray(wsDoc.list)) return;
  const name = await prompt("Название нового воркспейса:", "Воркспейс " + (wsDoc.list.length + 1));
  if (!name || !name.trim()) return;
  await persistSessionNow();          // keep current tabs in their workspace
  wsDoc.current = wsDoc.list.length;
  wsDoc.list.push({ id: Date.now(), name: name.trim(), tabs: [], active: 0 });
  await saveWs();
  await enterWorkspace(wsDoc.list[wsDoc.current]);
});

async function deleteWs(i) {
  if (!wsDoc || wsDoc.list.length <= 1) return;
  const w = wsDoc.list[i];
  if (!(await confirm(`Удалить воркспейс «${w.name}»? Его вкладки будут потеряны.`))) return;
  const wasCurrent = i === wsDoc.current;
  wsDoc.list.splice(i, 1);
  if (wsDoc.current >= i) wsDoc.current = Math.max(0, wsDoc.current - 1);
  await saveWs();
  if (wasCurrent) await enterWorkspace(wsDoc.list[wsDoc.current]);
  else renderWsPills();
}

async function persistSessionNow() {
  const st = savableTabs();
  try {
    await invoke("session_save", {
      session: {
        // group = ИНДЕКС вкладки-хозяина папки в этом списке (id после
        // перезапуска новые — ремап по индексу, см. apbRemapGroups)
        tabs: st.map((t, i) => ({ url: t.url, label: t.label, pinned: !!t.pinned, group: t.group ? st.findIndex((x) => x.id === t.group) : null })),
        active: Math.max(0, st.findIndex((t) => t.id === activeTabId)),
      },
    });
  } catch { /* non-critical */ }
  // Mirror into the current workspace
  if (wsDoc && Array.isArray(wsDoc.list) && wsDoc.list.length) {
    const w = wsDoc.list[wsDoc.current];
    if (w) {
      w.tabs = st.map((t) => t.url);
      w.active = Math.max(0, st.findIndex((t) => t.id === activeTabId));
      saveWs();
    }
  }
}

// ---------------------------------------------------------------------
// Downloads — engine-level interception, rendered live via events
// ---------------------------------------------------------------------

let dlItems = [];

function hostOf(url) {
  try { return hostnameOf(url); } catch { return url; }
}

// Человекочитаемый размер: 45 МБ / 1.2 ГБ / 812 КБ
function dlFmt(b) {
  if (!b || b < 0) return "";
  if (b < 1024) return b + " Б";
  const kb = b / 1024;
  if (kb < 1024) return (kb >= 100 ? Math.round(kb) : kb.toFixed(1)) + " КБ";
  const mb = kb / 1024;
  if (mb < 1024) return (mb >= 100 ? Math.round(mb) : mb.toFixed(1)) + " МБ";
  const gb = mb / 1024;
  return gb.toFixed(2) + " ГБ";
}
function dlSizeText(it) {
  if (it.status === "downloading" && it.total > 0) return dlFmt(it.recv) + " / " + dlFmt(it.total);
  if (it.status === "downloading" && it.recv > 0) return dlFmt(it.recv);
  if ((it.status === "done" || it.status === "interrupted" || it.status === "paused") && it.total > 0) return dlFmt(it.total);
  return "";
}

function dlRowEl(item, isNew) {
  const li = document.createElement("li");
  if (isNew) li.className = "dl-new";
  li.classList.add("dl-row");
  const cls = item.status === "done" ? "st-done"
    : item.status === "failed" ? "st-failed"
    : item.status === "cancelled" || item.status === "paused" || item.status === "interrupted" ? "st-cancelled" : "st-active";
  li.innerHTML =
    `<div class="dl-main">` +
      `<div class="dl-nm"></div>` +
      `<div class="dl-sub">` +
        `<span class="dl-chip ${cls}"></span> ` +
        `<span class="dl-bar"><span class="dl-bar-fill${typeof item.progress === "number" && item.progress >= 0 ? "" : " anim"}"></span></span> ` +
        `<span class="dl-pct"></span>` +
        `<span class="dl-speed"></span>` +
      `</div>` +
      `<div class="dl-sub2"><span class="dl-meta-hint"></span><canvas class="dl-spark" width="96" height="22"></canvas></div>` +
    `</div>` +
    `<div class="dl-acts">` +
      `<button class="dl-act dl-pause" title="Приостановить загрузку">Ⅱ</button>` +
      `<button class="dl-act dl-cancel" title="Отменить и удалить частичный файл">✕</button>` +
      `<button class="dl-act dl-retry" title="Продолжить загрузку">▶</button>` +
    `</div>`;
  li.dataset.dlId = item.id;
  li.querySelector(".dl-nm").textContent = item.file_name.length > 42
    ? item.file_name.slice(0, 30) + "…" + item.file_name.slice(-10)
    : item.file_name;
  li.title = item.path;
  li.onclick = async () => {
    const dir = item.path.replace(/[\\/][^\\/]+$/, "");
    invoke("open_in_system", { url: dir }).catch(() => {});
  };
  const chip = li.querySelector(".dl-chip");
  const fill = li.querySelector(".dl-bar-fill");
  const pct = li.querySelector(".dl-pct");
  const speedEl = li.querySelector(".dl-speed");
  const hintEl = li.querySelector(".dl-meta-hint");
  const spark = li.querySelector(".dl-spark");
  // история скоростей (Б/с) для спарклайна — на строке, живёт с ней
  li._speedHist = [];
  li._lastRecv = 0;
  li._lastT = 0;
  // обновление строки БЕЗ пересоздания (анти-мерцание)
  li._update = (it) => {
    chip.textContent =
      it.status === "done" ? "готово"
      : it.status === "failed" ? "ошибка"
      : it.status === "cancelled" ? "отменено"
      : it.status === "paused" ? "пауза"
      : it.status === "interrupted" ? "остановлено"
      : "загружается…";
    chip.className = "dl-chip " + (it.status === "done" ? "st-done"
      : it.status === "failed" ? "st-failed"
      : it.status === "cancelled" || it.status === "interrupted" ? "st-cancelled" : "st-active");
    // ✕ — только у идущей закачки; ↻ — у прерванной/ошибки/готово
    btnP.disabled = false;
    btnP.style.display = it.status === "downloading" ? "" : "none";
    btnX.style.display = (it.status === "downloading" || it.resumable) ? "" : "none";
    btnR.style.display = (it.status !== "downloading" && it.resumable) ? "" : "none";
    hintEl.textContent = it.error ? hostOf(it.url) + " · " + it.error
      : it.sha256 ? hostOf(it.url) + " · SHA-256 " + it.sha256.slice(0, 12) + "…"
      : hostOf(it.url);
    const bar = li.querySelector(".dl-bar");
    if (it.status === "downloading") {
      bar.style.display = "";
      // скорость: дельта байт / дельта времени
      const now = performance.now();
      if (li._lastT && it.recv >= li._lastRecv) {
        const bps = (it.recv - li._lastRecv) * 1000 / Math.max(1, now - li._lastT);
        if (bps > 0) {
          li._speedHist.push(bps);
          if (li._speedHist.length > 24) li._speedHist.shift();
        }
      }
      li._lastRecv = it.recv;
      li._lastT = now;
      speedEl.textContent = dlSpeedText(it, li);
      drawSpark(spark, li._speedHist, true);
      li.classList.add("st-spark-on");
      // полоса: scaleX (GPU-композитор — 200 Гц без layout-мусора), НЕ width
      const setFill = (ratio) => {
        fill.classList.remove("anim");
        fill.style.transform = "scaleX(" + Math.max(0, Math.min(1, ratio)) + ")";
      };
      if (typeof it.progress === "number" && it.progress >= 0) {
        setFill(it.progress / 100);
      } else if (it.total > 0) {
        setFill(it.recv / it.total);
      } else {
        fill.classList.add("anim");
      }
      const sizeTxt = dlSizeText(it);
      if (sizeTxt) pct.textContent = sizeTxt;
    } else {
      bar.style.display = "none";
      speedEl.textContent = "";
      li.classList.remove("st-spark-on");
      const sizeTxt = dlSizeText(it);
      pct.textContent = it.status === "done" && sizeTxt ? sizeTxt
        : it.status === "done" ? "готово" : "";
      // финал: зафиксировать график (зелёный) — он остаётся видимым
      drawSpark(spark, li._speedHist, false);
      li.classList.toggle("st-row-done", it.status === "done");
    }
  };
  // ✕ — отменить (только ИДУЩАЯ закачка; у готовых файлов кнопки нет —
  // готовые файлы юзер удаляет сам в папке)
  const btnP = li.querySelector(".dl-pause");
  const btnX = li.querySelector(".dl-cancel");
  const btnR = li.querySelector(".dl-retry");
  btnP.addEventListener("click", (ev) => {
    ev.stopPropagation(); btnP.disabled = true;
    invoke("download_pause", { id: item.id }).catch((e) => toast("Пауза: " + e, "err"));
  });
  btnX.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (btnX.disabled) return;
    invoke("download_cancel", { id: item.id, path: item.path }).catch(() => {});
  });
  // ↻ — повторить/продолжить (остановлено после перезапуска, ошибка, готово)
  btnR.addEventListener("click", (ev) => {
    ev.stopPropagation();
    invoke("download_resume", { id: item.id }).catch((e) => toast("Не удалось продолжить: " + e, "err"));
    li.classList.remove("st-row-done");
    li._speedHist = [];
    li._lastRecv = 0; li._lastT = 0;
    chip.textContent = "загружается…"; chip.className = "dl-chip st-active";
    li.querySelector(".dl-bar").style.display = "";
    fill.classList.remove("done", "anim");
    fill.style.transform = "scaleX(0)";
    pct.textContent = "";
  });
  // Кнопки по статусу: ✕ виден ТОЛЬКО пока качается, ↻ — для всего остального
  li._update(item);
  return li;
}

// Скорость закачки: «4.2 МБ/с» (из последней пары замеров)
function dlSpeedText(it, li) {
  if (!li || !li._speedHist || !li._speedHist.length) return "";
  const bps = li._speedHist[li._speedHist.length - 1];
  return dlFmt(bps) + "/с";
}

// Мини-график скорости (спарклайн): полилиния + мягкое свечение
function drawSpark(canvas, hist, live) {
  const ctx = canvas.getContext && canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!hist || hist.length < 2) return;
  const max = Math.max(...hist, 1);
  ctx.beginPath();
  for (let i = 0; i < hist.length; i++) {
    const x = (i / (hist.length - 1)) * (w - 2) + 1;
    const y = h - 2 - (hist[i] / max) * (h - 4);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = live ? "#7fb0ff" : "#43c17a";
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.stroke();
  // точка «сейчас» на живом графике
  if (live) {
    const lx = w - 1;
    const ly = h - 2 - (hist[hist.length - 1] / max) * (h - 4);
    ctx.beginPath();
    ctx.arc(lx - 1.5, ly, 2, 0, Math.PI * 2);
    ctx.fillStyle = "#9fd0ff";
    ctx.fill();
  }
}

const dlRowMap = new Map(); // id -> li: точечное обновление без мерцания

function renderDownloads(newIds) {
  const ul = document.getElementById("dlList");
  if (!ul) return;
  dlRowMap.clear();
  ul.innerHTML = "";
  if (!dlItems.length) {
    ul.innerHTML = '<li class="empty">Загрузок пока нет</li>';
    return;
  }
  for (const it of dlItems) {
    const li = dlRowEl(it, newIds && newIds.has(it.id));
    dlRowMap.set(it.id, li);
    ul.appendChild(li);
  }
}

// Новая загрузка → окно Загрузок открывается САМО (как в норм браузерах:
// вся жизнь загрузки — в списке Загрузки, без отдельных карточек-тостов).
function ensureDownloadsOpen() {
  const railBtn = document.querySelector('.rail-item[data-tab="downloads"]');
  if (railBtn && !railBtn.classList.contains("active")) railBtn.click();
}

async function refreshDownloads() {
  try {
    dlItems = await invoke("downloads_list");
    renderDownloads();
  } catch { /* ignore */ }
}

try {
// Made by MrDuck
  // История загрузок живёт на диске (downloads-log.json) — заполняем
  // список сразу при старте, не ждём открытия панели.
  refreshDownloads();
  // dl-update: новая закачка → открыть панель; прогресс/статус — прямо
  // в строке файла (chip + полоса + %). Никаких тостов.
  window.__TAURI__.event.listen("dl-update", (e) => {
    const it = e.payload;
    if (!it || !it.id) return;
    const i = dlItems.findIndex((d) => d.id === it.id || (d.path === it.path && d.status === "downloading"));
    // эхо-«downloading» ПОСЛЕ финального статуса — пропускаем
    // (наблюдатель прогресса может успеть эмитнуть после Finished).
    // Повтор (retry) шлёт progress 0 — его пропустить нельзя.
    if (i >= 0 && dlItems[i].status !== "downloading" && it.status === "downloading"
        && (typeof it.progress !== "number" || it.progress < 0)) return;
    const isNewItem = i < 0;
    if (i >= 0) dlItems[i] = it; else dlItems.unshift(it);
    // АНТИ-МЕРЦАНИЕ: существующая строка обновляется точечно (_update),
    // полный рендер — только для НОВОЙ загрузки (с анимацией въезда).
    const existing = dlRowMap.get(it.id);
    if (existing && existing.isConnected && !isNewItem) {
      existing._update(it);
    } else {
      const newIds = new Set([it.id]);
      renderDownloads(isNewItem ? newIds : null);
      if (isNewItem && it.status === "downloading") ensureDownloadsOpen();
    }
  });
} catch { /* events unavailable */ }

document.getElementById("dlOpenFolder")?.addEventListener("click", async () => {
  try {
    const dir = await invoke("downloads_dir");
    invoke("open_in_system", { url: dir }).catch(() => {});
  } catch (e) { alert(e); }
});

// «✕ История» — очистить СПИСОК загрузок (файлы на диске не трогаем).
document.getElementById("dlClearHistory")?.addEventListener("click", async (e) => {
  e.stopPropagation();
  try {
    await invoke("downloads_clear");
    dlItems = [];
    renderDownloads();
    toast("История загрузок очищена (файлы не удалены)", "ok");
  } catch (err) { toast("Не удалось очистить историю: " + err, "err"); }
});

function scheduleSessionSave() {
  if (activeStorageMode !== "Persistent") return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(persistSessionNow, 700);
}

// Перед закрытием окна дампнем сессию немедленно (без 700мс-задержки), чтобы
// перезапуск поднял ровно тот же набор вкладок и URL — включая SPA-переходы,
// чей URL пришёл через page-url-changed прямо перед закрытием.
window.addEventListener("beforeunload", () => { void persistSessionNow(); });
window.addEventListener("pagehide", () => { void persistSessionNow(); });
try {
  window.__TAURI__.event.listen("external-open-url", (event) => {
    const url = String(event.payload || "");
    if (/^https?:\/\//i.test(url)) createTab(url, null, { append: true }).catch((e) => toast("Не удалось открыть внешнюю ссылку: " + e, "err"));
  });
} catch { /* event API unavailable */ }

// ---------------------------------------------------------------------
// Tabs — in-window, rendered as <iframe> panes. No native windows, so
// nothing to spawn or hang.
//
// Known limitation: sites sending X-Frame-Options / CSP frame-ancestors
// (Google, YouTube, most banks, many modern SPAs) refuse to render
// inside any iframe, by design of those sites — this is a browser-wide
// constraint of the iframe approach, not a bug here.
// ---------------------------------------------------------------------

let tabs = [];
let activeTabId = null;

function activeTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

function makeTabId() {
  return "tab-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// ---------------------------------------------------------------------
// Favicon кэш + адресная строка «название сайта / полный URL»
// ---------------------------------------------------------------------

// Иконки тянутся ТОЛЬКО с самого сайта (/favicon.ico) — без сторонних
// сервисов (приватность). Результат запоминается в localStorage: удачное —
// показываем сразу (в т.ч. у спящих вкладок и после перезапуска), неудачное
// («иконки нет») — чтобы не дёргать URL повторно каждым рендером.
const FAV_CACHE_KEY = "apb-favicons";
function favCacheLoad() {
  try {
    const c = JSON.parse(localStorage.getItem(FAV_CACHE_KEY));
    return c && typeof c === "object" ? c : {};
  } catch { return {}; }
}
function favCacheSave(c) { try { localStorage.setItem(FAV_CACHE_KEY, JSON.stringify(c)); } catch {} }
function favOriginOf(url) {
  if (!url) return null;
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.origin : null; } catch { return null; }
}
function favCached(origin) {
  const c = favCacheLoad();
  return origin in c ? c[origin] : null; // "" = известно, что иконки нет
}
function favRemember(origin, src) {
  const c = favCacheLoad();
  c[origin] = src;
  favCacheSave(c);
}
/** Готовит <img> с фавиконом сайта. true = картинка показывается,
 *  false = остаётся буква-фолбэк (иконки нет / спящая вкладка без кэша). */
function favAttach(img, url, opts = {}) {
  const origin = favOriginOf(url);
  if (!origin) return false;
  const cached = favCached(origin);
  if (cached === "") return false;                       // иконки точно нет
  if (opts.noNet && cached == null) return false;        // спящая — сеть не дёргаем
  const src = cached != null ? cached : origin + "/favicon.ico";
  img.onload = () => favRemember(origin, src);
  img.onerror = () => { favRemember(origin, ""); img.remove(); };
  img.src = src;
  return true;
}
window.__favAttach = favAttach;
window.__favOriginOf = favOriginOf;
window.__favCached = favCached;

// ---------------------------------------------------------------------
// Разрешения сайта: щит в адресной строке (camera/mic/geolocation)
// ---------------------------------------------------------------------
const permBtn = document.getElementById("permAddrBtn");
const permKeys = ["camera", "microphone", "geolocation"];
const permLabels = { camera: "Камера", microphone: "Микрофон", geolocation: "Геолокация" };
let permOrigin = "";
let permLastOrigin = "";
let permState = { camera: "ask", microphone: "ask", geolocation: "ask" };
const permInvoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args || {});

function permNormalize(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && u.host ? u.origin : "";
  } catch { return ""; }
}

function permSymbols(val) {
  const map = { ask: "Спрашивать", allow: "Разрешить", deny: "Запретить" };
  return map[val] || "Спрашивать";
}

async function permRefresh() {
  if (!permBtn) return;
  const origin = permNormalize(_addrUrl);
  permOrigin = origin;
  const trBtn = document.getElementById("aiTranslateBtn");
  if (trBtn) trBtn.classList.toggle("hidden", !origin);
  if (!origin) {
    permBtn.classList.add("hidden");
    permBtn.classList.remove("perm-has-rules", "perm-pending");
    permBtn.title = "Разрешения сайта";
    permLastOrigin = "";
    return;
  }
  permBtn.classList.remove("hidden");
  permBtn.title = origin + " — разрешения: " + permKeys.map((k) => {
    return k + "=" + (permState[k] || "ask");
  }).join(", ");
  if (permLastOrigin === origin) return;
  permLastOrigin = origin;
  try {
    const all = await permInvoke("site_permissions_get");
    const row = (all && all[origin]) || {};
    for (const k of permKeys) {
      if (["ask", "allow", "deny"].includes(row[k])) permState[k] = row[k];
    }
    const hasRules = permKeys.some((k) => row[k] && row[k] !== "ask");
    permBtn.classList.toggle("perm-has-rules", hasRules);
  } catch (e) {}
}
window.__permUpdate = permRefresh;

// Попап разрешений сайта — overlay-окно (отдельный always-on-top webview),
// поэтому нативные webview сайтов его не перекрывают (журнал 2026-09-18).
let permPopupHandle = null;
function permOpenPopup(anchorRect) {
  if (!permBtn) return;
  const origin = permNormalize(_addrUrl);
  if (!origin) { toast("Откройте сайт, чтобы настроить его разрешения", "err"); return; }
  permOrigin = origin;
  const width = 300;
  const height = Math.min(700, 120 + permKeys.length * 42);
  (async () => {
    try {
      const all = await permInvoke("site_permissions_get");
      const row = (all && all[origin]) || {};
      for (const k of permKeys) {
        if (["ask", "allow", "deny"].includes(row[k])) permState[k] = row[k];
      }
    } catch (e) {}
    const fields = permKeys.map((k) => ({ key: k, label: permLabels[k], value: permState[k] || "ask" }));
    const rect = anchorRect && anchorRect.getBoundingClientRect ? anchorRect.getBoundingClientRect() : null;
    const x = rect ? Math.max(4, Math.min(rect.right - width, window.innerWidth - width - 8)) : 4;
    const y = rect ? rect.bottom + 6 : 40;
    permPopupHandle = APBPopup.open({
      x, y, width, height, toggleable: true,
      form: { title: "Разрешения сайта", origin, fields }
    }, (action, value) => {
      permPopupHandle = null;
      if (action === "save") permApply(value || permState, "Разрешения сохранены. Обновите вкладку сайта, чтобы применить.");
      else if (action === "reset") permApply({ camera: "ask", microphone: "ask", geolocation: "ask" }, "Разрешения сайта сброшены (снова спрашивать)");
    });
  })();
}
async function permApply(values, okMsg) {
  if (!permOrigin) return;
  (async () => {
    try {
      for (const k of permKeys) {
        await permInvoke("site_permissions_set", { origin: permOrigin, permission: k, decision: ["ask", "allow", "deny"].includes(values[k]) ? values[k] : "ask" });
        if (["ask", "allow", "deny"].includes(values[k])) permState[k] = values[k];
      }
      toast(okMsg, "ok");
      permRefresh();
    } catch (e) {
      toast("Разрешения: " + e, "err");
    }
  })();
}
document.addEventListener("click", (ev) => {
  const t = ev.target.closest("#permAddrBtn");
  if (!t) return;
  // Повторный клик по щиту закрывает попап вместо переоткрытия (toggle).
  if (permPopupHandle && APBPopup.isOpen(permPopupHandle.id)) {
    permPopupHandle.close();
    permPopupHandle = null;
    return;
  }
  permOpenPopup(t);
});
try {
  window.__TAURI__.event.listen("site-permission-request", (ev) => {
    const d = ev.payload || {};
    const reqOrigin = permNormalize(d.origin || "");
    if (reqOrigin && permNormalize(_addrUrl) === reqOrigin) {
      permBtn.classList.add("perm-pending");
      setTimeout(() => permBtn.classList.remove("perm-pending"), 2600);
    }
  });
} catch {}
window.__favRemember = favRemember;

// Кэш реальных заголовков страниц (<title>): подстановка сразу, даже у
// спящих вкладок (восстановленных сессий) — «название видео» вместо домена.
const TITLE_CACHE_KEY = "apb-titles";
function titleCacheLoad() {
  try {
    const c = JSON.parse(localStorage.getItem(TITLE_CACHE_KEY));
    return c && typeof c === "object" ? c : {};
  } catch { return {}; }
}
function titleCacheSave(c) { try { localStorage.setItem(TITLE_CACHE_KEY, JSON.stringify(c)); } catch {} }
function titleCacheFor(url) {
  if (!url) return "";
  try {
    const c = titleCacheLoad();
    return c[url] || "";
  } catch { return ""; }
}
function titleCacheRemember(url, title) {
  if (!url || !title) return;
  try {
    const c = titleCacheLoad();
    if (c[url] === title) return;
    c[url] = title;
    const keys = Object.keys(c);
    if (keys.length > 800) {
      for (let i = 0; i < keys.length - 800; i++) delete c[keys[i]];
    }
    titleCacheSave(c);
  } catch {}
}
window.__titleCacheFor = titleCacheFor;

/** Лучшая известная подпись для URL: реальный <title> из кэша → переданный
 *  label → поисковый запрос из URL → домен. */
function smartTitle(url, label) {
  const c = titleCacheFor(url);
  if (c) return c;
  return label || labelFromUrl(url) || hostnameOf(url);
}
window.__smartTitle = smartTitle;

// Адресная строка: показываем НАЗВАНИЕ сайта + иконку слева; клик (фокус)
// раскрывает полный URL для редакти��ования; потеря фокуса без правок снова
// возвращает название.
const addrInput = document.getElementById("addressInput");
const addrFavEl = document.getElementById("addrFav");
let _addrUrl = "", _addrTitle = "";

function setAddrFav(url) {
  const form = document.getElementById("addressForm");
  if (!addrFavEl || !form) return;
  const origin = favOriginOf(url);
  if (!origin) {
    addrFavEl.classList.add("hidden");
    form.classList.remove("has-fav");
    return;
  }
  const cached = favCached(origin);
  if (cached === "") {
    addrFavEl.classList.add("hidden");
    form.classList.remove("has-fav");
    return;
  }
  const src = cached != null ? cached : origin + "/favicon.ico";
  addrFavEl.onload = () => favRemember(origin, src);
  addrFavEl.onerror = () => {
    favRemember(origin, "");
    addrFavEl.classList.add("hidden");
    form.classList.remove("has-fav");
  };
  addrFavEl.src = src;
  addrFavEl.classList.remove("hidden");
  form.classList.add("has-fav");
}

function updateAddressBar(url, title) {
  _addrUrl = url || "";
  _addrTitle = (title && title !== url ? title : "") || "";
  if (!addrInput) return;
  setAddrFav(_addrUrl);
  const focused = document.activeElement === addrInput;
  addrInput.value = (!focused && _addrTitle) ? _addrTitle : _addrUrl;
  window.__permUpdate && window.__permUpdate();
}
window.updateAddressBar = updateAddressBar;

if (addrInput) {
  addrInput.addEventListener("focus", () => {
    if (_addrUrl && addrInput.value === _addrTitle) addrInput.value = _addrUrl;
    requestAnimationFrame(() => addrInput.select());
  });
  addrInput.addEventListener("blur", () => {
    if (_addrTitle && addrInput.value === _addrUrl) addrInput.value = _addrTitle;
  });
}

// Отслеживаем прошлый состав вкладок: анимацию появления вешаем ТОЛЬКО на
// новые пилюли, иначе весь стрип переигрывал бы анимацию при каждом рендере.
let _prevTabIds = new Set();

function renderTabStrip() {
  const scroll = document.getElementById("tabstripScroll");
  const prevIds = _prevTabIds;
  const curIds = new Set();
  scroll.innerHTML = "";
  // закреплённые — первыми (sort стабилен: порядок внутри групп сохраняется)
  const ordered = [...tabs].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const drawn = new Set();
  for (const tab of ordered) {
    if (drawn.has(tab.id)) continue;
    curIds.add(tab.id);
    // ГРУППА-ПАПКА: пилюли одной группы в общей рамке с заголовком
    const hostId = tab.group || (groupMembers(tab.id).length > 1 ? tab.id : null);
    if (hostId && !tab.pinned) {
      const members = ordered.filter((t) => t.id === hostId || t.group === hostId);
      members.forEach((t) => { drawn.add(t.id); curIds.add(t.id); });
      const g = document.createElement("div");
      g.className = "tab-group" + (_collapsedGroups.has(hostId) ? " collapsed" : "");
      g.dataset.groupId = String(hostId);
      const head = document.createElement("div");
      head.className = "tab-group-head";
      const host = tabs.find((t) => t.id === hostId);
      head.textContent = "📁 " + (host && host.label ? String(host.label).slice(0, 18) : "Папка") +
        " · " + members.length;
      head.title = "Свернуть/развернуть папку вкладок";
      head.onclick = () => {
        if (_collapsedGroups.has(hostId)) _collapsedGroups.delete(hostId);
        else _collapsedGroups.add(hostId);
        renderTabStrip();
      };
      head.oncontextmenu = (ev) => tabContextMenu(ev, host || tab);
      g.appendChild(head);
      const inner = document.createElement("div");
      inner.className = "tab-group-body";
      g.appendChild(inner);
      if (!_collapsedGroups.has(hostId)) {
        for (const t2 of members) createTabPill(t2, inner, prevIds);
      } else {
        // свёрнуто: показываем пилюли-заглушки? нет — только заголовок
      }
      scroll.appendChild(g);
      continue;
    }
    createTabPill(tab, scroll, prevIds);
  }
  _prevTabIds = curIds; // запоминаем состав для следующего рендера
  const sb = document.getElementById("splitBtn");
  if (sb) sb.classList.toggle("active", !!splitPair);
  // Mirror into the horizontal top strip (tabs-on-top mode)
  const h = document.getElementById("tabstripH");
  if (h) {
    h.innerHTML = "";
    for (const child of [...scroll.children]) h.appendChild(child.cloneNode(true));
    h.querySelectorAll(".tab-pill").forEach(pill => {
      const id = pill.dataset.tabId;
      pill.onclick = ev => { if (!ev.target.closest(".tab-pill-close")) switchTab(id); };
      pill.querySelector(".tab-pill-close")?.addEventListener("click", ev => { ev.stopPropagation(); closeTab(id); });
      const original = tabs.find(t => String(t.id) === String(id));
      if (original) pill.oncontextmenu = ev => tabContextMenu(ev, original);
    });
    h.querySelectorAll(".tab-group-head").forEach(head => {
      const group = head.closest(".tab-group");
      head.onclick = () => { const id=group?.dataset.groupId; if(!id)return; _collapsedGroups.has(id)?_collapsedGroups.delete(id):_collapsedGroups.add(id); renderTabStrip(); };
    });
  }
  updateNavBtns();
}

// пилюля одной вкладки (в указанный контейнер) — вынесено из renderTabStrip
function createTabPill(tab, host, prevIds) {
  const pill = document.createElement("div");
  pill.className = "tab-pill" + (tab.id === activeTabId ? " active" : "") +
    (tab.pinned ? " pinned" : "") +
    ((splitPair && (tab.id === splitPair.left || tab.id === splitPair.right)) ? " split" : "");
  if (!prevIds.has(tab.id)) pill.classList.add("tab-appear");
  pill.dataset.tabId = String(tab.id);
  pill.title = tab.url;
  const fav = document.createElement("span");
  fav.className = "tab-fav";
  if (tab.isNew) {
    fav.textContent = "+";
    fav.classList.add("tab-fav-new");
  } else {
    fav.textContent = ((tab.label || "?").trim()[0] || "?").toUpperCase();
  }
  // Настоящий фавикон сайта: тянем /favicon.ico САМОГО сайта (без сторонних
  // сервисов типа Google s2 — приватность). Буква остаётся под картинкой
  // как фолбэк, если иконки нет. Иконка запрашивается и для СПЯЩИХ вкладок
  // (юзер хочет логотип всегда), повторные 404 не дёргаются (кэш).
  if (!tab.url.startsWith("apb://")) {
    const img = document.createElement("img");
    img.className = "fav-img";
    img.loading = "lazy";
    img.alt = "";
    if (favAttach(img, tab.url)) fav.appendChild(img);
  }
  const title = document.createElement("span");
  title.className = "tab-pill-title";
  title.textContent = tab.label;
  // Двойной клик по названию — переименовать вкладку
  title.ondblclick = (ev) => {
    ev.stopPropagation();
    if (_tabDragSuppressed) return;
    renameTab(tab);
  };
  const closeBtn = document.createElement("button");
  closeBtn.className = "tab-pill-close";
  closeBtn.textContent = "×";
  closeBtn.onclick = (ev) => { ev.stopPropagation(); closeTab(tab.id); };
  // ЗАКРЕПЛЁННАЯ пилюля: фавикон И НАЗВАНИЕ (компактно) + мелкая 📌-метка;
  // ✕ нет — закрыть/открепить можно из контекст-меню правого клика.
  if (tab.isNew) {
    pill.append(fav, title, closeBtn);
  } else if (tab.pinned) {
    const pinMark = document.createElement("span");
    pinMark.className = "tab-pill-pinmark";
    pinMark.textContent = "📌";
    pinMark.title = "Закреплено — правый клик: открепить";
    pill.append(fav, title, pinMark);
  } else {
    pill.append(fav, title, closeBtn);
  }
  pill.onclick = () => { if (_tabDragSuppressed) return; switchTab(tab.id); };
  // ПРАВЫЙ КЛИК — контекст-меню (закрепить/переименовать/группа/закрыть)
  pill.oncontextmenu = (ev) => tabContextMenu(ev, tab);
  host.appendChild(pill);
  pill._tabRef = tab;
  if (!tab.pinned) _makeTabDraggable(pill); // закреплённые не таскаются
  return pill;
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// ---- Drag&drop: перетаскивание вкладок по вертикали с анимацией ----
let _tabDragSuppressed = false;

/** Переименование вкладки (двойной клик по названию). */
async function renameTab(tab) {
  if (!tab) return;
  const nn = await prompt("Название вкладки:", tab.label || "");
  if (nn == null) return;
  const v = nn.trim();
  if (!v) return;
  tab.userRenamed = true; // не перетирать ручное имя реальным <title>
  tab.label = v;
  renderTabStrip();
  scheduleSessionSave();
}

function _makeTabDraggable(pill) {
  let startX = 0, startY = 0, dragging = false;
  let items = [], slots = [], oIdx = 0, cIdx = 0, baseTop = 0, hPill = 0, minY = 0, maxY = 0;

  const beginDrag = () => {
    dragging = true;
    pill.classList.add("dragging");
    const parent = pill.parentElement;
    items = Array.from(parent.children);
    slots = items.map((c) => { const r = c.getBoundingClientRect(); return { top: r.top, h: r.height }; });
    oIdx = items.indexOf(pill);
    cIdx = oIdx;
    const pr = pill.getBoundingClientRect();
    baseTop = pr.top;
    hPill = pr.height;
    const lr = parent.getBoundingClientRect();
    minY = lr.top - baseTop;                       // верх списка
    maxY = lr.bottom - pr.height - baseTop;        // низ списка
    // Соседи будут ПЛАВНО ехать на свои новые места
    for (const c of parent.children) {
      if (c !== pill) c.style.transition = "transform 0.24s cubic-bezier(0.33,1,0.68,1)";
    }
  };

  // Сдвиги соседей относительно ИСХОДНЫХ позиций — без накопительных ошибок,
  // движение всегда к абсолютной цели → анимация непрерывная и мягкая.
  const applyOffsets = () => {
    let i = 0;
    for (const c of pill.parentElement.children) {
      if (c === pill) { i++; continue; }
      let off = 0;
      if (oIdx < cIdx && i > oIdx && i <= cIdx) off = -hPill;
      else if (cIdx < oIdx && i >= cIdx && i < oIdx) off = hPill;
      c.style.transform = off ? "translateY(" + off + "px)" : "";
      i++;
    }
  };

  pill.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".tab-pill-close")) return; // крестик не тащим
    startX = e.clientX; startY = e.clientY; dragging = false;

    let lastY = 0;
    let hoverTarget = null; // пилюля-цель для drop-в-группу (под курсором)
    const setHover = (el) => {
      if (hoverTarget === el) return;
      hoverTarget?.classList.remove("tab-drop-target");
      hoverTarget = el;
      hoverTarget?.classList.add("tab-drop-target");
    };
    const move = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        beginDrag();
      }
      // Тащим строго в пределах списка — никуда «до бесконечности» уехать нельзя
      let y = ev.clientY - startY;
      y = Math.min(Math.max(y, minY), maxY);
      lastY = y;
      pill.style.transform = "translateY(" + y + "px)";
      // Целевой индекс — ближайший центр слота к курсору
      let bd = Infinity;
      slots.forEach((s, i) => {
        const d = Math.abs(s.top + s.h / 2 - ev.clientY);
        if (d < bd) { bd = d; cIdx = i; }
      });
      applyOffsets();
      // DROP-В-ГРУППУ: если курсок ПОВЕРХ другой пилюли (центры близки)
      // — она подсвечивается рамкой; отпускание создаст папку.
      const tgt = items[cIdx] !== pill ? items[cIdx] : null;
      const tRef = tgt && tgt._tabRef;
      if (tRef && !tRef.pinned && !tRef.isNew && bd < hPill * 0.55) {
        setHover(tgt);
      } else {
        setHover(null);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragging) return;
      _tabDragSuppressed = true;
      setTimeout(() => { _tabDragSuppressed = false; }, 260);
      const target = hoverTarget;
      setHover(null);
      // создали папку — никакой переупорядочки, сразу перерисовать
      if (target && target._tabRef) {
        pill.classList.remove("dragging");
        pill.style.transition = "";
        pill.style.transform = "";
        for (const c of pill.parentElement.children) {
          if (c !== pill) { c.style.transition = ""; c.style.transform = ""; }
        }
        joinGroup(pill._tabRef.id, target._tabRef.id);
        return;
      }
      // Плавная доводка пилюли в её слот (без «прыжка» при отпускании)
      const targetY = slots[cIdx].top - baseTop;
      pill.style.transition = "transform 0.18s cubic-bezier(0.33,1,0.68,1)";
      pill.style.transform = "translateY(" + targetY + "px)";
      setTimeout(() => {
        pill.classList.remove("dragging");
        pill.style.transition = "";
        pill.style.transform = "";
        for (const c of pill.parentElement.children) {
          if (c !== pill) { c.style.transition = ""; c.style.transform = ""; }
        }
        if (cIdx !== oIdx) {
          const arr = [...tabs];
          const movedTab = arr.splice(oIdx, 1)[0];
          arr.splice(cIdx, 0, movedTab);
          tabs.length = 0;
          for (const t of arr) tabs.push(t);
          scheduleSessionSave();
        }
        renderTabStrip(); // нормализация стилей/иконок после переноса
      }, 190);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

function showEmptyState(show) {
  document.getElementById("browserEmpty").classList.toggle("hidden", !show);
  document.body.classList.toggle("on-home", show);
  const af = document.getElementById("addressForm");
  // !important обязателен: appearance.css жёстко форсит
  // `.browser-chrome .address-form{display:flex!important}`, и обычный
  // inline-стиль ему проигрывает (баг «адресная строка видна на главной»).
  if (af) af.style.setProperty("display", show ? "none" : "", "important");
  if (window.__apbLog) window.__apbLog("INFO", `showEmptyState(${show}) on-home=${document.body.classList.contains("on-home")}`);
}

// Each tab = a native WebView2 child webview embedded INSIDE this single
// shell window (real browser engine, no iframes — any site works).
const invokeV2 = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);

// ---------------------------------------------------------------------
// Split view — две живые вкладки рядом (50/50)
// ---------------------------------------------------------------------

let splitPair = null; // { left, right } — id вебвью-вкладок

/** Тихо погасить сплит (без смены активной вкладки). */
function splitExitSilent() {
  if (!splitPair) return;
  splitPair = null;
  invokeV2("page_split_off", {}).catch(() => {});
}

/** Разделить экран: активная вкладка слева, otherId — справа. */
async function apbSplitWith(otherId) {
  const a = tabs.find((t) => t.id === activeTabId);
  const b = tabs.find((t) => t.id === otherId);
  if (!a || !b || a.id === b.id) { toast("Нужны две откр��тые вкладки", "err"); return; }
  if (a.isNew || b.isNew || a.asleep || b.asleep) { toast("Сначала откройте обе вкладки", "err"); return; }
  try {
    await invokeV2("page_split_set", { leftId: a.id, rightId: b.id });
    splitPair = { left: a.id, right: b.id };
    window.__apbSplitPair = splitPair;
    activeTabId = a.id;
    updateAddressBar(a.url, a.label);
    showEmptyState(false);
    renderTabStrip();
    syncPageLayout(true);
    toast("Разделённый экран: «" + a.label + "» и «" + b.label + "»", "ok");
  } catch (e) { toast("Split: " + e, "err"); }
}

/** Выйти из разделения, оставить фокус на указанной вкладке. */
async function apbSplitExit(focusId) {
  splitPair = null;
  window.__apbSplitPair = null;
  await invokeV2("page_split_off", {}).catch(() => {});
  renderTabStrip();
  const fid = focusId || activeTabId || (tabs[0] && tabs[0].id);
  if (fid) switchTab(fid); else showHome();
}
window.apbSplitWith = apbSplitWith;
window.apbSplitExit = apbSplitExit;

// Точка входа для бэкенда (shell_open_tab): target=_blank-ссылки и window.open
// из вкладок открываются новой вкладкой здесь, в шелле.
// Правило юзера (инверсно к Chrome): ЛКМ по target=_blank и попапы
// (window.open) → focus=true, СРАЗУ перейти; ПКМ «Открыть в новой вкладке»
// и Ctrl+клик → фоном, не уходить со страницы.
window.__apbOpenTab = (url, focus) => createTab(url, null, { background: !focus });

// События от бэкенда о жизни вкладок-вебвью:
try {
  const ev = window.__TAURI__.event;
  // Сайт сам сменил страницу (клик по ссылке/редирект) — синхронизируем
  // вкладку, историю и омнибокс, иначе адресная строка показывает старое.
  ev.listen("page-url-changed", (e) => {
    const { id, url } = e.payload || {};
    if (window.__apbLog) window.__apbLog("INFO", `url-changed ${id} ${url}`);
    const t = tabs.find((x) => x.id === id);
    if (!t || !url || t.url === url) return;
    t.url = url;
    if (!t.userRenamed) t.label = smartTitle(url, "");
    if (t.hist[t.hi] !== url) {
      t.hist = t.hist.slice(0, t.hi + 1);
      t.hist.push(url);
      t.hi = t.hist.length - 1;
    }
    if (id === activeTabId) updateAddressBar(url, t.label);
    renderTabStrip();
    updateNavBtns();
    scheduleSessionSave();
  });
  // Реальный заголовок страницы (<title>) с бэкенда — настоящее название
  // сайта в адресной строке и в кладке (если юзер не переименовал вручную).
  ev.listen("page-title-changed", (e) => {
    const { id, title } = e.payload || {};
    if (window.__apbLog) window.__apbLog("INFO", `title-changed ${id} ${title}`);
    const t = tabs.find((x) => x.id === id);
    if (!t || !title) return;
    const v = String(title).trim().slice(0, 200);
    if (!v || t.userRenamed) return;
    t.label = v;
    titleCacheRemember(t.url, v);
    if (id === activeTabId) updateAddressBar(t.url, t.label);
    renderTabStrip();
    scheduleSessionSave();
  });
  // Нативное меню «Открыть в новом окне» (ПКМ на YouTube и т.п.) — бэкенд
  // запретил ОС-окно и просит открыть ссылку вкладкой.
  ev.listen("page-open-tab", (e) => {
    const u = e.payload && e.payload.url;
    const f = !!(e.payload && e.payload.focus);
    if (u) window.__apbOpenTab(u, f);
  });
} catch { /* event API недоступен — живём как раньше */ }

/** Кнопка ⬓ в тулбаре: вкл/выкл сплит одной кнопкой. */
document.getElementById("splitBtn").addEventListener("click", () => {
  if (splitPair) { apbSplitExit(activeTabId); return; }
  const other = tabs.find((t) => t.id !== activeTabId && !t.isNew && !t.asleep && t.url);
  if (!other) { toast("Нужна вторая открытая вкладка для сплита", "err"); return; }
  apbSplitWith(other.id);
});

let relayoutTimer = null;

// Measure the actual content-area hole (#browserView) and hand it to the
// backend, which positions native tab webviews there. This automatically
// accounts for the tabstrip/toolbar heights, the rail, the side panel and
// the note editor pane — no pixel constants duplicated in Rust.
//
// BUG FIX: `getBoundingClientRect()` used to be read once, synchronously,
// right when syncPageLayout() was CALLED — before the requested delay.
// For the debounced (non-immediate) path that's the wrong moment: e.g.
// opening the toolbar side panel calls this right after adding the
// `.open` class, but the panel's width transition (~0.16s) hasn't
// actually run yet, so the captured rect still reflected the OLD,
// pre-panel (full-width) layout. 170ms later we'd still push that STALE
// rect to the backend, so the real tab's native webview got positioned
// at its old, too-wide bounds — sitting right on top of where the side
// panel had since opened, instead of alongside it. That's the "opens a
// toolbar tab over a live site and it's just black/shows the site
// squeezed weirdly" bug. Fix: measure fresh at the moment we actually
// push, not at the moment we schedule the push.
function syncPageLayout(immediate = false) {
  const push = () => {
    const view = document.getElementById("browserView").getBoundingClientRect();
    invokeV2("page_relayout", {
      x: view.left,
      y: view.top,
      width: view.width,
      height: view.height,
    }).catch(() => {});
  };
  clearTimeout(relayoutTimer);
  if (immediate) push();
  else relayoutTimer = setTimeout(push, 170); // > 0.16s panel transition
}

window.addEventListener("resize", () => {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(syncPageLayout, 120);
});

async function createTab(url, label, opts = {}) {
  splitExitSilent();
  try {
    // Фоновая вкладка: создаётся скрытой, ТЕКУЩАЯ вкладка остаётся
    // активной (омнибокс/главный экран не трогаем) — как Ctrl+клик в
    // обычных браузерах.
    const cmd = opts.background ? "page_open_bg" : "page_open";
    const id = await invokeV2(cmd, { url });
    const t = { id, url, label: smartTitle(url, label), hist: [url], hi: 0 };
    // Новые вкладки по умолчанию встают В НАЧАЛО списка (сверху).
    // opts.append — для восстановления сессий/воркспейсов, чтобы сохранить
    // исходный порядок.
    if (opts.append) tabs.push(t); else tabs.unshift(t);
    if (!opts.background) {
      activeTabId = id;
      internalOpen = null;
      internalHost.classList.add("hidden");
      updateAddressBar(url, t.label);
      showEmptyState(false);
    }
    renderTabStrip();
    if (!opts.background) syncPageLayout(true);
    scheduleSessionSave();
    return id;
  } catch (e) {
    alert("Не удалось открыть страницу: " + e);
    return null;
  }
}

/** Подпись вкладки: домен для адресов, но текст запроса — если юзер искал. */
function smartLabel(rawInput, resolvedUrl) {
  const r = (rawInput || "").trim();
  if (!r) return hostnameOf(resolvedUrl);
  const looksLikeAddress =
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(r) ||
    /^localhost(:\d+)?/i.test(r) ||
    (!/\s/.test(r) && /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+(:\d+)?(\/.*)?$/.test(r));
  if (looksLikeAddress) return hostnameOf(resolvedUrl);
  return r.length > 26 ? r.slice(0, 26) + "…" : r;
}

/** Достаём поисковый запрос из URL (?q=/?query=/?text=...) — чтобы вкладка,
 *  открытая из истории/закладок, называлась тем, что искал юзер, а не
 *  «duckduckgo.com». Если параметров нет — null. */
function labelFromUrl(url) {
  try {
    const u = new URL(url);
    for (const key of ["q", "query", "text", "search", "word", "p", "ask"]) {
      const v = u.searchParams.get(key);
      const dec = v && v.trim();
      if (dec) return dec.length > 26 ? dec.slice(0, 26) + "…" : dec;
    }
  } catch { /* не URL — ладно */ }
  return null;
}

function navigateActiveTab(url, label, opts = {}) {
  const cur = currentTabObj();
  if (!activeTabId || !cur) { createTab(url, label, opts); return; }
  // Навигация в «новой вкладке» будит её в настоящий сайт
  if (cur.isNew) { wakeAs(cur, url, label); return; }
  const tab = cur;
  tab.url = url;
  tab.label = smartTitle(url, label);
  // Record navigation history for the back/forward buttons.
  if (tab.hist[tab.hi] !== url) {
    tab.hist = tab.hist.slice(0, tab.hi + 1);
    tab.hist.push(url);
  }
  tab.hi = tab.hist.length - 1;
  updateAddressBar(url, tab.label);
  invokeV2("page_navigate", { id: tab.id, url }).catch(() => {});
  renderTabStrip();
  scheduleSessionSave();
}

// ---- Back / forward / reload (per-tab JS-side history) ----

// Made by MrDuck
function currentTabObj() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

function updateNavBtns() {
  const t = currentTabObj();
  const back = document.getElementById("navBack");
  const fwd = document.getElementById("navFwd");
  const rel = document.getElementById("navReload");
  if (!back || !fwd || !rel) return;
  back.disabled = !t || t.hi <= 0;
  fwd.disabled = !t || t.hi >= t.hist.length - 1;
  rel.disabled = !t;
}

function jumpHistory(dir) {
  const t = currentTabObj();
  if (!t || t.isNew) return;
  const ni = t.hi + dir;
  if (ni < 0 || ni >= t.hist.length) return;
  t.hi = ni;
const url = t.hist[ni];
    t.url = url;
    t.label = smartTitle(url, "");
  updateAddressBar(url, t.label);
  invokeV2("page_navigate", { id: t.id, url }).catch(() => {});
  renderTabStrip();
}

document.getElementById("navBack").addEventListener("click", () => jumpHistory(-1));
document.getElementById("navFwd").addEventListener("click", () => jumpHistory(1));
document.getElementById("navReload").addEventListener("click", () => {
  const t = currentTabObj();
  if (t && !t.isNew) invokeV2("page_navigate", { id: t.id, url: t.url }).catch(() => {});
});

// Sidebar collapse toggle живёт в boot-core.js (тут был ДУБЛЬ обработчика —
// двойной toggle делал кнопку нерабочей).

/** Спящая вкладка: есть в списке, но вебвью не создаётся (старт с главного
 *  экрана). Просыпается при клике — тогда открывается сайт. */
function addSleepingTab(url, label, pinned, group) {
  tabs.unshift({
    id: makeTabId(), url,
    label: smartTitle(url, label),
    hist: [url], hi: 0, asleep: true,
    pinned: !!pinned, // 📌 из прошлой сессии
    group: group || null, // 📁 группа-папка из прошлой сессии
  });
}

// Ремап групп после восстановления сессии: сохраняли индекс хозяина в
// исходном списке sub; вкладки вставлялись unshift-ом (порядок обратный),
// id новые. Перелинковываем t.group с индекса на НОВЫЙ id хозяина.
function apbRemapGroups(sub) {
  // sub[i] → вкладка с новым id в tabs: sub.length-1-i (обратный unshift)
  const idOf = (origIdx) => {
    const t = tabs[tabIndexOfOrig(sub, origIdx)];
    return t ? t.id : null;
  };
  for (let i = 0; i < sub.length; i++) {
    const rec = sub[i];
    if (rec.group == null) continue;
    const hostNewId = idOf(rec.group);
    if (!hostNewId) continue;
    const meIdx = tabIndexOfOrig(sub, i);
    if (tabs[meIdx] && hostNewId !== tabs[meIdx].id) tabs[meIdx].group = hostNewId;
  }
}
// позиция в tabs восстановленной записи i из sub (unshift → reverse)
function tabIndexOfOrig(sub, i) {
  return sub.length - 1 - i;
}

/** Разбудить спящую вкладку: открыть вебвью и подменить временный id. */
async function wakeTab(tab) {
  splitExitSilent();
  try {
    const realId = await invokeV2("page_open", { url: tab.url });
    _prevTabIds.delete(tab.id); // новый id → пилюля честно проиграет анимацию пробуждения
    tab.id = realId;
    tab.asleep = false;
    tab.hist = [tab.url];
    tab.hi = 0;
    activeTabId = realId;
    internalOpen = null;
    internalHost.classList.add("hidden");
    updateAddressBar(tab.url, tab.label);
    showEmptyState(false);
    renderTabStrip();
    syncPageLayout(true);
    scheduleSessionSave();
  } catch (e) {
    alert("Не удалось открыть страницу: " + e);
  }
}

/** Новая вкладка-«страница»: пилюля есть, вебвью нет; внутри — главный
 *  экран. При вводе адреса превращается в обычную вкладку (wakeAs). */
function openNewTabPage() {
  splitExitSilent();
  const t = { id: makeTabId(), url: "", label: "Новая вкладка", hist: [""], hi: 0, isNew: true };
  tabs.unshift(t);
  activeTabId = t.id;
  internalOpen = null;
  internalHost.classList.add("hidden");
  // КРИТИЧНО: нативные вебвью рисуются ПОВЕРХ HTML — прячем их все
  invokeV2("page_hide_all", {}).catch(() => {});
  updateAddressBar("", "");
  showHome();
  renderTabStrip();
  syncPageLayout();
  scheduleSessionSave();
  updateNavBtns();
  const input = document.getElementById("homeSearchInput");
  if (input) input.focus();
}

/** Первая навигация в новой вкладке: заводим настоящее вебвью. */
async function wakeAs(tab, url, label) {
  splitExitSilent();
  try {
    const realId = await invokeV2("page_open", { url });
    _prevTabIds.delete(tab.id);
    tab.id = realId;
    tab.url = url;
    tab.label = smartTitle(url, label);
    tab.hist = [url];
    tab.hi = 0;
    tab.isNew = false;
    activeTabId = realId;
    updateAddressBar(url, tab.label);
    showEmptyState(false);
    renderTabStrip();
    syncPageLayout(true);
    scheduleSessionSave();
    if (typeof updateDarkSiteBtn === "function") updateDarkSiteBtn();
  } catch (e) {
    alert("Не удалось открыть страницу: " + e);
  }
}

async function switchTab(id) {
  closeInternal(false);
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  // Клик по члену сплита — просто переключаем фокус, сплит живёт
  if (splitPair && (id === splitPair.left || id === splitPair.right)) {
    activeTabId = id;
    updateAddressBar(tab.url, tab.label);
    renderTabStrip();
    updateNavBtns();
    return;
  }
  // Клик по сторонней вкладке гасит сплит и открывает её на весь экран
  if (splitPair) await apbSplitExit(id);
  if (tab.asleep) { await wakeTab(tab); return; } // спящая — сначала открыть сайт
  if (tab.isNew) {
    // Новая вкладка-страница: пилюля есть, вебвью нет — показываем главную
    activeTabId = tab.id;
    invokeV2("page_hide_all", {}).catch(() => {});
    updateAddressBar("", "");
    showHome();
    renderTabStrip();
    scheduleSessionSave();
    updateNavBtns();
    return;
  }
  activeTabId = id;
  updateAddressBar(tab.url, tab.label);
  showEmptyState(false);
  invokeV2("page_activate", { id }).catch(() => {});
  renderTabStrip();
  scheduleSessionSave();
}

function closeTab(id) {
  // Плавный уход: пилюли (сайдбар + зеркальная верхняя лента) схл��пываются
  // с анимацией, реальное закрытие — через 180мс (анимация 0.17s + 10мс
  // запас, чтобы кадр успел дорисоваться). Повторный клик по той же
  // (уже «уходящей») пилюле не ждёт второй раз. Если пилюли нет в DOM —
  // закрываем сразу.
  const attr = `[data-tab-id="${CSS.escape(String(id))}"]`;
  const pills = document.querySelectorAll(".tab-pill" + attr);
  if (pills.length && !pills[0].classList.contains("tab-leave")) {
    pills.forEach((el) => el.classList.add("tab-leave"));
    setTimeout(() => closeTabNow(id), 180);
    return;
  }
  closeTabNow(id);
}
function closeTabNow(id) {
  // Партнёр по сплиту остаётся видимым (бэкенд сам гасит сплит)
  let splitPartner = null;
  if (splitPair && (id === splitPair.left || id === splitPair.right)) {
    splitPartner = id === splitPair.left ? splitPair.right : splitPair.left;
  }
  invokeV2("page_close", { id }).catch(() => {});
  tabs = tabs.filter((t) => t.id !== id);
  tabDark.delete(id);
  splitPair = null;
  window.__apbSplitPair = null;

  if (activeTabId === id) {
    activeTabId = null;
    if (splitPartner) {
      switchTab(splitPartner);
    } else if (tabs.length > 0) {
      // список теперь «новые сверху» — активируем верхнюю оставшуюся
      switchTab(tabs[0].id);
    } else {
      updateAddressBar("", "");
      showHome();
      syncPageLayout();
    }
  }
  renderTabStrip();
  scheduleSessionSave();
  updateDarkSiteBtn();
  ensureHomeVisible();
}

document.getElementById("newTabBtn").addEventListener("click", () => {
  // «+» и Ctrl+T создают НАСТОЯЩУЮ вкладку-пилюлю (внутри — главный экран;
  // ввод адреса превращает её в сайт)
  openNewTabPage();
});

// Extra guards: after closing/switching tabs the content must never stay dark.
// Lives here (not in 04) because it wraps syncPageLayout declared above —
// cross-file function hoisting disappeared when the monolith was split.
const _origSync = syncPageLayout;
syncPageLayout = function (...a) { _origSync(...a); ensureHomeVisible(); };

// Made by MrDuck