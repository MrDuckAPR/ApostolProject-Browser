// Made by MrDuck
const invoke = window.__TAURI__.core.invoke;

function apbDiag(msg) {
  try { invoke("debug_log_append", { lines: ["[popup] " + msg] }).catch(() => {}); } catch (_) {}
}

const APBPopup = (() => {
  let current = null;
  let sequence = 0;
  let queue = Promise.resolve();
  function finish(payload, selected) {
    if (!current || current.id !== payload.id) return;
    const entry = current;
    // Карточка (card): действие НЕ закрывает попап — окно живёт, пока его
    // не закроет сам шелл (handle.close / overlay-closed). Действия передаём
    // наружу, чтобы шелл перерисовал карточку (handle.update).
    if (entry.card) {
      if (selected) {
        Promise.resolve().then(() => entry.onAction(payload.action, payload.value)).catch(e => toast(String(e), "err"));
      } else {
        const c = current;
        current = null;
        Promise.resolve().then(() => c.onClose()).catch(e => toast(String(e), "err"));
      }
      return;
    }
    current = null;
    Promise.resolve().then(() => selected ? entry.onAction(payload.action, payload.value) : entry.onClose()).catch(e => toast(String(e), "err"));
  }
  const ready = Promise.all([
    window.__TAURI__.event.listen("overlay-action", e => finish(e.payload, true)),
    window.__TAURI__.event.listen("overlay-closed", e => finish(e.payload, false)),
  ]);
  function send(command, args) {
    const result = queue.catch(() => {}).then(() => ready).then(() => invoke(command, args));
    queue = result;
    return result;
  }
  function open(payload, onAction = () => {}, onClose = () => {}) {
    if (current) finish({ id: current.id }, false);
    const id = "popup-" + Date.now() + "-" + (++sequence);
    current = { id, onAction, onClose, toggleable: !!payload.toggleable };
    let content = payload;
    const handle = {
      id,
      update(next) {
        if (!current || current.id !== id) return;
        content = { ...content, ...next };
        send("overlay_show", { payload: { ...content, id } }).catch(e => {
          finish({ id }, false);
          toast("Не удалось открыть меню: " + e, "err");
        });
      },
      close() {
        if (!current || current.id !== id) return;
        finish({ id }, false);
        send("overlay_hide", { id }).catch(e => toast(String(e), "err"));
      },
    };
    handle.update(payload);
    return handle;
  }
  function menu(items, x, y) {
    return open({ x, y, width: 340, height: Math.min(650, 12 + items.reduce((h, it) => h + (it.separator ? 9 : 34), 0)), items: items.map((it, i) => ({ label: it.label, danger: !!it.danger, sep: !!it.separator, action: String(i) })) }, action => {
      const item = items[Number(action)];
      if (item && !item.separator) return item.fn();
    });
  }
  // Постоянная карточка (translate и т.п.): действия не закрывают попап,
  // handle.update() перерисовывает содержимое, handle.close() — закрывает.
  function card(payload, onAction = () => {}, onClose = () => {}) {
    if (current) finish({ id: current.id }, false);
    const id = "popup-" + Date.now() + "-" + (++sequence);
    current = { id, onAction, onClose, card: true, toggleable: !!payload.toggleable };
    let content = payload;
    const handle = {
      id,
      update(next) {
        if (!current || current.id !== id) return;
        content = { ...content, ...next };
        send("overlay_show", { payload: { ...content, id } }).catch(e => {
          finish({ id }, false);
          toast("Не удалось обновить карточку: " + e, "err");
        });
      },
      close() {
        if (!current || current.id !== id) return;
        finish({ id }, false);
        send("overlay_hide", { id }).catch(e => toast(String(e), "err"));
      },
    };
    handle.update(payload);
    return handle;
  }
  document.addEventListener("pointerdown", (e) => {
    // Клик по щиту в адресной строке — это сам им управляет (toggle):
    // не даём глобальному закрытию «поймать» клик раньше кнопки, иначе
    // попап закроется и тут же переоткроется (баг «нельзя закрыть щит»).
    if (e.target && e.target.closest && e.target.closest("#permAddrBtn")) {
      if (current && current.toggleable) return;
    }
    if (current) {
      const id = current.id;
      finish({ id }, false);
      send("overlay_hide", { id }).catch(e => toast(String(e), "err"));
    }
  }, true);
  return { open, menu, card, isOpen: (id) => !!(current && (!id || current.id === id)) };
})();

// ---------------------------------------------------------------------
// In-page dialogs. Native alert()/prompt()/confirm() spawn OS windows
// that end up BEHIND our native child webviews — invisible yet modal,
// freezing the whole app. They are fully replaced here.
// ---------------------------------------------------------------------

function uiDialog({ message = "", kind = "alert", value = "" } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dlg-overlay";
    overlay.innerHTML =
      `<div class="dlg" role="dialog"><div class="dlg-message"></div>` +
      (kind === "prompt" ? `<input class="dlg-input" type="text" />` : "") +
      `<div class="dlg-buttons">` +
      (kind !== "alert" ? `<button class="ghost-btn" data-r="cancel">Отмена</button>` : "") +
      `<button class="primary-btn" data-r="ok">ОК</button></div></div>`;
    overlay.querySelector(".dlg-message").textContent = message;
    document.body.appendChild(overlay);
    const input = overlay.querySelector(".dlg-input");
    if (input) input.value = value != null ? String(value) : "";
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) done(kind === "prompt" ? null : kind === "confirm" ? false : undefined);
      const b = e.target.closest("button[data-r]");
      if (!b) return;
      if (b.dataset.r === "ok") done(kind === "prompt" ? input.value : kind === "confirm" ? true : undefined);
      else done(kind === "prompt" ? null : false);
    });
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); done(kind === "prompt" ? input.value : kind === "confirm" ? true : undefined); }
      if (e.key === "Escape") done(kind === "prompt" ? null : kind === "confirm" ? false : undefined);
    });
    (input || overlay.querySelector('[data-r="ok"]')).focus();
    if (input) input.select();
  });
}
const alert = (m) => uiDialog({ message: String(m ?? ""), kind: "alert" });
const prompt = (m, v) => uiDialog({ message: String(m ?? ""), kind: "prompt", value: v });
const confirm = (m) => uiDialog({ message: String(m ?? ""), kind: "confirm" }).then((r) => r === true);

// ---------------------------------------------------------------------
// Custom titlebar window controls
// ---------------------------------------------------------------------

function tauriWin() {
  try {
    const W = window.__TAURI__.window;
    return (W.getCurrentWindow || W.getCurrent)();
  } catch { return null; }
}
document.getElementById("winMin").addEventListener("click", () => tauriWin()?.minimize());
document.getElementById("winMax").addEventListener("click", async () => {
  const w = tauriWin();
  if (w) await w.toggleMaximize();
});
document.getElementById("winClose").addEventListener("click", () => tauriWin()?.close());

// Развёрнуто/восстановлено: рамка-прослойка между окном и краями экрана
// (html.is-maximized в style.css). После смены режима пересчитываем дырку
// под нативные вебвью — она сдвигается на толщину padding.
let maxFrameBusy = false;
async function syncMaximizedFrame() {
  if (maxFrameBusy) return;
  maxFrameBusy = true;
  const w = tauriWin();
  if (w) {
    try {
      const max = await w.isMaximized();
      document.documentElement.classList.toggle("is-maximized", !!max);
    } catch { /* окно недоступно */ }
  }
  if (typeof syncPageLayout === "function") {
    syncPageLayout(true);
    setTimeout(() => syncPageLayout(), 240);
  }
  maxFrameBusy = false;
}
try {
  tauriWin()?.onResized(() => { syncMaximizedFrame(); });
} catch { /* API недоступен */ }
setTimeout(syncMaximizedFrame, 60); // первичная синхронизация после загрузки

// Window dragging is now the NATIVE system SC_MOVE loop (@tauri-apps/api
// window label startDragging): Windows renders its own snap previews and
// outline animations, exactly like every other app.
// Regions: [data-apb-drag] (titlebar areas). Interactive kids are excluded.
document.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const region = e.target.closest?.("[data-apb-drag]");
  if (!region) return;
  if (e.target.closest("button,input,select,textarea,a,.win-controls,.nav-group")) return;
  e.preventDefault();
  const w = tauriWin();
  if (w) w.startDragging().catch(() => {});
}, true);
document.addEventListener("dblclick", (e) => {
  const region = e.target.closest?.("[data-apb-drag]");
  if (!region || e.target.closest("button,input,select,textarea,a,.win-controls")) return;
  document.getElementById("winMax")?.click();
});

// Window resizing. tao's frameless hit-test handles only the top edge (its
// shadow marker kicks in), so pulling sides/bottom doesn't resize — instead
// we overlay invisible grab strips at the window edges and drive
// startResizeDragging() (@tauri-apps/api window plugin) directly.
(() => {
  // localStorage-ключи-полоски → имена сторон для startResizeDragging
  const DIR = {
    top: "North", bottom: "South", left: "West", right: "East",
    "top-left": "NorthWest", "top-right": "NorthEast",
    "bottom-left": "SouthWest", "bottom-right": "SouthEast",
  };
  const host = document.createElement("div");
  host.id = "winResize";
  host.innerHTML =
    Object.keys(DIR)
      .map((k) => '<div class="rs" data-dir="' + k + '"></div>')
      .join("");
  document.body.appendChild(host);
  host.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const h = e.target.closest?.("[data-dir]");
    if (!h) return;
    // Развёрнутое окно тянем за тайтлбар, а не за границы.
    if (document.documentElement.classList.contains("is-maximized")) return;
    e.preventDefault();
    const w = tauriWin();
    if (w) w.startResizeDragging(DIR[h.dataset.dir]).catch(() => {});
  }, true);
})();

// Visible error reporting (helps catch silent breakages) + toasts
window.addEventListener("error", (ev) => {
  try { toast("⚠ Ошибка: " + (ev.message || "неизвестно")); } catch { /* ignore */ }
});
// Тосты складываются в вертикальный стек (#toastStack), а не ложатся друг
// на друга. kind: "ok" | "err" — зелёная/красная рамка (graph.js уже передаёт).
function toast(msg, kind) {
  let stack = document.getElementById("toastStack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toastStack";
    document.body.appendChild(stack);
  }
  const t = document.createElement("div");
  t.className = "toast" + (kind ? " " + kind : "");
  t.setAttribute('role',kind==='err'?'alert':'status');
  const icon=document.createElement('span');icon.className='toast-symbol';icon.textContent=kind==='err'?'!':kind==='ok'?'✓':'i';
  const text=document.createElement('span');text.textContent=msg;
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='×';dismiss.setAttribute('aria-label','Закрыть уведомление');dismiss.onclick=()=>t.remove();t.append(icon,text,dismiss);
  stack.appendChild(t);
  while (stack.children.length > 6) stack.firstElementChild?.remove(); // не даём расти бесконечно
  setTimeout(() => {
    t.classList.add("hide");
    setTimeout(() => t.remove(), 200);
  }, 3200);
}

// Sidebar collapse button — bound here at the END of the script so nothing
// above can prevent it from attaching. ВАЖНО: единственный обработчик
// (дубль в session-ws-downloads-tabs.js удалён — двойной toggle ломал кнопку).
{
  const cb = document.getElementById("collapseBtn");
  if (cb && !cb._bound) {
    cb._bound = true;
    cb.addEventListener("click", () => {
      document.body.classList.toggle("collapsed");
      const sb = document.getElementById("sidebar");
      sb.classList.remove("peek");
      try {
        localStorage.setItem("apb-side-collapsed",
          document.body.classList.contains("collapsed") ? "1" : "0");
      } catch (_) {}
      syncPageLayout(true);
      setTimeout(syncPageLayout, 240);
    });
  }
  // Restore saved collapse state after all modules are loaded (timers fire
  // only after the synchronous script queue, so syncPageLayout exists here).
  setTimeout(() => {
    let saved = null;
    try { saved = localStorage.getItem("apb-side-collapsed"); } catch (_) {}
    if (saved === "1" && !document.body.classList.contains("collapsed")) {
      document.body.classList.add("collapsed");
      if (typeof syncPageLayout === "function") syncPageLayout(true);
    }
  }, 0);
  // Peek: temporarily expand the collapsed rail while the cursor is over it.
  // Работает ТОЛЬКО если включена настройка (body.side-hover, чекбокс
  // «Открывать свёрнутую панель при наведении» в Оформлении). По умолчанию
  // панель открывается ТОЛЬКО кнопкой-стрелкой.
  const sb = document.getElementById("sidebar");
  if (sb && !sb._peekBound) {
    sb._peekBound = true;
    let peekTimer = null;
    sb.addEventListener("mouseenter", () => {
      if (!document.body.classList.contains("collapsed")) return;
      if (!document.body.classList.contains("side-hover")) return;
      clearTimeout(peekTimer);
      requestAnimationFrame(() => sb.classList.add("peek"));
    });
    sb.addEventListener("mouseleave", () => {
      if (!document.body.classList.contains("collapsed")) return;
      if (!document.body.classList.contains("side-hover")) return;
      peekTimer = setTimeout(() => {
        sb.classList.remove("peek");
        syncPageLayout();
      }, 160);
    });
  }
}

// ---------------------------------------------------------------------
// Тёмная тема для сайтов — НЕ слепая инверсия, а поэтапная перекраска:
//  1) SMART-PAINT: тёмная база (bg/text/border/links) + color-scheme:dark
//     (нативные контролы и скроллбары темнеют сами). Картинки/видео не
//     трогаем — не выцветают, как при инверсии.
//  2) Фолбэк: если через 700мс фон страницы остался светлым (сайт красит
//     фон инлайном/хитро) — включаем прежнюю аккуратную инверсию html с
//     РЕ-инверсией медиа (img/video/svg/iframe остаются нормальными).
// ---------------------------------------------------------------------

const tabDark = new Set();
const DARK_ON_JS =
  "(function(){if(document.getElementById('apbDark'))return;" +
  "var s=document.createElement('style');s.id='apbDark';" +
  "s.textContent='" +
  "html{color-scheme:dark!important;background:#18181c!important;color:#f2f2f4!important}" +
  "body{background:#18181c!important;color:#f2f2f4!important}" +
  "a{color:#8ab4f8!important}" +
  ".text-muted,.text-secondary,.text-faint{color:#a6a6b0!important}" +
  ".bg-white,.bg-light,.light-theme,.theme-light{background:#18181c!important;color:#f2f2f4!important}" +
  ".text-dark,.text-black{color:#f2f2f4!important}" +
  ".border{border-color:#3a3a44!important}" +
  "';" +
  "document.documentElement.appendChild(s);" +
  // Фолбэк-детектор светлого фона:body всё ещё белый/прозрачный → сайту
  // нужен фильтр. Ре-инверсия медиа не даёт «негативным» стать фото.
  "setTimeout(function(){" +
  "try{" +
  "var bg=document.defaultView.getComputedStyle(document.body).backgroundColor;" +
  "var trans=!bg||bg==='rgba(0, 0, 0, 0)'||bg==='transparent';" +
  "var light=/^\\(?(255|254|250|248)/.test(bg.replace(/\\s/g,''))||bg.indexOf('255, 255, 255')>=0;" +
  "if(trans||light){" +
  "var s3=document.createElement('style');s3.id='apbDark3';" +
  "s3.textContent='html{filter:invert(1) hue-rotate(180deg)!important;background:#fff!important}'" +
  "+'img,video,picture,svg:not(#apbDark svg),iframe,[style*=\"background-image:url\"]{filter:invert(1) hue-rotate(180deg)}';" +
  "document.documentElement.appendChild(s3);}}catch(e){}" +
  "},700);})();";
const DARK_OFF_JS =
  "(function(){['apbDark','apbDark3'].forEach(function(i){" +
  "var s=document.getElementById(i);if(s)s.remove();});})();";

function applyDarkTab(id, on) {
  invokeV2("page_eval", { id, js: on ? DARK_ON_JS : DARK_OFF_JS }).catch(() => {});
}
function updateDarkSiteBtn() {
  const b = document.getElementById("darkSiteBtn");
  if (!b) return;
  const t = currentTabObj();
  const on = !!(t && tabDark.has(t.id));
  b.classList.toggle("active-dark", on);
  b.title = on ? "Выключить тёмную тему сайта" : "Тёмная тема для сайта (если у сайта её нет)";
  b.querySelector("use")?.setAttribute("href", on ? "#i-sun" : "#i-moon");
}
document.getElementById("darkSiteBtn")?.addEventListener("click", () => {
  const t = currentTabObj();
  if (!t) { toast("Сначала откройте вкладку"); return; }
  if (tabDark.has(t.id)) { tabDark.delete(t.id); applyDarkTab(t.id, false); }
  else { tabDark.add(t.id); applyDarkTab(t.id, true); uiSound(660, 0.05); }
  updateDarkSiteBtn();
});
function reapplyDarkAfterNav(id) {
  if (tabDark.has(id)) setTimeout(() => applyDarkTab(id, true), 1200);
}

// ---------------------------------------------------------------------
// Слайдеры: заполненная часть дорожки рисуется через --fill (CSS-градиент),
// значение обновляется на input/change. Делегирование ловит и слайдеры,
// созданные позже (панели, настройки, виджеты).
// ---------------------------------------------------------------------
function apbRangeFill(el) {
  if (!(el instanceof HTMLInputElement) || el.type !== "range") return;
  const min = +el.min || 0, max = +el.max || 100;
  const pct = max > min ? ((+el.value - min) / (max - min)) * 100 : 0;
  el.style.setProperty("--fill", Math.max(0, Math.min(100, pct)) + "%");
}
document.addEventListener("input", (e) => apbRangeFill(e.target), true);
document.addEventListener("change", (e) => apbRangeFill(e.target), true);
document.querySelectorAll('input[type="range"]').forEach(apbRangeFill);

// ---------------------------------------------------------------------

// Made by MrDuck