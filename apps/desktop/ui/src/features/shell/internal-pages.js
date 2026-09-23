// Made by MrDuck
// ---------------------------------------------------------------------
// UI sounds — tiny WebAudio blips, no assets
// ---------------------------------------------------------------------

let _audioCtx = null;
function uiSound(freq = 660, dur = 0.05, type = "triangle", vol = 0.05) {
  if (!pzLoad().sound) return;
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = _audioCtx.createOscillator();
    const g = _audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, _audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + dur);
    o.connect(g).connect(_audioCtx.destination);
    o.start();
    o.stop(_audioCtx.currentTime + dur);
  } catch { /* audio unavailable */ }
}

document.querySelectorAll(".rail-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.tab === "ai") { toggleAiPane(); return; }
    const isOpen = sidePanel.classList.contains("open");
    const isThisActive = btn.classList.contains("active");
    if (isOpen && isThisActive) {
      closeSidePanel();
    } else {
      openSidePanel(btn.dataset.tab);
    }
  });
});

document.getElementById("settingsBtn").addEventListener("click", () => {
  if (internalOpen === "settings") closeInternal();
  else openInternal("settings");
});


// ---------------------------------------------------------------------
// Internal pages (settings / vault / extensions) — "site-like" pages
// that take over the content area instead of living in a drawer.
// ---------------------------------------------------------------------

const internalHost = document.getElementById("internalHost");
let internalOpen = null;
let internalReturnId = null;

function closeInternal(restore = true) {
  if (!internalOpen) return;
  internalOpen = null;
  internalHost.classList.add("hidden");
  if (restore && internalReturnId && tabs.some((t) => t.id === internalReturnId)) {
    switchTab(internalReturnId);
  } else if (restore && !activeTabId) {
    showHome();
  }
}

async function openInternal(id) {
  await invokeV2("page_hide_all").catch(() => {});
  internalReturnId = activeTabId;
  activeTabId = null;
  internalOpen = id;
  sidePanel.classList.remove("open");
  document.querySelectorAll(".rail-item").forEach((b) => b.classList.remove("active"));
  internalHost.classList.remove("hidden");
  document.getElementById("browserEmpty").classList.add("hidden");
  document.body.classList.remove("on-home");
  // Reliable entrance animation for the panel that just became active —
  // both on first open and when switching between sections. A forced
  // reflow (offsetWidth read) between removing and re-adding the class
  // guarantees the animation restarts every time, instead of depending
  // on the browser to notice a display:none -> block transition.
  // NOTE: several ids here (e.g. "history") are reused by an unrelated
  // side-panel drawer element elsewhere in the document, so we resolve
  // the target through this already-scoped #internalHost .panel list
  // rather than a fresh document.getElementById(id), which could grab
  // the wrong node.
  document.querySelectorAll("#internalHost .panel").forEach((p) => {
    const isActive = p.id === id;
    p.classList.toggle("active", isActive);
    if (isActive) {
      p.classList.remove("ip-anim");
      void p.offsetWidth;
      p.classList.add("ip-anim");
    }
  });
  document.querySelectorAll(".isec-link").forEach((b) =>
    b.classList.toggle("active", b.dataset.isec === id));
  renderTabStrip();
  resetSettingsSearch();
  if (id === "settings") {
    pzSyncControls();
  }
  if (id === "appearance") {
    pzSyncControls();
  }
  if (id === "privacy") {
    refreshPrivacy().catch(() => {});
  }
  if (id === "weatherSettings") {
    renderWeatherPreview();
    const cc = document.getElementById("wxCurCity");
    try {
      const cfg = JSON.parse(localStorage.getItem("apb-weather"));
      if (cc) cc.textContent = cfg?.city ? `Текущий город: ${cfg.city}` : "Город не выбран";
    } catch {}
  }
  if (id === "history") {
    loadFullHistory();
  }
  if (id === "experimental") {
    refreshExperimental();
  }
}

async function refreshExperimental() {
  try {
    const cfg = await invokeV2("experimental_get");
    const autoplay = document.getElementById("expAutoplay");
    const clipSync = document.getElementById("expClipboardSync");
    if (autoplay) {
      autoplay.checked = !!cfg.autoplay_allowed;
      autoplay.onchange = async () => {
        await invokeV2("experimental_save", { autoplayAllowed: autoplay.checked }).catch(() => {});
        toast(autoplay.checked ? "Автозапуск разрешён — после перезапуска" : "Автозапуск заблокирован");
      };
    }
    if (clipSync) {
      clipSync.checked = !!cfg.clipboard_sync;
      clipSync.onchange = async () => {
        await invokeV2("experimental_save", { clipboardSync: clipSync.checked }).catch(() => {});
        toast(clipSync.checked ? "Синхронизация буфера обмена включена" : "Синхронизация буфера обмена выключена");
      };
    }
  } catch (e) {}
}

document.querySelectorAll(".isec-link").forEach((b) =>
  b.addEventListener("click", () => openInternal(b.dataset.isec)));

async function refreshSidePanels() {
  const jobs = [
    ["bookmarks", refreshBookmarks],
    ["history", refreshHistory],
    ["downloads", refreshDownloads],
    ["notes", refreshNotes],
    ["privacy", refreshPrivacy],
    ["network", refreshNetwork],
    ["vault", refreshVault],
    ["extensions", refreshExtensions],
  ];
  const results = await Promise.allSettled(jobs.map(([, run]) => Promise.resolve().then(run)));
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error(`panel refresh (${jobs[i][0]})`, result.reason);
    }
  });
  return results;
}

// ---------------------------------------------------------------------
// Search across the internal settings pages: groups of rows are hidden
// unless any of them matches the query. Sections without the
// data-searchable attribute (vault grid, extensions) stay untouched.
// ---------------------------------------------------------------------

function resetSettingsSearch() {
  const inp = document.getElementById("settingsSearch");
  if (inp) inp.value = "";
  applySettingsFilter("");
}

function applySettingsFilter(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll("#internalHost .internal-page[data-searchable]").forEach((sec) => {
    const kids = [...sec.children];
    let groups = [];
    let cur = null;
    for (const el of kids) {
      if (el.classList.contains("panel-subtitle")) {
        cur = { head: el, body: [] };
        groups.push(cur);
      } else if (cur) {
        cur.body.push(el);
      }
    }
    if (!q) {
      groups.forEach((g) => [g.head, ...g.body].forEach((el) => el.classList.remove("hidden")));
      return;
    }
    for (const g of groups) {
      const text = [g.head, ...g.body].map((el) => el.textContent).join(" ").toLowerCase();
      const hit = text.includes(q);
      g.head.classList.toggle("hidden", !hit);
      g.body.forEach((el) => el.classList.toggle("hidden", !hit));
    }
  });
}

document.getElementById("settingsSearch")?.addEventListener("input", (e) => {
  applySettingsFilter(e.target.value);
});


// Made by MrDuck