// Made by MrDuck
// ============================================================
// ui/js/graph/graph-settings.js — GRAPH settings subsystem
//
// Полностью владеет настройками графа:
//   · состояние cfg: загрузка / сохранение (localStorage apb-graph-cfg)
//   · миграция legacy-полей (boolean straight → lineStyle)
//   · санитайзинг значений (только известные ключи и енумы)
//   · подписки onChange для движка
//   · поповер «⚙ Настройки»: построение, клампинг позиции, закрытие
//
// Наружу: window.GraphSettings = { cfg, set, save, reset, onChange,
//                                  openAt, toggleAt, hide, isOpen }
// Загружаться ДО js/graph/graph.js (порядок в index.html).
// ============================================================
(function () {
  "use strict";

  const KEY = "apb-graph-cfg";

  const DEFAULTS = {
    grid: false,          // координатная сетка
    snap: false,          // привязка к сетке (20px)
    anchors: true,        // якорные точки при наведении
    showNotes: true,      // показывать узлы-заметки
    alwaysDots: false,    // коннекторы всегда видны
    physics: true,        // физика (авто-раскладка узлов)
    autoAnchor: true,     // точки соединения плавают по краю фигуры
    spreadParallel: true, // разводить параллельные линии между парой
    lineStyle: "curve",   // "curve" | "straight" | "ortho"
  };

  // ---------------- load / migrate / sanitize ----------------
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { raw = {}; }
  if (raw.straight === true && !("lineStyle" in raw)) raw.lineStyle = "straight"; // legacy
  delete raw.straight;

  const cfg = {};
  for (const k of Object.keys(DEFAULTS)) cfg[k] = raw[k];

  function sanitize() {
    for (const k of Object.keys(DEFAULTS)) {
      const d = DEFAULTS[k];
      if (typeof d === "boolean") cfg[k] = typeof cfg[k] === "boolean" ? cfg[k] : d;
    }
    if (!["curve", "straight", "ortho"].includes(cfg.lineStyle)) cfg.lineStyle = "curve";
  }
  sanitize();

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* приватный режим */ }
  }

  function reset() {
    for (const k of Object.keys(DEFAULTS)) cfg[k] = DEFAULTS[k];
    sanitize();
    save();
    emit();
  }

  // ---------------- change subscriptions ----------------
  const listeners = new Set();
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { for (const fn of [...listeners]) { try { fn(cfg); } catch { /* ignore */ } } }

  function set(key, value) {
    if (!(key in DEFAULTS)) return;
    cfg[key] = value;
    sanitize();
    save();
    emit();
  }

  // ---------------- popover ----------------
  let pop = null;

  function syncPop() { if (pop && !pop.isConnected) pop = null; } // удалили извне?
  function isOpen() { syncPop(); return !!pop; }
  function hide() { syncPop(); if (pop) { pop.remove(); pop = null; } }

  const BOOL_ROWS = [
    ["showNotes", "Показывать заметки (узлы)"],
    ["physics", "Физика (авто-раскладка узлов)"],
    ["grid", "Координатная сетка"],
    ["snap", "Привязка к сетке (20px)"],
    ["anchors", "Якорные точки при наведении"],
    ["alwaysDots", "Коннекторы всегда видны"],
    null, // разделитель
    ["autoAnchor", "Точки соединения плавают по краю блока"],
    ["spreadParallel", "Разводить несколько линий между блоками"],
  ];
  const LINE_STYLES = [
    ["curve", "Плавные (кривые)"],
    ["straight", "Прямые"],
    ["ortho", "Под углом (сетка / схема)"],
  ];

  const rowHtml = (k, label) =>
    `<label class="gcfg"><input type="checkbox" data-k="${k}" ${cfg[k] ? "checked" : ""}/> ${label}</label>`;

  function buildDom() {
    const d = document.createElement("div");
    d.className = "graph-menu gpop";
    d.id = "apbGraphCfgPop";
    d.innerHTML =
      BOOL_ROWS.map((r) => (r ? rowHtml(r[0], r[1]) : `<div class="gcfg-sep"></div>`)).join("") +
      `<label class="gcfg gcfg-select">Стиль линий
        <select data-sel="lineStyle">` +
      LINE_STYLES.map(([v, l]) => `<option value="${v}" ${cfg.lineStyle === v ? "selected" : ""}>${l}</option>`).join("") +
      `</select></label>
      <button type="button" class="ghost-btn small" data-reset>Сбросить по умолчанию</button>`;
    d.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    d.querySelectorAll("input[data-k]").forEach((inp) => {
      inp.addEventListener("change", () => {
        set(inp.dataset.k, inp.checked);
        if (typeof toast === "function") toast("Настройка сохранена");
      });
    });
    d.querySelector("select[data-sel]").addEventListener("change", (ev) => {
      set("lineStyle", ev.currentTarget.value);
      if (typeof toast === "function") toast("Настройка сохранена");
    });
    d.querySelector("[data-reset]").addEventListener("click", () => {
      reset();
      if (typeof toast === "function") toast("Настройки графа сброшены");
      hide();
    });
    return d;
  }

  function openAt(x, y) {
    hide();
    const d = buildDom();
    pop = d;
    document.body.appendChild(d);
    // клампим после вставки, когда известны размеры
    requestAnimationFrame(() => {
      if (!pop || pop !== d) return;
      const w = d.offsetWidth || 260, h = d.offsetHeight || 340;
      d.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 8)) + "px";
      d.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 8)) + "px";
    });
    emit();
    return d;
  }

  function toggleAt(x, y) { isOpen() ? hide() : openAt(x, y); }

  // Клик мимо поповера закрывает его (клики внутри — stopPropagation выше;
  // кнопка ⚗ #graphCfg обрабатывает сама через toggleAt).
  document.addEventListener("pointerdown", (e) => {
    const t = e.target instanceof HTMLElement ? e.target : null;
    if (!t) { hide(); return; }
    if (t.closest(".graph-menu") || t.closest("#graphCfg")) return;
    hide();
  });

  window.GraphSettings = { cfg, set, save, reset, onChange, openAt, toggleAt, hide, isOpen };
})();

// Made by MrDuck