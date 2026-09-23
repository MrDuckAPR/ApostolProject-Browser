// Made by MrDuck
// ---------------------------------------------------------------------

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

(async function init() {
  syncPageLayout(true);
  applyWidgetCfg();
  // First-run onboarding (shown once)
  if (!localStorage.getItem("apb-onboarded-v8")) setTimeout(() => {
    try { if (typeof showOnboarding === "function") showOnboarding(); } catch {}
  }, 0);
  // Старт: вкладки из прошлой сессии СОХРАНЯЮТСЯ и видны в списке, но
  // открываются как «спящие» (без вебвью) — на экране главный экран,
  // клик по вкладке будит её. Порядок сохраняем (новые сверху).
  try {
    const s = await invoke("session_get");
    const list = s && Array.isArray(s.tabs) ? s.tabs.filter((t) => t && t.url) : [];
    const sub = list.slice(-15);
    for (let i = sub.length - 1; i >= 0; i--) addSleepingTab(sub[i].url, sub[i].label, !!sub[i].pinned);
    // 📁 группы-папки: group = индекс ХОЗЯИНА в исходном списке; после
    // addSleepingTab (unshift) порядок обратный — ремап по индексам.
    if (typeof apbRemapGroups === "function") apbRemapGroups(sub);
  } catch { /* no saved session */ }
  // Стартуем с настоящей вкладкой «Новая вкладка» (пилюля + главный экран)
  openNewTabPage();
  await loadProfiles();
  await wsInit();
  await refreshSidePanels();
  renderTabStrip();
})();

// ---------------------------------------------------------------------
// Note editor: split pane with markdown editor, live preview and drawing
// ---------------------------------------------------------------------

const editorPane = document.getElementById("editorPane");
const edTitle = document.getElementById("edTitle");
const edText = document.getElementById("edText");
const edPreview = document.getElementById("edPreview");
const edSaveState = document.getElementById("edSaveState");

let edFile = null;
let edSaveTimer = null;
let drawReady = false;

function openEditor(file, content) {
  edFile = file;
  edTitle.value = file.replace(/\.md$/, "");
  edText.value = content;
  edSaveState.textContent = "";
  editorPane.classList.remove("hidden");
  syncPageLayout();
  setEtab("write");
  if (!drawReady) initDraw();
}

function closeEditor() {
  saveNow();
  editorPane.classList.add("hidden");
  edFile = null;
  syncPageLayout();
}

function setEtab(name) {
  document.querySelectorAll(".editor-tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.etab === name));
  document.getElementById("etabWrite").classList.toggle("hidden", name !== "write");
  document.getElementById("etabDraw").classList.toggle("hidden", name !== "draw");
  document.getElementById("etabPreview").classList.toggle("hidden", name !== "preview");
  document.getElementById("etabGraph").classList.toggle("hidden", name !== "graph");
  if (name === "preview") renderPreview();
  if (name === "draw") requestAnimationFrame(sizeDrawCanvas);
  if (name === "graph") requestAnimationFrame(reloadGraphData);
  else flushGraphSaves(); // leaving the graph tab — persist everything now
}

document.querySelectorAll(".editor-tabs button").forEach((b) =>
  b.addEventListener("click", () => setEtab(b.dataset.etab)));
document.getElementById("edClose").addEventListener("click", closeEditor);

function saveNow() {
  if (!edFile) return;
  const words = edText.value.trim() ? edText.value.trim().split(/\s+/).length : 0;
  invoke("create_note", { path: edFile, content: edText.value })
    .then(() => { edSaveState.textContent = `сохранено ✓ · ${words} слов`; setTimeout(() => (edSaveState.textContent = ""), 1800); })
    .catch((e) => { edSaveState.textContent = "ошибка"; uiDialog({ message: String(e), kind: "alert" }); });
}

edText.addEventListener("input", () => {
  edSaveState.textContent = "…";
  clearTimeout(edSaveTimer);
  edSaveTimer = setTimeout(saveNow, 900);
});

edTitle.addEventListener("change", async () => {
  // Rename = save copy under the new name and blank out the old file.
  const newName = edTitle.value.trim();
  if (!newName || !edFile) return;
  const file = newName.endsWith(".md") ? newName : newName + ".md";
  if (file === edFile) return;
  await invoke("create_note", { path: file, content: edText.value }).catch(alert);
  await invoke("create_note", { path: edFile, content: "" }).catch(() => {});
  edFile = file;
  await refreshNotes();
});

// ---- Markdown toolbar ----

function wrapSel(before, after = before, placeholder = "") {
  const s = edText.selectionStart, e = edText.selectionEnd;
  const sel = edText.value.slice(s, e) || placeholder;
  edText.setRangeText(before + sel + after, s, e, "select");
  edText.selectionStart = s + before.length;
  edText.selectionEnd = s + before.length + sel.length;
  edText.focus(); edText.dispatchEvent(new Event("input"));
}

function prefixLines(prefix, numbered = false) {
  const s = edText.selectionStart, e = edText.selectionEnd;
  const start = edText.value.lastIndexOf("\n", s - 1) + 1;
  const endIdx = edText.value.indexOf("\n", e);
  const end = endIdx === -1 ? edText.value.length : endIdx;
  const block = edText.value.slice(start, end);
  const lines = block.split("\n").map((l, i) => (numbered ? `${i + 1}. ` : prefix) + l);
  edText.setRangeText(lines.join("\n"), start, end, "end");
  edText.focus(); edText.dispatchEvent(new Event("input"));
}

const mdActions = {
  bold: () => wrapSel("**"),
  italic: () => wrapSel("*"),
  strike: () => wrapSel("~~"),
  h1: () => prefixLines("# "),
  h2: () => prefixLines("## "),
  h3: () => prefixLines("### "),
  ul: () => prefixLines("- "),
  ol: () => prefixLines("", true),
  task: () => prefixLines("- [ ] "),
  quote: () => prefixLines("> "),
  hr: () => insertAtCursor("\n\n---\n\n"),
  code: () => wrapSel("\n```\n", "\n```\n", "code"),
  link: async () => {
// Made by MrDuck
    const url = await prompt("URL сайта:", "https://");
    if (url) wrapSel("[", "](" + url + ")", "текст");
  },
  wikilink: () => wrapSel("[[", "]]", "заметка"),
  tag: () => wrapSel("#", "", "тег"),
  table: () => insertAtCursor("\n| Колонка 1 | Колонка 2 | Колонка 3 |\n|---|---|---|\n| ячейка | ячейка | ячейка |\n| | | |\n\n"),
  callout: () => insertAtCursor("\n> [!note] Заголовок\n> Текст callout-блока.\n\n"),
};

function insertAtCursor(text) {
  const s = edText.selectionStart;
  edText.setRangeText(text, s, edText.selectionEnd, "end");
  edText.focus(); edText.dispatchEvent(new Event("input"));
}

document.getElementById("mdToolbar").addEventListener("click", (e) => {
  if (e.target.closest("#mdHelpBtn")) return; // своя логика ниже
// Made by MrDuck
  const b = e.target.closest("button[data-md]");
  if (b && mdActions[b.dataset.md]) mdActions[b.dataset.md]();
});

edText.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === "s") { e.preventDefault(); saveNow(); }
  else if (k === "b") { e.preventDefault(); mdActions.bold(); }
  else if (k === "i") { e.preventDefault(); mdActions.italic(); }
});

// ---- Markdown renderer (tables, wikilinks, tasks, callouts, images) ----

function inlineMd(src) {
// Made by MrDuck
  let h = escapeHtml(src);
  h = h.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_, alt, src2) => `<img src="${src2}" alt="${alt}">`);
  h = h.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
  h = h.replace(/\[\^([^\]\s]+)\]/g, '<sup class="fnref">[$1]</sup>');
  h = h.replace(/\[\[([^\]]+)\]\]/g,
    (_, t) => `<span class="wikilink" data-open="${t.trim()}">${t.trim()}</span>`);
  h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, t, u) => `<span class="wikilink md-link" data-url="${u}">${t}</span>`);
  h = h.replace(/(^|\s)#([\wа-яё-]+)/gi, `$1<span class="hashtag">#$2</span>`);
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  h = h.replace(/(^|\W)\*([^*\n]+)\*/g, "$1<em>$2</em>");
  h = h.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  return h;
}

function renderMarkdown(src) {
  const lines = escapeHtml(src).split("\n");
  let html = "", i = 0;

  // Footnote definitions ([^id]: text) are collected and rendered at the end.
  const fnDefs = {};
  for (const l of lines) {
    const m = l.match(/^\s*\[\^([^\]]+)\]:\s*(.*)$/);
    if (m) fnDefs[m[1]] = m[2];
  }
  let taskIdx = 0;
  const indentPx = (l) => Math.floor((l.match(/^\s*/)[0].length) / 2) * 16;

  while (i < lines.length) {
    const line = lines[i];

    // YAML frontmatter (--- ... ---) → chips
    if (i === 0 && line.trim() === "---") {
      let j = 1;
      while (j < lines.length && lines[j].trim() !== "---") j++;
      if (j < lines.length) {
        const chips = lines.slice(1, j).map((l) => {
          const ci = l.indexOf(":");
          if (ci < 0) return "";
          return `<span class="fm"><b>${l.slice(0, ci).trim()}:</b> ${inlineMd(l.slice(ci + 1).trim())}</span>`;
        }).join("");
        html += `<div class="md-frontmatter">${chips}</div>`;
        i = j + 1;
        continue;
      }
    }

    if (/^```/.test(line)) {
      let buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      html += `<pre><code>${buf.join("\n")}</code></pre>`;
      continue;
    }
    if (/^#{1,4}\s/.test(line)) {
      const m = line.match(/^(#{1,4})\s+(.*)$/);
      html += `<h${m[1].length}>${inlineMd(m[2])}</h${m[1].length}>`; i++; continue;
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { html += "<hr>"; i++; continue; }

    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) {
        if (/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i])) { i++; continue; }
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        rows.push(cells); i++;
      }
      if (rows.length >= 2) {
        const [head, ...body] = rows;
        html += "<table><thead><tr>" + head.map((c) => `<th>${inlineMd(c)}</th>`).join("") + "</tr></thead><tbody>"
          + body.map((r) => "<tr>" + r.map((c) => `<td>${inlineMd(c)}</td>`).join("") + "</tr>").join("")
          + "</tbody></table>";
        continue;
      }
    }

    if (/^\s*[-*]\s+\[[ xX]\]\s/.test(line)) {
      let buf = [];
      while (i < lines.length && /^\s*[-*]\s+\[[ xX]\]\s/.test(lines[i])) {
        const done = /\[[xX]\]/.test(lines[i]);
        const text = lines[i].replace(/^\s*[-*]\s+\[[ xX]\]\s*/, "");
        buf.push(`<li class="task-line${done ? " done" : ""}" style="margin-left:${indentPx(lines[i])}px">` +
          `<input type="checkbox" class="taskbox" data-idx="${taskIdx++}" ${done ? "checked" : ""}> ` +
          `<span class="task-text">${inlineMd(text)}</span></li>`);
        i++;
      }
      html += `<ul style="list-style:none">${buf.join("")}</ul>`;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      let buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]) && !/\[[ xX]\]/.test(lines[i])) {
        buf.push(`<li style="margin-left:${indentPx(lines[i])}px">${inlineMd(lines[i].replace(/^\s*[-*]\s+/, ""))}</li>`); i++;
      }
      html += `<ul>${buf.join("")}</ul>`; continue;
    }
    if (/^\s*\d+\.\s/.test(line)) {
      let buf = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        buf.push(`<li style="margin-left:${indentPx(lines[i])}px">${inlineMd(lines[i].replace(/^\s*\d+\.\s/, ""))}</li>`); i++;
      }
      html += `<ol>${buf.join("")}</ol>`; continue;
    }
    if (/^\s*&gt;\s\[!(note|info|tip|warning|danger|quote)\]/.test(line)) {
      let buf = [line];
      i++;
      while (i < lines.length && /^\s*&gt;/.test(lines[i])) { buf.push(lines[i]); i++; }
      const body = buf.map((l) => l.replace(/^\s*&gt;\s?/, "")).join("\n");
      html += `<div class="callout">${inlineMd(body)}</div>`; continue;
    }
    if (/^\s*&gt;/.test(line)) {
      let buf = [];
      while (i < lines.length && /^\s*&gt;/.test(lines[i])) {
        buf.push(inlineMd(lines[i].replace(/^\s*&gt;\s?/, ""))); i++;
      }
      html += `<blockquote>${buf.join("<br>")}</blockquote>`; continue;
    }
    if (line.trim() === "") { i++; continue; }
    html += `<p>${inlineMd(line)}</p>`; i++;
  }

  // Footnotes section
  const fnKeys = Object.keys(fnDefs);
  if (fnKeys.length) {
    html += `<div class="footnotes"><strong>Сноски</strong><ul>` +
      fnKeys.map((k) => `<li><sup class="fnref">[${k}]</sup> ${inlineMd(fnDefs[k])}</li>`).join("") +
      `</ul></div>`;
  }
  return html;
}

// Asset-protocol URLs and local/relative paths can't load directly in the
// shell page — resolve them to data-URLs via read_note_asset (Rust).
const ASSET_URL_RE = /^(https?:\/\/asset\.localhost\/|asset:\/\/)/i;
function needsAssetHydration(src) {
  if (!src || src.startsWith("data:")) return false;
  if (/^https?:\/\//i.test(src)) return ASSET_URL_RE.test(src);
  return true;
}
function markImageBroken(img, src, err) {
  img.style.cssText += ";outline:2px solid var(--danger);padding:8px;min-height:40px;display:block;object-fit:contain";
  const cap = document.createElement("div");
  cap.className = "hint";
  cap.textContent = "⚠ Картинка не загрузилась: " + src + (err ? " (" + err + ")" : "");
  img.after(cap);
}
async function hydrateImageSrc(img, src) {
  try {
    img.src = await invoke("read_note_asset", { src });
    img.addEventListener("click", () => openImageLightbox(img.src));
    img.style.cursor = "zoom-in";
  } catch (err) {
    markImageBroken(img, src, err);
  }
}
function hydrateNoteImages(root) {
  root.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!needsAssetHydration(src)) {
      img.addEventListener("error", () => markImageBroken(img, src), { once: true });
      if (!img.closest(".bi-body")) {
        img.addEventListener("click", () => { if (img.naturalWidth) openImageLightbox(img.src); });
        img.style.cursor = "zoom-in";
      }
      return;
    }
    img.removeAttribute("src");
    hydrateImageSrc(img, src);
  });
}

// ---------------------------------------------------------------------
// LaTeX: $inline$ и $$блок$$ в превью заметок. Основной рендер — локальный
// KaTeX (ui/vendor/katex, офлайн, без CDN); texToHtml ниже остаётся
// фолбэком, если KaTeX не загрузился. Формулы вырезаются ДО markdown.
// ---------------------------------------------------------------------

const TEX_SYMBOLS = {
  "\\alpha": "α", "\\beta": "β", "\\gamma": "γ", "\\delta": "δ", "\\epsilon": "ε",
  "\\varepsilon": "ε", "\\zeta": "ζ", "\\eta": "η", "\\theta": "θ", "\\iota": "ι",
  "\\kappa": "κ", "\\lambda": "λ", "\\mu": "μ", "\\nu": "ν", "\\xi": "ξ", "\\pi": "π",
  "\\rho": "ρ", "\\sigma": "σ", "\\tau": "τ", "\\upsilon": "υ", "\\phi": "φ",
  "\\varphi": "φ", "\\chi": "χ", "\\psi": "ψ", "\\omega": "ω",
  "\\Gamma": "Γ", "\\Delta": "Δ", "\\Theta": "Θ", "\\Lambda": "Λ", "\\Xi": "Ξ",
  "\\Pi": "Π", "\\Sigma": "Σ", "\\Phi": "Φ", "\\Psi": "Ψ", "\\Omega": "Ω",
  "\\times": "×", "\\cdot": "·", "\\pm": "±", "\\mp": "∓", "\\leq": "≤", "\\geq": "≥",
  "\\neq": "≠", "\\ne": "≠", "\\approx": "≈", "\\equiv": "≡", "\\sim": "∼",
  "\\infty": "∞", "\\sum": "∑", "\\prod": "∏", "\\int": "∫", "\\partial": "∂",
  "\\nabla": "∇", "\\to": "→", "\\rightarrow": "→", "\\leftarrow": "←",
  "\\Rightarrow": "⇒", "\\Leftarrow": "⇐", "\\Leftrightarrow": "↔", "\\leftrightarrow": "↔",
  "\\in": "∈", "\\notin": "∉", "\\subset": "⊂", "\\subseteq": "⊆", "\\cup": "∪",
  "\\cap": "∩", "\\forall": "∀", "\\exists": "∃", "\\ldots": "…", "\\dots": "…",
  "\\angle": "∠", "\\degree": "°", "\\circ": "∘", "\\prime": "′", "\\hbar": "ℏ",
};

function texToHtml(src) {
  let out = String(src)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // \frac{a}{b} — два прохода ради простых вложенностей
  for (let pass = 0; pass < 2; pass++) {
    out = out.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,
      '<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>');
  }
  out = out.replace(/\\sqrt\s*\{([^{}]+)\}/g, '√<span class="ovl">$1</span>');
  out = out.replace(/\\text\s*\{([^{}]*)\}/g, '<span class="up">$1</span>');
  // степени/индексы: групповые и одиночные
  out = out.replace(/\^\{([^{}]+)\}/g, "<sup>$1</sup>");
  out = out.replace(/_\{([^{}]+)\}/g, "<sub>$1</sub>");
  out = out.replace(/\^([0-9A-Za-zа-яА-Я])/g, "<sup>$1</sup>");
  out = out.replace(/_([0-9A-Za-zа-яА-Я])/g, "<sub>$1</sub>");
  // символы
  for (const [k, v] of Object.entries(TEX_SYMBOLS)) {
    if (out.includes(k)) out = out.split(k).join(v);
  }
  // \left \right и остаточные скобки групп
  out = out.replace(/\\left|\\right/g, "").replace(/[{}]/g, "");
  return out;
}

function renderPreview() {
  const store = [];  let src = edText.value;
  // $$блок$$ и $инлайн$ извлекаем ДО markdown-парсера (чтобы * _ # внутри
  // формул не ел markdown), на их место — маркеры-заглушки
  src = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) =>
    (store.push({ b: true, m }), "\u0000M" + (store.length - 1) + "\u0000"));
  src = src.replace(/(^|[^\\])\$([^\n$]+?)\$/g, (_, p, m) =>
    (store.push({ b: false, m }), p + "\u0000M" + (store.length - 1) + "\u0000"));
  let html = renderMarkdown(src);
  html = html.replace(/\u0000M(\d+)\u0000/g, (_, i) => {
    const it = store[+i];
    if (!it) return "";
    // KaTeX (локальный, офлайн): полноценный рендер любых формул. Ошибку
    // синтаксиса не рендерим в красный крик — показываем формулу исходником
    // в title, как раньше. texToHtml — фолбэк без window.katex.
    if (typeof katex !== "undefined") {
      try {
        return katex.renderToString(it.m, {
          displayMode: it.b, throwOnError: true,
          output: "htmlAndMathml",
        });
      } catch { /* ниже — фолбэк */ }
    }
    return it.b
      ? `<div class="math math-block" title="${it.m.replace(/"/g, "&quot;")}">${texToHtml(it.m)}</div>`
      : `<span class="math" title="${it.m.replace(/"/g, "&quot;")}">${texToHtml(it.m)}</span>`;
  });
  edPreview.innerHTML = html;
  hydrateNoteImages(edPreview);
}

// ⬇ Экспорт текущей заметки как .md в Загрузки
document.getElementById("edExport")?.addEventListener("click", async () => {
  if (!edFile) { toast("Заметка не открыта", "err"); return; }
  try {
    const safe = edTitle.value.replace(/[\/\\:*?"<>|]/g, "_") + ".md";
    const p = await invoke("save_text_file", { name: safe, contents: edText.value });
    toast("Сохранено: " + p, "ok");
  } catch (err) { alert(err); }
});

// ❓ Шпаргалка markdown/LaTeX в редакторе заметок
document.getElementById("mdHelpBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("mdHelp").classList.toggle("hidden");
});
document.getElementById("mdHelpClose")?.addEventListener("click", () => {
  document.getElementById("mdHelp").classList.add("hidden");
});
document.addEventListener("pointerdown", (e) => {
  const t = e.target instanceof HTMLElement ? e.target : null;
  const help = document.getElementById("mdHelp");
  if (help && (!t || (!t.closest("#mdHelp") && !t.closest("#mdHelpBtn")))) {
    help.classList.add("hidden");
  }
});

// Full-screen image viewer. `item` = optional board item → adds a
// "replace source" action writing back to the block.
function openImageLightbox(src, item) {
  document.getElementById("apbLightbox")?.remove();
  const ov = document.createElement("div");
  ov.id = "apbLightbox";
  ov.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.84);display:flex;align-items:center;justify-content:center";
  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-direction:column;gap:10px;align-items:center;max-width:94vw";
  const img = document.createElement("img");
  img.alt = "Просмотр картинки";
  img.style.cssText = "max-width:90vw;max-height:78vh;border-radius:10px;background:#101014;box-shadow:0 12px 48px rgba(0,0,0,.6)";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px";
  const close = () => { document.removeEventListener("keydown", esc, true); ov.remove(); };
  const esc = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); close(); } };
  ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  document.addEventListener("keydown", esc, true);
  if (item) {
    const rep = document.createElement("button");
    rep.className = "ghost-btn";
    rep.textContent = "🔄 Заменить источник";
    rep.onclick = async () => {
      const url = await prompt("Новый URL картинки:", item.content.startsWith("data:") ? "" : "");
      close();
      if (url) { item.content = url; renderBoard(); scheduleSaveBoard(); }
    };
    row.appendChild(rep);
  }
  const cls = document.createElement("button");
  cls.className = "ghost-btn";
  cls.textContent = "Закрыть";
  cls.onclick = close;
  row.appendChild(cls);
  wrap.append(img, row);
  ov.appendChild(wrap);
  document.body.appendChild(ov);
  if (!src) { toast("Картинка ещё не загрузилась"); close(); return; }
  if (needsAssetHydration(src)) {
    invoke("read_note_asset", { src })
      .then((d) => { img.src = d; })
      .catch((err) => { toast("Не удалось открыть: " + err); close(); });
  } else {
    img.src = src;
  }
  uiSound(600, 0.05);
}

// Interactive task checkboxes in preview — write back to source and save.
edPreview.addEventListener("change", (e) => {
  if (!e.target.classList.contains("taskbox")) return;
  toggleTaskInSource(+e.target.dataset.idx, e.target.checked);
});

function toggleTaskInSource(idx, checked) {
  let n = -1;
  edText.value = edText.value.split("\n").map((line) => {
    if (/^\s*[-*]\s+\[[ xX]\]/.test(line)) {
      n++;
      if (n === idx) return line.replace(/\[( |x|X)\]/, checked ? "[x]" : "[ ]");
    }
    return line;
  }).join("\n");
  saveNow();
  renderPreview();
}

edPreview.addEventListener("click", async (e) => {
  const wl = e.target.closest(".wikilink");
  if (!wl) return;
  if (wl.dataset.url) { navigateActiveTab(wl.dataset.url); closeSidePanel(); return; }
  let name = wl.dataset.open;
  if (!name.endsWith(".md")) name += ".md";
  try {
    const content = await invoke("read_note", { path: name });
    openEditor(name, content);
    await refreshNotes();
  } catch {
    await invoke("create_note", { path: name, content: "# " + name.replace(/\.md$/, "") + "\n\n" });
    await refreshNotes();
    openEditor(name, "# " + name.replace(/\.md$/, "") + "\n\n");
  }
});

// ---------------------------------------------------------------------
// Drawing canvas in the note editor
// ---------------------------------------------------------------------

const drawCanvas = document.getElementById("drawCanvas");
const dctx = drawCanvas.getContext("2d");
let tool = "pen";
let drawing = false;
let dStart = null;
let dSnapshot = null;
let undoStack = [], redoStack = [];

function sizeDrawCanvas() {
  const stage = drawCanvas.parentElement;
  const rect = stage.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return;
  const prev = drawCanvas.width > 0 ? dctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height) : null;
  drawCanvas.width = Math.floor(rect.width * devicePixelRatio);
  drawCanvas.height = Math.floor(rect.height * devicePixelRatio);
  dctx.scale(devicePixelRatio, devicePixelRatio);
  if (prev) {
    const tmp = document.createElement("canvas");
    tmp.width = prev.width; tmp.height = prev.height;
    tmp.getContext("2d").putImageData(prev, 0, 0);
    dctx.drawImage(tmp, 0, 0, rect.width, rect.height);
  }
}

function initDraw() {
  sizeDrawCanvas();
  new ResizeObserver(() => { if (!drawing) sizeDrawCanvas(); }).observe(drawCanvas.parentElement);
  drawReady = true;
}

function pushUndo() {
  undoStack.push(dctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
  if (undoStack.length > 25) undoStack.shift();
  redoStack = [];
}
function doUndo() {
  if (!undoStack.length) return;
  redoStack.push(dctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
  dctx.putImageData(undoStack.pop(), 0, 0);
}
function doRedo() {
  if (!redoStack.length) return;
  undoStack.push(dctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
  dctx.putImageData(redoStack.pop(), 0, 0);
}

function dpos(e) {
  const r = drawCanvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function strokeStyle() {
  const color = document.getElementById("drawColor").value;
  const width = +document.getElementById("drawWidth").value;
  dctx.lineCap = "round"; dctx.lineJoin = "round";
  if (tool === "marker") { dctx.strokeStyle = color; dctx.fillStyle = color; dctx.lineWidth = width * 3.5; dctx.globalAlpha = 0.35; }
  else if (tool === "eraser") { dctx.strokeStyle = "rgba(0,0,0,1)"; dctx.globalCompositeOperation = "destination-out"; dctx.lineWidth = width * 2.5; dctx.globalAlpha = 1; }
  else { dctx.strokeStyle = color; dctx.fillStyle = color; dctx.lineWidth = width; dctx.globalAlpha = 1; }
}
function resetStyle() { dctx.globalAlpha = 1; dctx.globalCompositeOperation = "source-over"; }

drawCanvas.addEventListener("pointerdown", async (e) => {
  pushUndo();
  drawing = true;
  dStart = dpos(e);
  dSnapshot = dctx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
  drawCanvas.setPointerCapture(e.pointerId);
  strokeStyle();
  if (tool === "pen" || tool === "marker" || tool === "eraser") {
    dctx.beginPath(); dctx.moveTo(dStart.x, dStart.y); dctx.lineTo(dStart.x + 0.01, dStart.y); dctx.stroke();
  } else if (tool === "text") {
    drawing = false;
    const text = await prompt("Текст:", "");
    if (text) { resetStyle(); dctx.font = `${16 + (+document.getElementById("drawWidth").value * 2)}px sans-serif`; dctx.fillText(text, dStart.x, dStart.y); }
    else undoStack.pop();
  } else if (tool === "sticky") {
    drawing = false;
    const w = 170, h = 120;
    resetStyle();
    dctx.fillStyle = "#fff3bf"; dctx.fillRect(dStart.x, dStart.y, w, h);
    dctx.strokeStyle = "#c9a227"; dctx.strokeRect(dStart.x, dStart.y, w, h);
    dctx.fillStyle = "#5f4b00"; dctx.font = "13px sans-serif";
    const text = (await prompt("Текст стикера:", "")) || "";
    text.split("\n").forEach((ln, k) => dctx.fillText(ln, dStart.x + 8, dStart.y + 22 + k * 17));
    if (!text) undoStack.pop();
  }
});
drawCanvas.addEventListener("pointermove", (e) => {
  if (!drawing) return;
  const p = dpos(e);
  if (tool === "pen" || tool === "marker" || tool === "eraser") {
    dctx.lineTo(p.x, p.y); dctx.stroke();
    return;
  }
  dctx.putImageData(dSnapshot, 0, 0);
  strokeStyle();
  dctx.beginPath();
  if (tool === "rect") dctx.rect(dStart.x, dStart.y, p.x - dStart.x, p.y - dStart.y);
  else if (tool === "ellipse") dctx.ellipse((dStart.x + p.x) / 2, (dStart.y + p.y) / 2, Math.abs(p.x - dStart.x) / 2, Math.abs(p.y - dStart.y) / 2, 0, 0, Math.PI * 2);
  else if (tool === "line") { dctx.moveTo(dStart.x, dStart.y); dctx.lineTo(p.x, p.y); }
  else if (tool === "arrow") {
    dctx.moveTo(dStart.x, dStart.y); dctx.lineTo(p.x, p.y);
    const ang = Math.atan2(p.y - dStart.y, p.x - dStart.x), head = 12 + (+document.getElementById("drawWidth").value * 2);
    dctx.moveTo(p.x, p.y);
    dctx.lineTo(p.x - head * Math.cos(ang - Math.PI / 6), p.y - head * Math.sin(ang - Math.PI / 6));
    dctx.moveTo(p.x, p.y);
    dctx.lineTo(p.x - head * Math.cos(ang + Math.PI / 6), p.y - head * Math.sin(ang + Math.PI / 6));
  }
  dctx.stroke();
});
window.addEventListener("pointerup", () => { drawing = false; resetStyle(); });

document.querySelector(".draw-tools").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tool]");
  if (!b) return;
  tool = b.dataset.tool;
  document.querySelectorAll(".draw-tools button[data-tool]").forEach((x) => x.classList.toggle("active", x === b));
  drawCanvas.style.cursor = tool === "text" || tool === "sticky" ? "text" : "crosshair";
});
document.getElementById("drawUndo").addEventListener("click", doUndo);
document.getElementById("drawRedo").addEventListener("click", doRedo);
document.getElementById("drawClear").addEventListener("click", () => { pushUndo(); dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height); });

document.getElementById("drawInsert").addEventListener("click", async () => {
  const data = drawCanvas.toDataURL("image/png");
  if (data.length < 2000) return alert("Полотно пустое — нарисуйте что-нибудь.");
  try {
    const relPath = await invoke("save_note_image", { dataBase64: data });
    insertAtCursor(`\n![рисунок](${relPath})\n`);
    setEtab("write");
    saveNow();
  } catch (e) { alert(e); }
});

// Compatibility functions backed by the single widget store.
function getWidgetCfg(){return window.APBWidgets.get()}
function applyWidgetCfg(){window.APBWidgets.apply()}
