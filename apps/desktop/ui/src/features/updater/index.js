// Made by MrDuck
// APB auto-update UI: startup check → центральное окно «Обновить сейчас /
// Позже» (обязательное — без «Позже» и без закрытия), после установки и
// перезапуска — окно «Что нового». Пока окно открыто — нативные вебвью
// гасятся (page_hide_all), как у контекст-меню/палитры (контракт #5).
(function () {
  "use strict";

  const LS_AUTO = "apb-auto-update";       // '0' = выключена автопроверка
  const LS_LASTVER = "apb-last-version";
  const LS_PENDING = "apb-pending-changelog";

  let appVersion = "";
  let busy = false;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }

  // --- стили (один раз) ---------------------------------------------------
  if (!document.getElementById("apbUpdCss")) {
    const st = document.createElement("style");
    st.id = "apbUpdCss";
    st.textContent =
      ".upd-notes{white-space:pre-wrap;font-size:13px;line-height:1.5;opacity:.92;" +
      "max-height:38vh;overflow:auto;background:var(--bg-soft);border-radius:10px;" +
      "padding:12px 14px;margin:12px 0 4px}" +
      ".upd-mandatory{display:inline-flex;align-items:center;gap:6px;font-size:12px;" +
      "color:#ff9c8a;border:1px solid rgba(255,120,90,.45);border-radius:999px;" +
      "padding:3px 10px;margin-bottom:6px;background:rgba(255,110,80,.08)}" +
      ".dlg.upd-dlg{width:min(560px,94vw);max-width:94vw;text-align:left}" +
      ".upd-ver{font-size:12px;opacity:.65;margin-top:2px}";
    document.head.appendChild(st);
  }

  // --- гашение вебвью на время модалки ------------------------------------
  let hiddenForModal = false;
  function webviewsAway() {
    try {
      const t = typeof activeTabId !== "undefined" ? activeTabId : null;
      const canHide = t && !window.__apbSplitPair;
      if (!canHide) return;
      invokeV2("page_hide_all").then(() => { hiddenForModal = true; }).catch(() => {});
    } catch (_) {}
  }
  function webviewsBack() {
    if (!hiddenForModal) return;
    hiddenForModal = false;
    try { if (typeof switchTab === "function" && activeTabId) switchTab(activeTabId); } catch (_) {}
  }

  // --- центральная модалка -------------------------------------------------
  // opts: {title, subtitle, notes, mandatory, buttons:[{label,cls,onClick}], dismissible}
  function centerModal(opts) {
    const overlay = document.createElement("div");
    overlay.className = "dlg-overlay";
    overlay.innerHTML =
      '<div class="dlg upd-dlg" role="dialog">' +
      (opts.mandatory ? '<span class="upd-mandatory">🔒 Обязательное обновление</span>' : "") +
      '<h2 class="dlg-message" style="font-size:19px"></h2>' +
      (opts.subtitle ? '<div class="upd-ver"></div>' : "") +
      (opts.notes ? '<div class="upd-notes"></div>' : "") +
      '<div class="dlg-buttons" style="justify-content:flex-end;margin-top:14px"></div></div>';

    overlay.querySelector(".dlg-message").textContent = opts.title || "";
    if (opts.subtitle) overlay.querySelector(".upd-ver").textContent = opts.subtitle;
    if (opts.notes) overlay.querySelector(".upd-notes").textContent = String(opts.notes);

    const foot = overlay.querySelector(".dlg-buttons");
    const btns = [];
    (opts.buttons || []).forEach((b) => {
      const el = document.createElement("button");
      el.className = b.cls === "ghost" ? "ghost-btn" : "primary-btn";
      el.textContent = b.label;
      el.addEventListener("click", () => b.onClick(api));
      foot.appendChild(el);
      btns.push(el);
    });

    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      webviewsBack();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "Escape" && opts.dismissible) close();
    }
    if (opts.dismissible) {
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
      document.addEventListener("keydown", onKey);
    }
    const api = { el: overlay, close, btns };
    (btns[btns.length - 1] || {}).focus?.();
    return api;
  }

  // --- сценарий установки ---------------------------------------------------
  async function install(info) {
    if (busy) return;
    busy = true;
    try {
      lsSet(LS_PENDING, JSON.stringify({ version: info.version || "", notes: info.notes || "" }));
      toast("⬇ Скачиваю обновление…");
      await invoke("update_install", { url: info.url, signature: info.signature });
      toast("✅ Обновление установлено. Перезапуск…", "ok");
      setTimeout(() => {
        try { window.__TAURI__.process.exit(0); } catch (_) { window.close(); }
      }, 900);
    } catch (e) {
      busy = false;
      toast("⚠ " + (e && e.toString ? e.toString() : "Ошибка установки"), "err");
    }
  }

  function promptUpdate(info) {
    webviewsAway();
    const mandatory = !!info.mandatory;
    const buttons = [{ label: "⬇ Обновить сейчас", onClick: (m) => install(info, m) }];
    if (!mandatory) {
      buttons.push({ label: "Позже", cls: "ghost", onClick: (m) => m.close() });
    }
    centerModal({
      title: "Доступно обновление AP Browser " + info.version,
      subtitle: "Текущая версия: " + info.current_version,
      notes: info.notes || "Список изменений не указан.",
      mandatory,
      dismissible: !mandatory,
      buttons
    });
  }

  // --- проверка -------------------------------------------------------------
  async function checkNow(silent) {
    if (busy) return null;
    try {
      const info = await invoke("update_check");
      if (!info.available) {
        if (!silent) toast("У вас последняя версия ✅", "ok");
        return null;
      }
      promptUpdate(info);
      return info;
    } catch (e) {
      if (!silent) toast("⚠ Обновления: " + e, "err");
      return null;
    }
  }

  // --- «Что нового» после перезапуска --------------------------------------
  async function whatsNew() {
    appVersion = await invoke("app_version").catch(() => "");
    const lastShown = lsGet(LS_LASTVER);

    const pendingRaw = lsGet(LS_PENDING);
    let pending = null;
    try { pending = pendingRaw ? JSON.parse(pendingRaw) : null; } catch (_) {}

    if (pending && pending.version === appVersion && lastShown !== appVersion) {
      webviewsAway();
      centerModal({
        title: "🎉 AP Browser обновлён до " + appVersion,
        subtitle: "Что нового",
        notes: pending.notes || "Спасибо, что пользуетесь AP Browser!",
        dismissible: true,
        buttons: [{ label: "Отлично!", onClick: (m) => m.close() }]
      });
      lsSet(LS_LASTVER, appVersion);
      lsDel(LS_PENDING);
      return;
    }
    // рассинхрон (установилось что-то другое / уже показывали)
    if (pending && pending.version !== appVersion) lsDel(LS_PENDING);
    if (lastShown !== appVersion) lsSet(LS_LASTVER, appVersion);
  }

  // --- блок в Настройках -----------------------------------------------------
  function wireSettings() {
    const verLabel = document.getElementById("updVerLabel");
    const chkBtn = document.getElementById("updCheckBtn");
    const autoChk = document.getElementById("updAutoChk");
    if (verLabel && appVersion) verLabel.textContent = "Установлена версия: " + appVersion;
    if (autoChk) {
      autoChk.checked = lsGet(LS_AUTO) !== "0";
      autoChk.addEventListener("change", () => {
        lsSet(LS_AUTO, autoChk.checked ? "1" : "0");
        toast(autoChk.checked ? "Автопроверка включена" : "Автопроверка выключена");
      });
    }
    if (chkBtn && !chkBtn._bound) {
      chkBtn._bound = true;
      chkBtn.addEventListener("click", async () => {
        if (chkBtn._busy) return;
        chkBtn._busy = true;
        const old = chkBtn.textContent;
        chkBtn.textContent = "Проверяем…";
        const found = await checkNow(false);
        if (!found && !busy) chkBtn.textContent = old;
        else chkBtn.textContent = old;
        chkBtn._busy = false;
      });
    }
  }

  // --- старт ------------------------------------------------------------------
  setTimeout(async () => {
    appVersion = await invoke("app_version").catch(() => "");
    wireSettings();
    await whatsNew();
    const autoOn = lsGet(LS_AUTO) !== "0";
    if (autoOn) setTimeout(() => checkNow(true), 4000);
  }, 1500);

  // Наружу — для палитры/отладки.
  window.APBUpdate = { checkNow };
})();

// Made by MrDuck
