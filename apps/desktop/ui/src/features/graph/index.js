// Made by MrDuck
// ============================================================
// ui/js/graph/graph.js — GRAPH v2, canvas engine (full rewrite)
//
// One coordinate system for everything: world -> screen is
// `(w - view.x) * zoom`. The canvas draws nodes/edges/links/wire,
// board blocks stay DOM (for editing) but are positioned FROM THE
// SAME rAF tick with the SAME transform — misalignment impossible.
//
// Globals exposed: window.reloadGraphData, window.flushGraphSaves
// ============================================================
(function () {
  "use strict";

  // ---------------- state ----------------
  const G = { nodes: [], edges: [], items: [], links: [], loaded: false };
  const posMem = new Map();
  const view = { x: -400, y: -300, zoom: 1 };

  const ITEM_H = { text: 150, image: 200, clock: 96, tasks: 150, calendar: 250, weather: 170 };
  const ITEM_LABEL = { text: "Текст", image: "Картинка", clock: "Часы", tasks: "Задачи", calendar: "Календарь", weather: "Погода" };

  let searchQ = "";
  let clearArmed = false;

  // ---- graph settings (владеет js/graph/graph-settings.js) ----
  const GS = window.GraphSettings;
  const cfg = GS.cfg; // та же ссылка на объект — движок читает каждый кадр
  const GRID = 20;
  const snapV = (v) => (cfg.snap ? Math.round(v / GRID) * GRID : v);
  const EDGE_SPACING = 11; // world px between fanned-out parallel links

  // ---- selection (marquee / group move) ----
  const sel = new Set();          // keys: "n:<id>" | "i:<id>"
  const selKey = (t, id) => t + ":" + id;
  function selClear() { sel.clear(); }

  // dom refs
  let stage = null, canvas = null, ctx = null, blockLayer = null;
  let dpr = 1, CW = 800, CH = 600;
  const blockEls = new Map();
  let roAttached = false;

  // physics
  let alpha = 0;
  let draggingNode = null;

  // color cache (refreshed each draw — cheap enough)
  // ВАЖНО: у части переменных (--stroke-strong, --bg-2) НЕТ определения в
  // style.css. Пустая строка игнорируется canvas'ом → стиль утекает с прошлого
  // кадра (сетка «пропадала» в зависимости от того, что рисовали последним).
  // Поэтому каждый цвет берём цепочкой фолбэков и гарантируем непустое значение.
  const CV = {};
  function refreshColors() {
    const cs = getComputedStyle(document.documentElement);
    const pick = (names, fallback) => {
      for (const k of names) {
        const v = cs.getPropertyValue(k);
        if (v && v.trim()) return v.trim();
      }
      return fallback;
    };
    CV["--bg"]           = pick(["--bg"], "#0b0b0d");
    CV["--bg-1"]         = pick(["--bg-1", "--bg-soft", "--bg"], "#16161c");
    CV["--bg-2"]         = pick(["--bg-2", "--bg-soft", "--bg"], "#16161c");
    CV["--stroke-strong"] = pick(["--stroke-strong", "--border-strong", "--border"], "#8a8f98");
    CV["--text-dim"]     = pick(["--text-dim"], "#a6a6b0");
    CV["--text"]         = pick(["--text"], "#f2f2f4");
    CV["--accent"]       = pick(["--accent", "--link"], "#7fb0ff");
    CV["--accent-soft"]  = pick(["--accent-soft"], "rgba(127,176,255,.16)");
    CV["--link"]         = pick(["--link"], CV["--accent"]);
    CV["--danger"]       = pick(["--danger"], "#ff6575");
  }

  // ---------------- transforms ----------------
  const toWorld = (sx, sy) => ({ x: view.x + sx / view.zoom, y: view.y + sy / view.zoom });
  const toScreen = (wx, wy) => ({ x: (wx - view.x) * view.zoom, y: (wy - view.y) * view.zoom });
  function zoomAt(sx, sy, factor) {
    const w = toWorld(sx, sy);
    view.zoom = Math.min(4, Math.max(0.15, view.zoom * factor));
    view.x = w.x - sx / view.zoom;
    view.y = w.y - sy / view.zoom;
  }

  // ---------------- model helpers ----------------
  const stripMd = (s) => String(s).replace(/\.md$/i, "");
  function nodeById(id) { return G.nodes.find((n) => n.id === id); }
  function itemById(id) { return G.items.find((n) => n.id === id); }

  /** Node visual = CARD (rounded rect with the title INSIDE), not a circle.
   *  Причина: шары плохо брались мышью и были неинформативными. Карточка
   *  даёт понятный grab-area и всегда читаемый заголовок. */
  const NODE_H = 34;          // world px
  const NODE_MIN_W = 76;
  const NODE_MAX_W = 260;
  const NODE_PAD = 24;        // суммарные боковые отступы
  let measCtx = null;
  function measureLabel(t) {
    if (!measCtx) {
      const c = document.createElement("canvas");
      measCtx = c.getContext("2d");
    }
    measCtx.font = "12px Segoe UI, system-ui";
    return measCtx.measureText(t || "").width;
  }
  function nodeW(n) {
    if (n._w == null) {
      const tw = measureLabel(n.label || "");
      n._w = Math.round(Math.max(NODE_MIN_W, Math.min(NODE_MAX_W, NODE_PAD + tw)));
    }
    return n._w;
  }
  /** Hit/anchor box карточки: центр в (n.x, n.y). Используется и для якорей,
   *  и для hit-test, и для рамки-выделения — расхождений нет. */
  function nodeBox(n) {
    return { w: nodeW(n), h: NODE_H };
  }
  function itemSize(it) { return { w: it.w || 220, h: it.h ?? ITEM_H[it.type] ?? 150 }; }

  // ---------------- anchors (lines from the EDGES, not the center) ----------------
  const SIDES = ["t", "r", "b", "l"];
  const SIDE_DIR = { t: [0, -1], r: [1, 0], b: [0, 1], l: [-1, 0] };
  /** Fixed midpoint of a given side (world coords). Works for cards & blocks. */
  function sideMid(p, side) {
    const c = portCenter(p);
    if (!c) return null;
    const s = p.t === "n" ? nodeBox(nodeById(p.id)) : itemSize(itemById(p.id));
    if (!s) return null;
    const off = { t: [0, -s.h / 2], r: [s.w / 2, 0], b: [0, s.h / 2], l: [-s.w / 2, 0] }[side];
    return { x: c.x + off[0], y: c.y + off[1] };
  }
  /**
   * Anchor of a port for drawing: pinned side midpoint, or the border
   * intersection toward the other endpoint (so lines leave the EDGE).
   * When cfg.autoAnchor is on, pins are ignored — the point always floats
   * to face the other endpoint, recomputed every frame (Obsidian-style).
   */
  function anchorForPort(p, otherCenter) {
    const c = portCenter(p);
    if (!c) return null;
    const bx = boxFor(p);
    if (!bx) return null;
    if (!cfg.autoAnchor) {
      // free perimeter anchor (u = fraction of the perimeter walk)
      if (p.u !== undefined) return periPoint(bx, p.u);
      if (p.side) {
        const off = { t: [0, -bx.h / 2], r: [bx.w / 2, 0], b: [0, bx.h / 2], l: [-bx.w / 2, 0] }[p.side];
        return { x: c.x + off[0], y: c.y + off[1] };
      }
    }
    const dx = otherCenter.x - c.x, dy = otherCenter.y - c.y;
    if (!dx && !dy) return c;
    // карточки и блоки — прямоугольники: точка пересечения луча с границей
    const t = Math.min(bx.w / 2 / Math.abs(dx || 1e-9), bx.h / 2 / Math.abs(dy || 1e-9));
    return { x: c.x + dx * t, y: c.y + dy * t };
  }
  /** Cardinal-side anchor toward a point — always dynamic, used for elbow (ortho) routing. */
  function cardinalAnchor(p, otherCenter) {
    const side = sideForPoint(p, otherCenter) || "r";
    return sideMid(p, side) || portCenter(p);
  }
  /** Dominant side of a shape toward a world point (used on wire drop). */
  function sideForPoint(port, w) {
    const c = portCenter(port);
    if (!c) return undefined;
    const dx = w.x - c.x, dy = w.y - c.y;
    if (!dx && !dy) return undefined;
    if (port.t === "n") {
      const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      if (deg >= 315 || deg < 45) return "r";
      if (deg < 135) return "b";
      if (deg < 225) return "l";
      return "t";
    }
    const s = itemSize(itemById(port.id));
    const nx = dx / (s.w / 2), ny = dy / (s.h / 2);
    return Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? "r" : "l") : (ny > 0 ? "b" : "t");
  }

  // ---------------- perimeter anchors: wire from ANY point ----------------
  function boxFor(p) {
    const c = portCenter(p);
    if (!c) return null;
    const s = p.t === "n" ? nodeBox(nodeById(p.id)) : itemSize(itemById(p.id));
    return { x0: c.x - s.w / 2, y0: c.y - s.h / 2, w: s.w, h: s.h };
  }
  /** Point on the rect perimeter at fraction u of the walk from top-left. */
  function periPoint(bx, u) {
    const P = 2 * (bx.w + bx.h);
    let d = ((u % 1) + 1) % 1 * P;
    if (d <= bx.w) return { x: bx.x0 + d, y: bx.y0 };
    d -= bx.w;
    if (d <= bx.h) return { x: bx.x0 + bx.w, y: bx.y0 + d };
    d -= bx.h;
    if (d <= bx.w) return { x: bx.x0 + bx.w - d, y: bx.y0 + bx.h };
    d -= bx.w;
    return { x: bx.x0, y: bx.y0 + bx.h - d };
  }
  /** Fraction u of the perimeter point nearest to (x,y). */
  function periU(bx, x, y) {
    const cx = bx.x0 + bx.w / 2, cy = bx.y0 + bx.h / 2;
    const dx = x - cx, dy = y - cy;
    const t = Math.min(bx.w / 2 / Math.abs(dx || 1e-9), bx.h / 2 / Math.abs(dy || 1e-9));
    let px = cx + dx * t, py = cy + dy * t;
    px = Math.max(bx.x0, Math.min(bx.x0 + bx.w, px));
    py = Math.max(bx.y0, Math.min(bx.y0 + bx.h, py));
    const P = 2 * (bx.w + bx.h);
    if (Math.abs(py - bx.y0) < 0.01) return (px - bx.x0) / P;                    // top
    if (Math.abs(px - (bx.x0 + bx.w)) < 0.01) return (bx.w + (py - bx.y0)) / P;  // right
    if (Math.abs(py - (bx.y0 + bx.h)) < 0.01) return (bx.w + bx.h + (bx.x0 + bx.w - px)) / P; // bottom
    return (bx.w + bx.h + (bx.y0 + bx.h - py)) / P;                              // left
  }
  function portCenter(p) {
    if (p.t === "n") {
      const n = nodeById(p.id);
      return n ? { x: n.x, y: n.y } : null;
    }
    const it = itemById(p.id);
    return it ? { x: it.x + it.w / 2, y: it.y + itemSize(it).h / 2 } : null;
  }
  function portLabel(p) {
    if (p.t === "n") return p.id;
    const it = itemById(p.id);
    if (!it) return "?";
    if (it.type === "text") return (it.content || "").slice(0, 28) || "Текст";
    if (it.type === "image") {
      const c = String(it.content || "");
      if (!c.startsWith("data:") && c) {
        try {
          const u = new URL(c);
          const nm = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || u.hostname);
          if (nm) return nm.slice(0, 28);
        } catch { return c.slice(0, 28); }
      }
      return "Картинка";
    }
    return ITEM_LABEL[it.type] || "Блок";
  }

  // ---------------- persistence ----------------
  let boardTimer = null, posTimer = null;
  function scheduleSaveBoard() {
    clearTimeout(boardTimer);
    boardTimer = setTimeout(() => void flushBoard(), 600);
  }
  async function flushBoard() {
    if (!G.loaded) return;
    try {
      await invoke("save_board_items", { items: { items: G.items, links: G.links } });
    } catch (e) { toast("Борд не сохранён: " + e, "err"); }
  }
  function scheduleSavePositions() {
    clearTimeout(posTimer);
    posTimer = setTimeout(() => void flushPositions(), 400);
  }
  async function flushPositions() {
    if (!G.loaded) return;
    const pos = {};
    for (const n of G.nodes) pos[n.file] = { x: Math.round(n.x), y: Math.round(n.y) };
    try { await invoke("save_graph_positions", { positions: pos }); } catch {}
  }

  // ---------------- load ----------------
  async function loadData() {
    const data = await invoke("notes_graph");

    const nodes = [], byId = new Map();
    for (const nd of data.nodes || []) {
      const id = stripMd(nd.title);
      const n = { id, label: id, file: nd.file, x: 0, y: 0, vx: 0, vy: 0, deg: 0 };
      nodes.push(n);
      byId.set(id.toLowerCase(), n);
    }
    const edges = [];
    for (const [fa, fb] of data.edges || []) {
      const a = byId.get(stripMd(fa).toLowerCase());
      const b = byId.get(stripMd(fb).toLowerCase());
      if (a && b && a !== b) { a.deg++; b.deg++; edges.push({ a, b }); }
    }

    const saved = data.positions || {};
    const W = Math.max(stage ? stage.clientWidth : 800, 500);
    const H = Math.max(stage ? stage.clientHeight : 560, 360);
    const R = Math.min(W, H) * 0.34;
    let anySaved = false;
    nodes.forEach((n, i) => {
      const p = posMem.get(n.file) || saved[n.file];
      if (p && typeof p.x === "number" && typeof p.y === "number") { n.x = p.x; n.y = p.y; anySaved = true; }
      else {
        const ang = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
        n.x = R * Math.cos(ang) + (Math.random() - 0.5) * 24;
        n.y = R * Math.sin(ang) + (Math.random() - 0.5) * 24;
      }
    });

    let raw = data.items;
    for (let i = 0; i < 2 && typeof raw === "string"; i++) {
      try { raw = JSON.parse(raw); } catch { raw = null; break; }
    }
    let items = [], links = [];
    if (Array.isArray(raw)) items = raw;
    else if (raw && typeof raw === "object") {
      items = Array.isArray(raw.items) ? raw.items : [];
      links = Array.isArray(raw.links) ? raw.links : [];
    }
    items.forEach((it) => { if (!it.h) it.h = ITEM_H[it.type] ?? 150; });
    links = links.filter((l) =>
      (l.from.t === "n" ? byId.has(l.from.id) : true) &&
      (l.to.t === "n" ? byId.has(l.to.id) : true));
    let lkSeq = 0;
    // спред ПЕРВЫМ: сохранённый id (если был) не перетирается, отсутствующий —
    // генерируется. Иначе у линий нет id и удаление/выделение по "l:<id>" ломается.
    links = links.map((l) => ({ ...l, id: l.id || ("lk-" + Date.now().toString(36) + (lkSeq++)) }));
    sel.clear();

    G.nodes = nodes; G.edges = edges; G.items = items; G.links = links;
    G.loaded = true;
    return { hadSaved: anySaved || Object.keys(saved).length > 0 };
  }

  // ---------------- physics ----------------
  let physicsBypass = false; // «✨ Уложить» гоняет симуляцию даже при cfg.physics=false
  function physStep() {
    if ((!cfg.physics && !physicsBypass) || !G.nodes.length || !cfg.showNotes) { alpha = Math.max(alpha, 0); return false; }
    const a = alpha, nodes = G.nodes, n = nodes.length;

    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const q = nodes[j];
        let dx = p.x - q.x, dy = p.y - q.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        if (d2 > 90000) continue;
        const d = Math.sqrt(d2);
        const f = (3200 * a) / d2;
        p.vx += (dx / d) * f; p.vy += (dy / d) * f;
        q.vx -= (dx / d) * f; q.vy -= (dy / d) * f;
      }
    }
    for (const ed of G.edges) {
      const dx = ed.b.x - ed.a.x, dy = ed.b.y - ed.a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - 150) / d) * 0.08 * a;
      ed.a.vx += dx * f; ed.a.vy += dy * f;
      ed.b.vx -= dx * f; ed.b.vy -= dy * f;
    }
    for (const lk of G.links) {
      const np = lk.from.t === "n" ? lk.from : lk.to.t === "n" ? lk.to : null;
      if (!np) continue;
      const node = nodeById(np.id);
      const an = portCenter(np === lk.from ? lk.to : lk.from);
      if (!node || !an) continue;
      const dx = an.x - node.x, dy = an.y - node.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = ((d - 120) / d) * 0.04 * a;
      node.vx += dx * f; node.vy += dy * f;
    }
    let cx = 0, cy = 0;
    for (const p of nodes) { cx += p.x; cy += p.y; }
    cx /= n; cy /= n;
    for (const p of nodes) {
      p.vx += (cx - p.x) * 0.04 * a;
      p.vy += (cy - p.y) * 0.04 * a;
    }
    for (const p of nodes) {
      if (p === draggingNode) { p.vx = 0; p.vy = 0; continue; }
      p.vx *= 0.55; p.vy *= 0.55;
      p.x += Math.max(-10, Math.min(10, p.vx));
      p.y += Math.max(-10, Math.min(10, p.vy));
    }
    alpha += -alpha * 0.023;
    if (alpha < 0.02) {
      alpha = 0;
      physicsBypass = false; // разовая укладка завершилась
      void flushPositions();
      return false;
    }
    return true;
  }
  function reheat(a) {
    if (!cfg.physics && !physicsBypass) return; // физика выключена в ⚙
    if (G.nodes.length) alpha = Math.max(alpha, Math.min(1, a));
  }

  // ---------------- renderer ----------------
  function qCurve(x1, y1, x2, y2, bow) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const b = bow === undefined ? 0.14 : bow;
    return [x1, y1, mx + (-dy / d) * d * b, my + (dx / d) * d * b, x2, y2];
  }
  function curveDist(gm, wx, wy) {
    let best = Infinity, px = gm[0], py = gm[1];
    for (let i = 1; i <= 24; i++) {
      const t = i / 24, mt = 1 - t;
      const p = {
        x: mt * mt * gm[0] + 2 * mt * t * gm[2] + t * t * gm[4],
        y: mt * mt * gm[1] + 2 * mt * t * gm[3] + t * t * gm[5],
      };
      const dx = p.x - px, dy = p.y - py;
      const l2 = dx * dx + dy * dy || 1e-9;
      let tt = ((wx - px) * dx + (wy - py) * dy) / l2;
      tt = Math.max(0, Math.min(1, tt));
      const ex = wx - (px + dx * tt), ey = wy - (py + dy * tt);
      best = Math.min(best, Math.sqrt(ex * ex + ey * ey));
      px = p.x; py = p.y;
    }
    return best;
  }
  /** Distance from a point to a polyline (used for straight/ortho hit-testing). */
  function polyDist(pts, wx, wy) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const x1 = pts[i].x, y1 = pts[i].y, x2 = pts[i + 1].x, y2 = pts[i + 1].y;
      const dx = x2 - x1, dy = y2 - y1;
      const l2 = dx * dx + dy * dy || 1e-9;
      let t = ((wx - x1) * dx + (wy - y1) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      const ex = wx - (x1 + dx * t), ey = wy - (y1 + dy * t);
      best = Math.min(best, Math.hypot(ex, ey));
    }
    return best;
  }
  const portKey = (p) => p.t + ":" + p.id;
  /** Canonical (direction-independent) key for a link's endpoint pair. */
  function linkPairKey(lk) {
    const a = portKey(lk.from), b = portKey(lk.to);
    return a < b ? a + "|" + b : b + "|" + a;
  }
  /** Lateral spread offset (world px) for one link among others sharing the same pair. */
  function spreadOffset(lk) {
    if (!cfg.spreadParallel) return 0;
    const key = linkPairKey(lk);
    const group = G.links.filter((l) => linkPairKey(l) === key);
    if (group.length < 2) return 0;
    const idx = group.indexOf(lk);
    return (idx - (group.length - 1) / 2) * EDGE_SPACING;
  }

  /**
   * Geometry for one link, shaped by cfg.lineStyle:
   *  - "curve"/"straight": a quadratic bezier (a → cx,cy → b), optionally
   *    fanned sideways so parallel links between the same pair separate.
   *  - "ortho": a right-angled elbow polyline, points optionally snapped
   *    to the grid, exiting/entering shapes from their nearest cardinal side.
   */
  function linkGeom(lk) {
    const fc = portCenter(lk.from), tc = portCenter(lk.to);
    if (!fc || !tc) return null;

    if (cfg.lineStyle === "ortho") {
      const a = cardinalAnchor(lk.from, tc);
      const b = cardinalAnchor(lk.to, fc);
      if (!a || !b) return null;
      const off = spreadOffset(lk);
      const sideA = sideForPoint(lk.from, tc) || "r";
      const horizA = sideA === "l" || sideA === "r";
      let midX = snapV((a.x + b.x) / 2), midY = snapV((a.y + b.y) / 2);
      const pts = horizA
        ? [a, { x: midX + off, y: a.y }, { x: midX + off, y: b.y }, b]
        : [a, { x: a.x, y: midY + off }, { x: b.x, y: midY + off }, b];
      return { a, b, cx: pts[1].x, cy: pts[1].y, pts, style: "ortho" };
    }

    // lines run EDGE to EDGE, not center to center
// Made by MrDuck
    const a0 = anchorForPort(lk.from, tc);
    const b0 = anchorForPort(lk.to, fc);
    if (!a0 || !b0) return null;
    const dx0 = b0.x - a0.x, dy0 = b0.y - a0.y;
    const d0 = Math.sqrt(dx0 * dx0 + dy0 * dy0) || 1;
    const nx = -dy0 / d0, ny = dx0 / d0;
    const off = spreadOffset(lk);
    const a = { x: a0.x + nx * off, y: a0.y + ny * off };
    const b = { x: b0.x + nx * off, y: b0.y + ny * off };
    const bow = cfg.lineStyle === "straight" ? 0 : 0.14;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    return { a, b, cx: mx + (-dy / d) * d * bow, cy: my + (dx / d) * d * bow, style: cfg.lineStyle };
  }
  /** Distance from a world point to a link's rendered curve — for hover/pick. */
  function linkDist(lk, gm0, wx, wy) {
    if (gm0.style === "ortho") return polyDist(gm0.pts, wx, wy);
    return curveDist([gm0.a.x, gm0.a.y, gm0.cx, gm0.cy, gm0.b.x, gm0.b.y], wx, wy);
  }

  let wireScreen = null, wireTarget = null;

  function draw() {
    if (!ctx || !canvas) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CW, CH);
    refreshColors();
    const q = searchQ.trim().toLowerCase();
    const filtering = q.length > 0;
    const accent = CV["--accent"], danger = CV["--danger"], linkColor = CV["--link"] || accent;

    // hovered node → highlight its neighborhood, dim the rest (Obsidian-style)
    let hoverNodeId = null;
    if (hover && hover.t === "n" && !mode) hoverNodeId = hover.id;
    let neighborSet = null;
    if (hoverNodeId) {
      neighborSet = new Set([hoverNodeId]);
      for (const ed of G.edges) {
        if (ed.a.id === hoverNodeId) neighborSet.add(ed.b.id);
        else if (ed.b.id === hoverNodeId) neighborSet.add(ed.a.id);
      }
    }

    // coordinate grid (⚙ settings)
    if (cfg.grid) {
      const minorPx = GRID * view.zoom;
      const drawMinor = minorPx >= 10;
      ctx.lineWidth = 1;
      ctx.strokeStyle = CV["--stroke-strong"];
      const startX = Math.floor(view.x / GRID) * GRID;
      const startY = Math.floor(view.y / GRID) * GRID;
      for (let wx = startX; ; wx += GRID) {
        const sx = (wx - view.x) * view.zoom;
        if (sx > CW) break;
        if (sx >= -1) {
          const major = Math.round(wx / GRID) % 4 === 0;
          if (drawMinor || major) {
            ctx.globalAlpha = major ? 0.18 : 0.07;
            ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, CH); ctx.stroke();
          }
        }
      }
      for (let wy = startY; ; wy += GRID) {
        const sy = (wy - view.y) * view.zoom;
        if (sy > CH) break;
        if (sy >= -1) {
          const major = Math.round(wy / GRID) % 4 === 0;
          if (drawMinor || major) {
            ctx.globalAlpha = major ? 0.18 : 0.07;
            ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(CW, sy); ctx.stroke();
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    // note<->note edges — thin, colored like a wikilink, glow + highlight on hover
    if (cfg.showNotes) {
      for (const ed of G.edges) {
        const hot = !!(neighborSet && (ed.a.id === hoverNodeId || ed.b.id === hoverNodeId));
        const gm0 = linkGeom({ from: { t: "n", id: ed.a.id }, to: { t: "n", id: ed.b.id } });
        if (!gm0) continue;
        ctx.strokeStyle = hot ? accent : linkColor;
        ctx.lineWidth = hot ? 2.1 : 1.3;
        ctx.globalAlpha = filtering ? 0.2 : neighborSet ? (hot ? 0.95 : 0.08) : 0.5;
        ctx.beginPath();
        if (gm0.style === "ortho") {
          const pts = gm0.pts.map((p) => toScreen(p.x, p.y));
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        } else {
          const p1 = toScreen(gm0.a.x, gm0.a.y), pc = toScreen(gm0.cx, gm0.cy), p2 = toScreen(gm0.b.x, gm0.b.y);
          ctx.moveTo(p1.x, p1.y); ctx.quadraticCurveTo(pc.x, pc.y, p2.x, p2.y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // mixed links: skip endpoints hidden together with notes
    G.links.forEach((lk) => {
      if (!cfg.showNotes && (lk.from.t === "n" || lk.to.t === "n")) return;
      const gm0 = linkGeom(lk);
      if (!gm0) return;
      const isSel = sel.has("l:" + lk.id);
      const isHov = !isSel && hoverLinkId === lk.id;
      const strokePath = () => {
        ctx.beginPath();
        if (gm0.style === "ortho") {
          const pts = gm0.pts.map((p) => toScreen(p.x, p.y));
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        } else {
          const p1 = toScreen(gm0.a.x, gm0.a.y), pc = toScreen(gm0.cx, gm0.cy), p2 = toScreen(gm0.b.x, gm0.b.y);
          ctx.moveTo(p1.x, p1.y); ctx.quadraticCurveTo(pc.x, pc.y, p2.x, p2.y);
        }
        ctx.stroke();
      };
      ctx.strokeStyle = accent;
      ctx.globalAlpha = isSel ? 0.42 : isHov ? 0.3 : 0.18;
      ctx.lineWidth = isSel ? 9 : isHov ? 8 : 7;
      strokePath();
      ctx.globalAlpha = 1;
      ctx.lineWidth = isSel ? 3 : isHov ? 2.8 : 2.3;
      strokePath();
      const p1 = toScreen(gm0.a.x, gm0.a.y), p2 = toScreen(gm0.b.x, gm0.b.y);
      ctx.fillStyle = accent;
      for (const p of [p1, p2]) { ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2); ctx.fill(); }
      if (isSel) {
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        ctx.fillStyle = danger; ctx.font = "700 12px Segoe UI";
        ctx.textAlign = "center"; ctx.fillText("✕", mx, my - 8);
      }
    });

    // anchor dots on hovered shape (⚙ settings can disable)
    if (cfg.anchors && hover && !mode) {
      for (const sd of SIDES) {
        const m = sideMid(hover, sd);
        if (!m) continue;
        const sp = toScreen(m.x, m.y);
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = CV["--bg-2"]; ctx.fill();
        ctx.strokeStyle = accent; ctx.lineWidth = 1.6; ctx.stroke();
      }
    }

    // wire preview
    if (mode && mode.m === "wire" && wireScreen) {
      const f = anchorForPort(mode.from, { x: mode.wx, y: mode.wy });
      if (f) {
        const p1 = toScreen(f.x, f.y);
        ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(wireScreen.x, wireScreen.y); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // nodes — CARDS (rounded rect, заголовок внутри), hidden via ⚙ "Показывать заметки"
    const bg2 = CV["--bg-2"], dim = CV["--text-dim"];
    if (cfg.showNotes) {
      ctx.textAlign = "center";
      for (const n of G.nodes) {
        const b = nodeBox(n);
        const w = Math.round(b.w * view.zoom), h = Math.round(b.h * view.zoom);
        const p = toScreen(n.x, n.y);
        const x = Math.round(p.x - w / 2), y = Math.round(p.y - h / 2);
        const match = !filtering || n.label.toLowerCase().includes(q);
        const isSel = sel.has(selKey("n", n.id));
        const isWireTarget = !!(wireTarget && wireTarget.t === "n" && wireTarget.id === n.id);
        const isHoverNode = hoverNodeId === n.id;
        const isNeighbor = !!(neighborSet && neighborSet.has(n.id));
        const hot = isSel || isWireTarget || isHoverNode || (filtering && match);

        let baseAlpha = match ? 1 : 0.12;
        if (neighborSet && !isNeighbor) baseAlpha = Math.min(baseAlpha, 0.15);
        ctx.globalAlpha = baseAlpha;

        // мягкая подсветка под активной карточкой
        if (hot || isNeighbor) {
          ctx.fillStyle = accent;
          ctx.globalAlpha = (isHoverNode || isSel ? 0.20 : 0.12) * baseAlpha;
          rr(ctx, x - (isHoverNode || isSel ? 6 : 3), y - (isHoverNode || isSel ? 6 : 3),
            w + (isHoverNode || isSel ? 12 : 6), h + (isHoverNode || isSel ? 12 : 6), 11);
          ctx.fill();
          ctx.globalAlpha = baseAlpha;
        }

        // тело карточки
        rr(ctx, x, y, w, h, 9);
        ctx.fillStyle = bg2;
        ctx.fill();
        ctx.lineWidth = isSel ? 2.2 : 1.4;
        ctx.strokeStyle = hot || isSel ? accent : CV["--stroke-strong"];
        if (isSel) ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // заголовок ВНУТРИ карточки — всегда читается, ничего не теряется
        ctx.font = (hot ? "600 " : "400 ") + "12px Segoe UI, system-ui";
        ctx.textBaseline = "middle";
        ctx.fillStyle = hot ? text0() : dim;
        let label = n.label || "";
        while (label.length > 3 && ctx.measureText(label).width > w - NODE_PAD * view.zoom) {
          label = label.slice(0, -2) + "…"; // мягкое усечение длинных названий
        }
        ctx.fillText(label, p.x, p.y + 0.5);
        ctx.globalAlpha = 1;

        // ● точка связи на правом краю — тянуть от неё линию к блоку/заметке
        const dotS = { x: p.x + w / 2, y: p.y };
        ctx.beginPath(); ctx.arc(dotS.x, dotS.y, Math.max(3.4, 4.2 * view.zoom), 0, Math.PI * 2);
        ctx.fillStyle = bg2; ctx.fill();
        ctx.strokeStyle = hot ? accent : linkColor; ctx.lineWidth = 1.6; ctx.stroke();

        // always-visible tiny connectors (⚙)
        if (cfg.alwaysDots) {
          for (const sd of SIDES) {
            const m = sideMid({ t: "n", id: n.id }, sd);
            const sp = toScreen(m.x, m.y);
            ctx.beginPath(); ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = bg2; ctx.fill();
            ctx.strokeStyle = accent; ctx.lineWidth = 1.3; ctx.stroke();
          }
        }
      }
      ctx.textBaseline = "alphabetic";
    }

    // wire target outline for blocks
    if (wireTarget && wireTarget.t === "i") {
      const it = itemById(wireTarget.id);
      if (it) {
        const p = toScreen(it.x, it.y);
        const s = itemSize(it);
        ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(p.x - 3, p.y - 3, s.w * view.zoom + 6, s.h * view.zoom + 6);
        ctx.setLineDash([]);
      }
    }

    // selection outlines for blocks
    for (const it of G.items) {
      if (!sel.has(selKey("i", it.id))) continue;
      const p = toScreen(it.x, it.y);
      const s = itemSize(it);
      ctx.strokeStyle = accent; ctx.lineWidth = 1.8; ctx.setLineDash([5, 4]);
      ctx.strokeRect(p.x - 3, p.y - 3, s.w * view.zoom + 6, s.h * view.zoom + 6);
      ctx.setLineDash([]);
    }

    // marquee rectangle
    if (mode && mode.m === "marquee") {
      const a = toScreen(mode.ax, mode.ay), b = toScreen(mode.bx, mode.by);
      const rx = Math.min(a.x, b.x), ry = Math.min(a.y, b.y);
      const rw = Math.abs(b.x - a.x), rh = Math.abs(b.y - a.y);
      ctx.fillStyle = CV["--accent-soft"];
      ctx.globalAlpha = 0.55;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = accent; ctx.lineWidth = 1.4; ctx.setLineDash([5, 4]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }
  }

  function text0() { return CV["--text"]; }

  /** Rounded-rect path helper. */
  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ---------------- blocks DOM ----------------
  const clockTick = setInterval(() => {
    const now = new Date();
    document.querySelectorAll("[data-clock-time]").forEach((el) => {
      el.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    });
    document.querySelectorAll("[data-clock-date]").forEach((el) => {
      el.textContent = now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    });
  }, 15000);

  const ASSET_RE = /^(https?:\/\/asset\.localhost\/|asset:\/\/)/i;
  function needsHydration(src) {
    if (!src || src.startsWith("data:")) return false;
    if (/^https?:\/\//i.test(src)) return ASSET_RE.test(src);
    return true;
  }

  function markBroken(box, src, err) {
    box.innerHTML = "";
    const d = document.createElement("div");
    d.className = "bi-broken";
    d.textContent = "⚠ Не загрузилась: " + String(src).slice(0, 40) + (err ? " (" + err + ")" : "");
    d.onclick = async () => {
      const url = await prompt("Новый источник картинки:", "");
      if (url && url.trim()) { it0.content = url.trim(); renderBlocks(); scheduleSaveBoard(); }
    };
    box.appendChild(d);
  }
  let it0 = null; // target of the current broken handler

  function bodyFor(it) {
    const box = document.createElement("div");
    box.className = "bi-body";

    if (it.type === "text") {
      const t = document.createElement("div");
      t.className = "bi-text-body no-gesture";
      t.contentEditable = "true";
      t.innerText = it.content || "";
      t.addEventListener("blur", () => { it.content = t.innerText; scheduleSaveBoard(); });
      box.appendChild(t);
      return box;
    }

    if (it.type === "image") {
      const src = it.content || "";
      if (!src) {
        const ph = document.createElement("div");
        ph.className = "hint"; ph.style.padding = "6px 0";
        ph.textContent = "Картинка недоступна (пустой источник)";
        box.appendChild(ph); return box;
      }
      const img = document.createElement("img");
      img.className = "bi-img"; img.draggable = false;
      img.alt = "";
      const broken = () => {
        img.style.cssText += ";outline:2px solid var(--danger);min-height:56px;display:block;object-fit:contain;padding:6px";
        const cap = document.createElement("div");
        cap.className = "hint"; cap.style.color = "var(--danger)"; cap.style.fontSize = "10px";
        cap.textContent = "клик — заменить источник";
        cap.onclick = () => img.click();
        img.after(cap);
      };
      img.onclick = async () => {
        const url = await prompt("Новый источник картинки:", src.startsWith("data:") ? "" : "");
        if (url && url.trim()) { it.content = url.trim(); renderBlocks(); scheduleSaveBoard(); }
      };
      if (needsHydration(src)) {
        invoke("read_note_asset", { src })
          .then((d) => { img.src = d; })
          .catch((err) => { toast("Картинка: " + err, "err"); broken(); });
      } else {
        img.src = src;
        img.addEventListener("error", broken, { once: true });
      }
      box.appendChild(img);
      return box;
    }

    if (it.type === "clock") {
      const t = document.createElement("div"); t.className = "bi-clock-time"; t.dataset.clockTime = "1";
      const d = document.createElement("div"); d.className = "bi-clock-date"; d.dataset.clockDate = "1";
      const now = new Date();
      t.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      d.textContent = now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      box.append(t, d);
      return box;
    }

    if (it.type === "tasks") {
      const ul = document.createElement("ul");
      ul.className = "bi-tasks no-gesture";
      let tasks = [];
      try { tasks = JSON.parse(localStorage.getItem("apb-tasks") || "[]"); } catch {}
      tasks.slice(0, 6).forEach((t, i) => {
        const li = document.createElement("li");
        const cb = document.createElement("input");
        cb.type = "checkbox"; cb.checked = !!t.done;
        cb.onchange = () => { t.done = cb.checked; localStorage.setItem("apb-tasks", JSON.stringify(tasks)); };
        const tx = document.createElement("span"); tx.textContent = t.text;
        li.append(cb, tx); ul.appendChild(li);
      });
      if (!tasks.length) { const li = document.createElement("li"); li.textContent = "Пока пусто"; ul.appendChild(li); }
      box.appendChild(ul);
      return box;
    }

    if (it.type === "calendar") {
      const wrapCal = document.createElement("div");
      wrapCal.className = "no-gesture";
      let off = 0;
      const holder = document.createElement("div");
      const nav = document.createElement("div");
      nav.style.cssText = "display:flex;gap:6px;margin-top:6px";
      const prevB = document.createElement("button"); prevB.className = "ghost-btn small"; prevB.textContent = "‹";
      const title = document.createElement("span"); title.style.flex = "1"; title.style.textAlign = "center"; title.style.fontSize = "11px";
      const nextB = document.createElement("button"); nextB.className = "ghost-btn small"; nextB.textContent = "›";
      nav.append(prevB, title, nextB);
      const redraw = () => {
        const node = buildCalNode(off);
        holder.innerHTML = ""; holder.appendChild(node);
        title.textContent = node.dataset.title || "";
      };
      prevB.onclick = () => { off--; redraw(); };
      nextB.onclick = () => { off++; redraw(); };
      redraw();
      wrapCal.append(holder, nav);
      box.appendChild(wrapCal);
      return box;
    }

    if (it.type === "weather") {
      let cfg = null;
      try { cfg = JSON.parse(localStorage.getItem("apb-weather") || "null"); } catch {}
      if (cfg && cfg.data) { renderWeatherInto(box, cfg); }
      else {
        const h = document.createElement("span"); h.className = "hint";
        h.textContent = "Настройте погоду на главной — здесь будет кэш.";
        box.appendChild(h);
      }
      return box;
    }

    return box;
  }

  function ensureBlockEl(it) {
    let el = blockEls.get(it.id);
    if (el) return el;
    el = document.createElement("div");
    el.className = "board-item";
    el.dataset.id = it.id;
    const head = document.createElement("div");
    head.className = "bi-head";
    const gh = document.createElement("span");
    gh.className = "bi-ghandle gh-dot"; gh.title = "Тянуть связь"; gh.textContent = "●";
    const bl = document.createElement("span"); bl.className = "bl";
    bl.textContent = ITEM_LABEL[it.type] || it.type;
    const x = document.createElement("button"); x.className = "bi-x"; x.textContent = "✕"; x.title = "Удалить блок";
    x.onclick = (ev) => { ev.stopPropagation(); removeItem(it.id); };
    head.append(gh, bl, x);
    const body = bodyFor(it);
    const rz = document.createElement("div"); rz.className = "bi-resize"; rz.title = "Размер";
    rz.addEventListener("pointerdown", (e) => {
      e.stopPropagation(); e.preventDefault();
      rz.setPointerCapture(e.pointerId);
      const w0 = it.w, h0 = it.h ?? ITEM_H[it.type] ?? 150;
      const sx = e.clientX, sy = e.clientY;
      const mv = (ev) => {
        it.w = Math.max(140, Math.round(w0 + ev.clientX - sx));
        it.h = Math.max(60, Math.round(h0 + ev.clientY - sy));
      };
      const up2 = () => {
        rz.removeEventListener("pointermove", mv);
        rz.removeEventListener("pointerup", up2);
        if ((it.w !== w0 || it.h !== h0)) {
          pushOp({ t: "size", id: it.id, w0, h0, w1: it.w, h1: it.h });
        }
        scheduleSaveBoard();
      };
      rz.addEventListener("pointermove", mv);
      rz.addEventListener("pointerup", up2);
    });
    el.append(head, body, rz);
    blockEls.set(it.id, el);
    blockLayer.appendChild(el);
    return el;
  }

// Made by MrDuck
  function renderBlocks() {
    if (!blockLayer) return;
    blockLayer.innerHTML = "";
    blockEls.clear();
    for (const it of G.items) ensureBlockEl(it);
    syncBlocks();
  }

  function syncBlocks() {
    for (const it of G.items) {
      const el = blockEls.get(it.id);
      if (!el) continue;
      const p = toScreen(it.x, it.y);
      const s = itemSize(it);
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${view.zoom.toFixed(4)})`;
      el.style.width = s.w + "px";
      el.style.height = s.h + "px";
    }
  }

  function removeItem(id) {
    const victim = itemById(id);
    if (!victim) return;
    pushOp({
      t: "del",
      items: [snapItem(victim)],
      links: G.links.filter((l) => l.from.id === id || l.to.id === id).map(snapLink),
    });
    G.items = G.items.filter((x) => x.id !== id);
    G.links = G.links.filter((l) => l.from.id !== id && l.to.id !== id);
    sel.delete(selKey("i", id));
    renderBlocks();
    scheduleSaveBoard();
  }

  // ---------------- hit-test ----------------
  function hitTest(wx, wy) {
    if (cfg.showNotes) {
      for (let i = G.nodes.length - 1; i >= 0; i--) {
        const n = G.nodes[i];
        const b = nodeBox(n);
        // вся карточка = зона захвата (+2px по периметру для комфорта)
        if (wx >= n.x - b.w / 2 - 2 && wx <= n.x + b.w / 2 + 2 &&
            wy >= n.y - b.h / 2 - 2 && wy <= n.y + b.h / 2 + 2) return { kind: "node", node: n };
      }
    }
    for (let i = G.items.length - 1; i >= 0; i--) {
      const it = G.items[i];
      const s = itemSize(it);
      if (wx >= it.x && wx <= it.x + s.w && wy >= it.y && wy <= it.y + s.h) return { kind: "item", item: it };
    }
    return null;
  }

  // ---------------- gestures ----------------
  let mode = null;
  let lastRmbTap = null; // последний ЧИСТЫЙ ПКМ-клик: { t, x, y, k }
  const RMB_DBL_MS = 400, RMB_DBL_PX = 12;
  /** Двойной ПКМ? k — что кликнули ('empty' | 'node:<id>'), должен совпасть. */
  function rmbDouble(s, k) {
    if (!lastRmbTap || lastRmbTap.k !== k) return false;
    return (performance.now() - lastRmbTap.t < RMB_DBL_MS) &&
      Math.hypot(s.x - lastRmbTap.x, s.y - lastRmbTap.y) < RMB_DBL_PX;
  }
  let pressedEmpty = null;
  let hover = null; // {t,id} of shape under cursor (for anchor dots)
  let hoverLinkId = null; // id of the link curve under cursor (for click-to-select affordance)

  /** Find the link whose curve passes closest to a world point, within a pick radius. */
  function linkNear(wx, wy) {
    let foundId = null, best = 10 / view.zoom;
    for (const lk of G.links) {
      const gm0 = linkGeom(lk);
      if (!gm0) continue;
      const d = linkDist(lk, gm0, wx, wy);
      if (d < best) { best = d; foundId = lk.id; }
    }
    return foundId;
  }

  function localXY(e) {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function samePort(a, b) { return a.t === b.t && a.id === b.id; }
  function portOf(hit) {
    return hit.kind === "node" ? { t: "n", id: hit.node.id } : { t: "i", id: hit.item.id };
  }

  function onDown(e) {
    hideMenus();
    const el = e.target instanceof HTMLElement ? e.target : null;
    if (el && (el.closest(".bi-x") || el.closest(".no-gesture"))) return;

    const s = localXY(e);
    const w = toWorld(s.x, s.y);
    const hit = hitTest(w.x, w.y);

    // MMB anywhere = pan
    if (e.button === 1) {
      mode = { m: "pan", sx: s.x, sy: s.y, vx: view.x, vy: view.y, moved: 0 };
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // RMB on a shape = wire from that shape
    if (e.button === 2 && hit) {
      mode = { m: "wire", from: portOf(hit), wx: w.x, wy: w.y, moved: 0 };
      wireScreen = s;
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    // RMB on empty = pan; меню создания — ТОЛЬКО по двойному ПКМ (см. onUp)
    if (e.button === 2) {
      mode = { m: "pan", sx: s.x, sy: s.y, vx: view.x, vy: view.y, rmb: true, moved: 0 };
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }

    if (e.button !== 0) return;

    // LMB on one of the side anchor dots = wire from THAT side
    if (hit && cfg.anchors) {
      const base = portOf(hit);
      for (const sd of SIDES) {
        const m = sideMid(base, sd);
        if (!m) continue;
        const sp = toScreen(m.x, m.y);
        if (Math.hypot(sp.x - s.x, sp.y - s.y) <= 9) {
          mode = { m: "wire", from: { t: base.t, id: base.id, side: sd }, wx: w.x, wy: w.y, moved: 0 };
          wireScreen = s;
          stage.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
        }
      }
    }

    // LMB empty = Windows-style marquee selection
    if (!hit) {
      mode = { m: "marquee", ax: w.x, ay: w.y, bx: w.x, by: w.y, moved: 0 };
      stage.setPointerCapture(e.pointerId);
      return;
    }

    // node: ● точка на правом краю = провод; иначе ЛКМ = move/open
    if (hit.kind === "node") {
      const n = hit.node;
      const b = nodeBox(n);
      const dotS = toScreen(n.x + b.w / 2, n.y); // центр правого края
      if (Math.hypot(s.x - dotS.x, s.y - dotS.y) <= Math.max(9, 5 * view.zoom)) {
        startFreeWire(hit, w, s, e);
        return;
      }
      const k = selKey("n", n.id);
      const members = sel.has(k)
        ? [...sel].map(groupResolve).filter(Boolean)
        : [n];
      mode = {
        m: "dragNode", node: n,
        gx: w.x, gy: w.y, moved: 0, heated: false,
        group: members.map((o) => ({ o, x0: o.x, y0: o.y })),
      };
      draggingNode = n;
      stage.setPointerCapture(e.pointerId);
      return;
    }

    // block: header = move · ANY other point = free wire from that exact spot
    const it = hit.item;
    const inHeader = w.y - it.y <= 24;
    if (inHeader && !(el && el.closest(".gh-dot"))) {
      const k = selKey("i", it.id);
      const members = sel.has(k)
        ? [...sel].map(groupResolve).filter(Boolean)
        : [it];
      mode = {
        m: "dragItem", item: it,
        gx: w.x, gy: w.y, moved: 0,
        group: members.map((o) => ({ o, x0: o.x, y0: o.y })),
      };
      stage.setPointerCapture(e.pointerId);
    } else {
      // gh-dot or block body → wire anchored at the exact press point
      startFreeWire(hit, w, s, e);
    }
  }

  /** Start a wire anchored at the exact perimeter point under the cursor. */
  function startFreeWire(hit, w, s, e) {
    const base = portOf(hit);
    const bx = boxFor(base);
    mode = { m: "wire", from: { t: base.t, id: base.id, u: periU(bx, w.x, w.y) }, wx: w.x, wy: w.y, moved: 0 };
    wireScreen = s;
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  /** Resolve a selection key back to the live shape object. */
  function groupResolve(k) {
    const t = k.slice(0, 1), id = k.slice(2);
    return t === "n" ? nodeById(id) : itemById(id);
  }

  function onMove(e) {
    if (!mode) {
      const hs = localXY(e);
      const hw = toWorld(hs.x, hs.y);
      const h = hitTest(hw.x, hw.y);
      hover = h ? { t: h.kind === "node" ? "n" : "i", id: h.kind === "node" ? h.node.id : h.item.id } : null;
      hoverLinkId = h ? null : linkNear(hw.x, hw.y);
      stage.style.cursor = h ? "pointer" : hoverLinkId ? "pointer" : "grab";
      return;
    }
    const s = localXY(e);
    if (mode.m === "pan") {
      mode.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      view.x = mode.vx - (s.x - mode.sx) / view.zoom;
      view.y = mode.vy - (s.y - mode.sy) / view.zoom;
    } else if (mode.m === "marquee") {
      mode.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      const w = toWorld(s.x, s.y);
      mode.bx = w.x; mode.by = w.y;
    } else if (mode.m === "dragNode" || mode.m === "dragItem") {
      mode.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      const w = toWorld(s.x, s.y);
      const dx = w.x - mode.gx, dy = w.y - mode.gy;
      for (const g of mode.group) {
        g.o.x = Math.round(snapV(g.x0 + dx));
        g.o.y = Math.round(snapV(g.y0 + dy));
      }
      if (!mode.heated && mode.moved > 4 && mode.m === "dragNode") { mode.heated = true; reheat(0.2); }
    } else if (mode.m === "wire") {
      mode.moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
      const w = toWorld(s.x, s.y);
      mode.wx = w.x; mode.wy = w.y;
      wireScreen = s;
      const hit = hitTest(w.x, w.y);
      wireTarget = hit && !samePort(portOf(hit), mode.from) ? portOf(hit) : null;
    }
  }

  async function onUp(e) {
    if (!mode) return;
    const s = localXY(e);
    const m = mode;

    if (m.m === "wire") {
      const wasDrag = m.moved > 6;
      mode = null; wireScreen = null;
      const target = wireTarget; wireTarget = null;
      const w = toWorld(s.x, s.y);
      const hit = hitTest(w.x, w.y);
      let t2 = target || (hit && !samePort(portOf(hit), m.from) ? portOf(hit) : null);
      // wire started from a pinned side dot → pin the drop side too
      if (t2 && m.from.side) t2 = { t: t2.t, id: t2.id, side: sideForPoint(t2, w) };
      if (t2) { await createLink(m.from, t2); lastRmbTap = null; }
      else if (e.button === 2 && !wasDrag && m.from.t === "n") {
        // чистый ПКМ по узлу: одиночный — ничего, ДВОЙНОЙ — меню узла
        const k = "node:" + m.from.id;
        if (rmbDouble(s, k)) { lastRmbTap = null; nodeMenuAt(e.clientX, e.clientY, m.from.id); }
        else lastRmbTap = { t: performance.now(), x: s.x, y: s.y, k };
      }
      return;
    }

    if (m.m === "dragNode") {
      mode = null; draggingNode = null;
      if (m.moved < 6 && e.button === 0 && m.group.length === 1) openNote(m.node.file);
      else {
        if (m.moved >= 6 || m.group.length > 1) {
          pushOp({ t: "move", ents: m.group.map((g) => ({
            k: "n", id: g.o.id, x0: g.x0, y0: g.y0, x1: g.o.x, y1: g.o.y,
          })) });
        }
        void flushPositions();
      }
      return;
    }

    if (m.m === "dragItem") {
      mode = null;
      if (m.moved >= 1) {
        pushOp({ t: "move", ents: m.group.map((g) => ({
          k: "i", id: g.o.id, x0: g.x0, y0: g.y0, x1: g.o.x, y1: g.o.y,
        })) });
        scheduleSaveBoard();
      }
      return;
    }

    // marquee finalize — Windows-style selection
    if (m.m === "marquee") {
      mode = null;
      if (m.moved < 5) {
        // clean click on empty space: drop selection, allow link picking
        sel.clear();
        pickLink(s);
        return;
      }
      const x1 = Math.min(m.ax, m.bx), x2 = Math.max(m.ax, m.bx);
      const y1 = Math.min(m.ay, m.by), y2 = Math.max(m.ay, m.by);
      sel.clear();
      if (cfg.showNotes) {
        for (const n of G.nodes) {
          const b = nodeBox(n);
          if (n.x + b.w / 2 >= x1 && n.x - b.w / 2 <= x2 && n.y + b.h / 2 >= y1 && n.y - b.h / 2 <= y2)
            sel.add(selKey("n", n.id));
        }
      }
      for (const it of G.items) {
        const sz = itemSize(it);
        if (it.x + sz.w >= x1 && it.x <= x2 && it.y + sz.h >= y1 && it.y <= y2)
          sel.add(selKey("i", it.id));
      }
      // lines get selected too — by their midpoint
      for (const lk of G.links) {
        const gm0 = linkGeom(lk);
        if (!gm0) continue;
        const mx = (gm0.a.x + gm0.b.x) / 2, my = (gm0.a.y + gm0.b.y) / 2;
        if (mx >= x1 && mx <= x2 && my >= y1 && my <= y2) sel.add("l:" + lk.id);
      }
      if (sel.size) toast(`Выбрано: ${sel.size} — тяните вместе, Del удаляет блоки`);
      return;
    }

    if (m.m === "pan") {
      mode = null;
      if (m.rmb && m.moved <= 6) {
        // чистый ПКМ по пустому месту: одиночный = просто перемещение (ничего
        // не открываем), ДВОЙНОЙ = меню создания блока/заметки
        const w = toWorld(s.x, s.y);
        if (rmbDouble(s, "empty")) { lastRmbTap = null; createMenuAt(e.clientX, e.clientY, w.x, w.y); }
        else lastRmbTap = { t: performance.now(), x: s.x, y: s.y, k: "empty" };
      }
    }
  }

  function pickLink(s) {
    const w = toWorld(s.x, s.y);
    let foundId = null;
    for (const lk of G.links) {
      const gm0 = linkGeom(lk);
      if (!gm0) continue;
      if (linkDist(lk, gm0, w.x, w.y) < 10 / view.zoom) { foundId = lk.id; break; }
    }
    if (!foundId) { sel.clear(); return; }
    const key = "l:" + foundId;
    if (sel.has(key)) {
      const victim = findLink(foundId);
      if (victim) pushOp({ t: "del", items: [], links: [snapLink(victim)] });
      G.links = G.links.filter((l) => l.id !== foundId);
      sel.delete(key);
      scheduleSaveBoard();
      toast("Связь удалена");
    } else {
      sel.add(key);
      toast("Линия выбрана — Del удаляет, клик ещё раз тоже");
    }
  }

  // ---------------- link create ----------------
  let lkGen = 0;
  const newLinkId = () => "lk-" + Date.now().toString(36) + "-" + (++lkGen) + Math.random().toString(36).slice(2, 5);
  async function createLink(from, to) {
    if (samePort(from, to)) return;
    const dupLink = G.links.some((l) =>
      (samePort(l.from, from) && samePort(l.to, to)) ||
      (samePort(l.from, to) && samePort(l.to, from)));
    if (from.t === "n" && to.t === "n") {
      const dupEdge = G.edges.some((ed) =>
        (ed.a.id === from.id && ed.b.id === to.id) || (ed.a.id === to.id && ed.b.id === from.id));
      if (dupEdge) { toast("Такая связь уже есть"); return; }
    }
    if (dupLink) { toast("Такая связь уже есть"); return; }
    try {
      const noteSide = from.t === "n" ? from : to.t === "n" ? to : null;
      if (noteSide) {
        const other = noteSide === from ? to : from;
        const note = nodeById(noteSide.id);
        const label = portLabel(other);
        if (note) {
          const content = await invoke("read_note", { path: note.file });
          if (!content.includes(`[[${label}]]`)) {
            await invoke("create_note", {
              path: note.file,
              content: content.replace(/\s*$/, "") + `\n\n[[${label}]]\n`,
            });
            await invoke("notes_reindex");
          }
        }
      }
      if (from.t === "n" && to.t === "n") {
        const a = nodeById(from.id), b = nodeById(to.id);
        if (a && b) { a.deg++; b.deg++; G.edges.push({ a, b }); }
      } else {
        // id обязателен: выделение/удаление линий идёт по "l:<id>"
        const created = { id: newLinkId(), from, to };
        G.links.push(created);
        pushOp({ t: "add", items: [], links: [snapLink(created)] });
        scheduleSaveBoard();
      }
      reheat(0.3);
      toast("Связь создана ✓", "ok");
    } catch (err) { toast("Не удалось создать связь: " + err, "err"); }
  }

  // ---------------- undo / redo ----------------
  // Операции: move (узлы/блоки), size, add, del. Заметки-файлы не трогаем —
  // undo только для визуальных сущностей поля.
  const undoStack = [], redoStack = [];
  const UNDO_LIMIT = 120;
  const snapItem = (it) => JSON.parse(JSON.stringify(it));
  const snapLink = (l) => ({ id: l.id, from: { ...l.from }, to: { ...l.to } });
  function pushOp(op) {
    undoStack.push(op);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }
  function findLink(id) { return G.links.find((l) => l.id === id); }
  function restoreItems(items) {
    let added = false;
    for (const s of items) if (!itemById(s.id)) { G.items.push(snapItem(s)); added = true; }
    if (added) renderBlocks();
  }
  function dropItems(items) {
    const ids = new Set(items.map((i) => i.id));
    G.items = G.items.filter((i) => !ids.has(i.id));
  }
  function restoreLinks(links) {
    for (const s of links) if (!findLink(s.id)) G.links.push(snapLink(s));
  }
  function dropLinks(links) {
    const ids = new Set(links.map((l) => l.id));
    G.links = G.links.filter((l) => !ids.has(l.id));
  }
  /** redo=true → повторить действие; false → откатить */
// Made by MrDuck
  function applyOp(op, redo) {
    switch (op.t) {
      case "move":
        for (const en of op.ents) {
          const o = en.k === "n" ? nodeById(en.id) : itemById(en.id);
          if (!o) continue;
          o.x = redo ? en.x1 : en.x0;
          o.y = redo ? en.y1 : en.y0;
        }
        break;
      case "size": {
        const o = itemById(op.id);
        if (o) { o.w = redo ? op.w1 : op.w0; o.h = redo ? op.h1 : op.h0; }
        break;
      }
      case "add":
        redo ? (restoreItems(op.items), restoreLinks(op.links))
             : (dropItems(op.items), dropLinks(op.links));
        break;
      case "del":
        redo ? (dropItems(op.items), dropLinks(op.links))
             : (restoreItems(op.items), restoreLinks(op.links));
        break;
      default: return false;
    }
    sel.clear();
    renderBlocks(); syncBlocks();
    scheduleSaveBoard();
    if (op.t === "move") scheduleSavePositions();
    return true;
  }
  function undoGraph() {
    const op = undoStack.pop();
    if (!op) { toast("Нечего отменять"); return; }
    if (applyOp(op, false)) { redoStack.push(op); toast("Отменено"); }
  }
  function redoGraph() {
    const op = redoStack.pop();
    if (!op) { toast("Нечего возвращать"); return; }
    if (applyOp(op, true)) { undoStack.push(op); toast("Возвращено"); }
  }

  // ---------------- menus ----------------
  function hideMenus() {
    document.querySelectorAll(".graph-menu").forEach((m) => m.remove());
    GS.hide(); // поповер настроек — своя книга учёта
  }
  // Совместимость: sitefx-ctxmenu-find.js зовёт hideGraphMenu() при каждом
  // правом клике по браузеру. После рерайта графа функции не стало —
  // получали ReferenceError и меню браузера умирало. Оставляем глобальный шим.
  window.hideGraphMenu = function () { hideMenus(); };
  function menuAt(cx, cy, html, onpick) {
    hideMenus();
    const m = document.createElement("div");
    m.className = "graph-menu";
    m.innerHTML = html;
    m.style.left = Math.min(cx, window.innerWidth - 240) + "px";
    m.style.top = Math.min(cy, window.innerHeight - 320) + "px";
    m.addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      hideMenus();
      onpick(b.dataset.c);
    });
    document.body.appendChild(m);
  }

  function createMenuAt(cx, cy, wx, wy) {
    const items = [
      ["note", "📝 Заметку"], ["text", "🅣 Блок текста"],
      ["imgfile", "🖼 Картинку с компьютера"], ["image", "🌐 Картинку по URL"],
      ["notetext", "📄 Текст из заметки"], ["noteimgs", "🏞 Картинки из заметки"],
      ["clock", "🕐 Часы"], ["tasks", "☑ Задачи"],
      ["calendar", "📅 Календарь"], ["weather", "🌤 Погода"],
    ];
    menuAt(cx, cy,
      items.map(([c, t]) => `<button data-c="${c}">${t}</button>`).join(""),
      (kind) => void actCreate(kind, wx, wy));
  }

  function nodeMenuAt(cx, cy, nodeId) {
    menuAt(cx, cy,
      `<button data-c="open">Открыть заметку</button>
       <button data-c="toboard">🅣 Текст на борд</button>
       <button data-c="unlink">Убрать связи узла</button>
       <button data-c="delete" style="color:var(--danger)">🗑 Удалить заметку</button>`,
      async (act) => {
        const node = nodeById(nodeId);
        if (!node) return;
        if (act === "open") { openNote(node.file); return; }
        if (act === "toboard") {
          try {
            const content = await invoke("read_note", { path: node.file });
            const plain = content.replace(/^#.*$/gm, "").trim().slice(0, 4000) || "(заметка пустая)";
            await addBlock("text", node.x + 40, node.y + 40, plain);
          } catch (err) { toast("Ошибка: " + err, "err"); }
          return;
        }
        if (act === "unlink") {
          try {
            const content = await invoke("read_note", { path: node.file });
            const cleaned = content.split("\n").filter((l) => !/\[\[[^\]]+\]\]/.test(l)).join("\n");
            await invoke("create_note", { path: node.file, content: cleaned });
            await invoke("notes_reindex");
            await reloadGraphData();
          } catch (err) { toast("Ошибка: " + err, "err"); }
          return;
        }
        if (act === "delete") {
          if (!(await confirm(`Удалить заметку «${node.label}»? Действие необратимо.`))) return;
          try {
            await invoke("note_delete", { path: node.file });
            posMem.delete(node.file);
            await reloadGraphData();
          } catch (err) { toast("Ошибка удаления: " + err, "err"); }
        }
      });
  }

  // ---------------- blocks: create ----------------
  let blockSeq = 0;
  function addBlock(type, wx, wy, content) {
    const it = {
      id: "bi-" + Date.now().toString(36) + (++blockSeq),
      type, x: Math.round(wx), y: Math.round(wy),
      w: type === "image" ? 280 : 220,
      content,
    };
    G.items.push(it);
    pushOp({ t: "add", items: [snapItem(it)], links: [] });
    ensureBlockEl(it);
    syncBlocks();
    scheduleSaveBoard();
    return it;
  }

  async function addFromNote(kind, wx, wy) {
    const notes = await invoke("list_notes").catch(() => []);
    const name = await prompt(
      "Имя файла заметки:" + (notes.length ? `\n\nНапример: ${notes[notes.length - 1]}` : ""),
      notes.length ? notes[notes.length - 1] : "",
    );
    if (!name || !name.trim()) return;
    const file = name.trim().endsWith(".md") ? name.trim() : name.trim() + ".md";
    let content = "";
    try { content = await invoke("read_note", { path: file }); }
    catch { toast("Заметка не найдена: " + file, "err"); return; }
    if (kind === "notetext") {
      const plain = content.replace(/^#.*$/gm, "").trim().slice(0, 4000) || "(заметка пустая)";
      addBlock("text", wx, wy, plain);
      return;
    }
    const urls = [...content.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((mm) => mm[1]);
    if (!urls.length) { toast("В заметке нет картинок"); return; }
    const created = [];
    urls.forEach((u, i) => {
      const it = {
        id: "bi-" + Date.now().toString(36) + i, type: "image",
        x: Math.round(wx) + i * 24, y: Math.round(wy) + i * 24,
        w: 260, h: ITEM_H.image, content: u,
      };
      G.items.push(it); ensureBlockEl(it); created.push(it);
    });
    if (created.length) pushOp({ t: "add", items: created.map(snapItem), links: [] });
    syncBlocks(); scheduleSaveBoard();
  }

  async function actCreate(kind, wx, wy) {
    if (kind === "note") {
      const name = await prompt("Название новой заметки:", "");
      if (!name || !name.trim()) return;
      const clean = name.trim().replace(/[\\/:*?"<>|]/g, "-");
      const file = clean.endsWith(".md") ? clean : clean + ".md";
      try {
        await invoke("create_note", { path: file, content: `# ${clean}\n\n` });
        posMem.set(file, { x: Math.round(wx), y: Math.round(wy) });
        await reloadGraphData();
        reheat(0.35);
        void flushPositions();
      } catch (err) { toast("Ошибка: " + err, "err"); }
      return;
    }
    if (kind === "text") { addBlock("text", wx, wy, "Текст блока…"); return; }
    if (kind === "clock") { addBlock("clock", wx, wy); return; }
    if (kind === "tasks") { addBlock("tasks", wx, wy); return; }
    if (kind === "calendar") { addBlock("calendar", wx, wy); return; }
    if (kind === "weather") { addBlock("weather", wx, wy); return; }
    if (kind === "imgfile") {
      const inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*"; inp.style.display = "none";
      document.body.appendChild(inp);
      inp.onchange = async () => {
        const f = inp.files && inp.files[0];
        inp.remove();
        if (!f) return;
        try {
          toast("Обрабатываю картинку…");
          const dataUrl = await fileToDataUrl(f);
          addBlock("image", wx, wy, dataUrl);
          toast("Картинка добавлена ✓", "ok");
        } catch (err) { alert("Не удалось прочитать картинку: " + (err?.message || err)); }
      };
      inp.click();
      return;
    }
    if (kind === "image") {
      const url = await prompt("URL картинки или GIF:", "https://");
      if (!url || !url.trim() || url.trim() === "https://") return;
      addBlock("image", wx, wy, url.trim());
      return;
    }
    if (kind === "notetext" || kind === "noteimgs") { await addFromNote(kind, wx, wy); }
  }

  function fileToDataUrl(file) {
    // GIF и SVG — НАПРЯМУЮ как data:URL: канвас-растеризация для GIF
    // убивала анимацию, а для SVG ломалась (нет width/height у корня,
    // прозрачный фон чернился при JPEG-кодировании).
    if (file.type === "image/gif" || file.type === "image/svg+xml" ||
        /\.svg$/i.test(file.name)) {
      return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result); r.onerror = rej;
        r.readAsDataURL(file);
      });
    }
    return new Promise((res, rej) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => { img.src = reader.result; };
      img.onload = () => {
        const maxW = 1200;
        const scale = Math.min(1, maxW / img.naturalWidth);
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        try { res(c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.87)); }
        catch (e) { rej(e); }
      };
      img.onerror = rej;
      reader.readAsDataURL(file);
    });
  }

  // ---------------- dom init / loop ----------------
  let rafId = 0;
  let lastStats = "";
  let viewInitialized = false;

  function etabHidden() {
    const el = document.getElementById("etabGraph");
    return !el || el.classList.contains("hidden");
  }

  function resizeCanvas() {
    if (!stage || !canvas) return;
    dpr = window.devicePixelRatio || 1;
    CW = stage.clientWidth; CH = stage.clientHeight;
    canvas.width = Math.round(CW * dpr);
    canvas.height = Math.round(CH * dpr);
  }

  function fitAll() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of G.nodes) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x); maxY = Math.max(maxY, n.y);
    }
    for (const it of G.items) {
      const s = itemSize(it);
      minX = Math.min(minX, it.x); minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + s.w); maxY = Math.max(maxY, it.y + s.h);
    }
    if (!isFinite(minX)) return;
    const pad = 80;
    const bw = maxX - minX + pad * 2, bh = maxY - minY + pad * 2;
    const z = Math.min((CW || 800) / bw, (CH || 600) / bh, 1.4);
    view.zoom = z;
    view.x = (minX + maxX) / 2 - CW / (2 * z);
    view.y = (minY + maxY) / 2 - CH / (2 * z);
  }

  function startLoop() {
    if (rafId) return;
    const tick = () => {
      if (!stage || etabHidden()) { rafId = 0; return; }
      refreshColors();
      if (alpha > 0) physStep();
      draw();
      syncBlocks();
      const st = `${G.nodes.length} заметок · ${G.edges.length} связей · ${G.links.length} линий`;
      if (st !== lastStats) {
        lastStats = st;
        const el = document.getElementById("graphStats");
        if (el) el.textContent = st;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  function ensureDom() {
    if (stage) return;
    stage = document.getElementById("graphStage");
    canvas = document.getElementById("graphCanvas");
    blockLayer = document.getElementById("blockLayer");
    if (!stage || !canvas) return;
    ctx = canvas.getContext("2d");

    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", () => { mode = null; draggingNode = null; wireScreen = null; wireTarget = null; });
    stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const s = localXY(e);
      zoomAt(s.x, s.y, e.deltaY > 0 ? 1 / 1.12 : 1.12);
    }, { passive: false });
    stage.addEventListener("dblclick", (e) => {
      const w = toWorld(localXY(e).x, localXY(e).y);
      if (hitTest(w.x, w.y)) return;
      void actCreate("note", w.x, w.y);
    });
    stage.addEventListener("contextmenu", (e) => {
      // меню НЕ здесь: одиночный ПКМ = перемещение, двойной = меню (onUp).
      // stopPropagation — чтобы sitefx не показал своё общее меню поверх.
      e.preventDefault();
      e.stopPropagation();
    });

    const ro = new ResizeObserver(() => resizeCanvas());
    ro.observe(stage);
    window.addEventListener("resize", resizeCanvas);
    stage.addEventListener("pointerleave", () => { if (!mode) { hover = null; hoverLinkId = null; stage.style.cursor = "grab"; } });

    // settings popover (⚙) — живёт в js/graph/graph-settings.js
    document.getElementById("graphCfg").addEventListener("click", (e) => {
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      GS.toggleAt(r.left, r.bottom + 6);
    });
    // ❓ Панель подсказки по жестам графа
    const ghPanel = document.getElementById("graphHelp");
    document.getElementById("graphHelpBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      if (ghPanel) ghPanel.classList.toggle("hidden");
    });
    document.getElementById("graphHelpClose")?.addEventListener("click", () => {
      if (ghPanel) ghPanel.classList.add("hidden");
    });
    // ⬇ PNG-экспорт полотна графа в Загрузки.
    // #graphCanvas рисует узлы/рёбра/провода — DOM-блоки (#blockLayer
    // .board-item) в toDataURL не попадают. «Как скрин»: каждый блок
    // клонируется, стили инлайнятся из getComputedStyle (в SVG-картинке
    // внешние CSS не работают), и вся сборка сериализуется в
    // <svg><foreignObject> → Image → drawImage на копию канваса.
    // data:-картинки (из заметок) рендерятся настоящими; внешние http(s)
    // внутри SVG-картинки не загружаются вовсе — вместо них рамка-заглушка.
    // ВЛОЖЕННЫЕ data:image/svg+xml Chromium внутри SVG-картинки тоже не
    // грузит (SVG-as-image: под-ресурсы ограничены) — растрируем их в PNG
    // заранее (svgToPngDataUrl); если не растрировалось — рамка-заглушка.
    // Чекбоксы задач заменяются на глифы ☑/☐: form-controls в SVG-картинке
    // не надёжны. UI-мусор (✕, ресайз, точка-ручка) со скрина убирается.
    const imgPlaceholder = (src) => {
      const ph = document.createElement("div");
      ph.textContent = "🖼 " + (String(src).slice(0, 60) || "картинка");
      ph.style.cssText = "padding:8px 10px;font-size:12px;border:1px dashed #8a8f98;border-radius:8px;color:#a6a6b0;min-height:60px;box-sizing:border-box;margin:8px;";
      return ph;
    };
    // ГРАБЛЯ 30 (x3): снапшот блоков в SVG-картинку.
    // 1) В Chromium getComputedStyle().cssText для computed-стилей = ""
    //    (пустая строка) — стили переносим перебором свойств.
    // 2) Position-свойства (left/top/right/bottom/inset/transform…)
    //    НЕ копируем: CSSOM сливает их в шорткат `inset`, который при
    //    репарсинге SVG-картинки применяется только правым/нижним краем
    //    (left/top вырождаются в auto) — блоки уезжают на исходные
    //    позиции и дублируют transform. Позицию задаём явно longhand-ами.
    // 3) backdrop-filter в статичной картинке всё равно не работает.
    const SNAP_SKIP = new Set([
      "position", "left", "top", "right", "bottom", "inset",
      "transform", "translate", "rotate", "scale", "backdrop-filter"
    ]);
    function snapshotStyleText(el) {
      const cs = getComputedStyle(el);
      const out = [];
      for (let i = 0; i < cs.length; i++) {
        const p = cs.item(i);
        if (!p || p.startsWith("--") || SNAP_SKIP.has(p)) continue;
        const v = cs.getPropertyValue(p);
        if (v) out.push(p + ":" + v + ";");
      }
      return out.join("");
    }
    function svgToPngDataUrl(src, fw, fh) {
      return new Promise((res) => {
        const im = new Image();
        im.onload = () => {
          const w = im.naturalWidth || fw || 300;
          const h = im.naturalHeight || fh || 200;
          const sc = Math.min(1, 1200 / Math.max(w, h));
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(w * sc));
          c.height = Math.max(1, Math.round(h * sc));
          try {
            c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
            res(c.toDataURL("image/png"));
          } catch { res(null); }
        };
        im.onerror = () => res(null);
        im.src = src;
      });
    }
    // stripAll: режим-страховка — ВСЕ картинки в заглушки (второй заход,
    // если первый снапшот не отрисовался вообще).
    async function snapshotBlocksSvg(stripAll = false) {
      const dpr2 = dpr || 1;
      // wrap обязан иметь ЯВНЫЕ размеры: все клоны absolute → без height
      // wrap = 0px, и содержимое клипается в ноль («видны только линии»).
      // Клиппинг делает внешний xhtml-div (у него есть width/height).
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:relative;width:" + CW + "px;height:" + CH + "px;";
      const svgImgs = [];
      for (const it of G.items) {
        const el = blockEls.get(it.id);
        if (!el) continue;
        const clone = el.cloneNode(true);
        // 1) переносим ВЫЧИСЛЕННЫЕ стили каждого элемента (порядок веток
        //    одинаковый у оригинала и клона — пока ничего не заменяли)
        const srcEls = [el, ...el.querySelectorAll("*")];
        const dstEls = [clone, ...clone.querySelectorAll("*")];
        for (let i = 0; i < srcEls.length && i < dstEls.length; i++) {
          try { dstEls[i].setAttribute("style", snapshotStyleText(srcEls[i])); } catch {}
        }
        // 2) позиция/масштаб — те же, что в syncBlocks
        const p = toScreen(it.x, it.y);
        const s = itemSize(it);
        clone.style.position = "absolute";
        clone.style.left = "0";
        clone.style.top = "0";
        clone.style.width = s.w + "px";
        clone.style.height = s.h + "px";
        clone.style.transformOrigin = "0 0";
        clone.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${view.zoom.toFixed(4)})`;
        // 3) замены, меняющие структуру (после копирования стилей)
        clone.querySelectorAll(".bi-x, .bi-resize, .bi-ghandle").forEach((n) => n.remove());
        clone.querySelectorAll("input[type=checkbox]").forEach((cb) => {
          const sp = document.createElement("span");
          sp.textContent = cb.checked ? "☑" : "☐";
          sp.style.cssText = "font-size:14px;line-height:1;margin-right:7px;color:var(--accent,#7fb0ff);display:inline-block;";
          cb.replaceWith(sp);
        });
        clone.querySelectorAll("img").forEach((im) => {
          const src = im.getAttribute("src") || "";
          const isData = src.startsWith("data:");
          if (!isData || stripAll) { im.replaceWith(imgPlaceholder(src)); return; }
          if (src.startsWith("data:image/svg+xml")) svgImgs.push({ im, w: s.w, h: s.h });
        });
        // contentEditable не нужен в статичной картинке
        clone.querySelectorAll("[contenteditable]").forEach((n) => n.removeAttribute("contenteditable"));
        wrap.appendChild(clone);
      }
      if (!wrap.children.length) return null;
      // Вложенные SVG-картинки: растрировать в PNG ДО сериализации
      if (svgImgs.length) {
        await Promise.all(svgImgs.map(async ({ im, w, h }) => {
          const png = await svgToPngDataUrl(im.getAttribute("src"), w, h);
          if (png) im.setAttribute("src", png);
          else im.replaceWith(imgPlaceholder("SVG"));
        }));
      }
      // SVG рендерится в dpr-размере, потом drawImage кладёт его 1:1 в
      // устройство-пиксели → скрин не мылится на HiDPI.
      // Сериализация — XMLSerializer: SVG-картинка парсится как XML, и
      // HTML-вывод innerHTML (<img>/<br> без самозакрытия) ломает весь
      // документ на parse error (вот почему экспорт падал даже без картинок,
      // если в текст-блоке был перенос). XMLSerializer выдаёт валидный
      // XHTML: <img/>, <br/>, экранированные атрибуты.
      const inner =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(CW * dpr2)}" height="${Math.round(CH * dpr2)}">` +
        `<foreignObject x="0" y="0" width="${Math.round(CW * dpr2)}" height="${Math.round(CH * dpr2)}">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${CW}px;height:${CH}px;overflow:hidden;transform-origin:0 0;transform:scale(${dpr2});">` +
        new XMLSerializer().serializeToString(wrap) +
        `</div></foreignObject></svg>`;
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(inner);
    }

    document.getElementById("graphExportPng")?.addEventListener("click", async () => {
      try {
        const cv = document.getElementById("graphCanvas");
        const out = document.createElement("canvas");
        out.width = cv.width; out.height = cv.height;
        const c2 = out.getContext("2d");
        c2.drawImage(cv, 0, 0);
        const loadSvgImg = (url) => new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = () => rej(new Error("не удалось отрисовать блоки (SVG-снапшот)"));
          img.src = url;
        });
        let svgUrl = await snapshotBlocksSvg();
        if (svgUrl) {
          let blocksImg = null;
          try {
            blocksImg = await loadSvgImg(svgUrl);
          } catch {
            // Страховка 1: не собрались блоки — повтор без картинок.
            svgUrl = await snapshotBlocksSvg(true);
            try {
              blocksImg = await loadSvgImg(svgUrl);
            } catch {
              // Страховка 2: совсем не собирается (экзотический контент
              // блоков) — сохраняем чистый канвас, не валим экспорт.
              blocksImg = null;
            }
          }
          if (blocksImg) {
            c2.setTransform(dpr, 0, 0, dpr, 0, 0);
            c2.drawImage(blocksImg, 0, 0, CW, CH);
          }
        }
        const data = out.toDataURL("image/png").split(",")[1];
        const p = await invoke("save_image_file", { name: "graph.png", dataBase64: data });
        toast("Граф сохранён: " + p, "ok");
      } catch (err) {
        toast("Экспорт не удался: " + err, "err");
      }
    });
    document.addEventListener("pointerdown", (e) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (!t || (!t.closest(".graph-menu") && !t.closest("#graphCfg"))) hideMenus();
      if (ghPanel && (!t || (!t.closest("#graphHelp") && !t.closest("#graphHelpBtn")))) {
        ghPanel.classList.add("hidden");
      }
    });

    // Delete removes selected BLOCKS (notes are files — never auto-deleted);
    // Escape clears the selection. Тост честный: считает реально удалённое.
    window.addEventListener("keydown", (e) => {
      if (etabHidden()) return;
      const a = document.activeElement;
      if (a && (a.isContentEditable || a.tagName === "INPUT" || a.tagName === "TEXTAREA")) return;
      // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — undo/redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redoGraph(); else undoGraph();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault(); redoGraph(); return;
      }
      if (e.key === "Delete" && sel.size) {
        const itemIds = [...sel].filter((k) => k.startsWith("i:")).map((k) => k.slice(2));
        const linkIds = [...sel].filter((k) => k.startsWith("l:")).map((k) => k.slice(2));
        const beforeItems = G.items.length, beforeLinks = G.links.length;
        // снимок ДО удаления — для undo
        const snapItems = G.items.filter((it) => itemIds.includes(it.id)).map(snapItem);
        const snapLinksMap = new Map();
        for (const l of G.links) {
          const doomed =
            (l.from.t === "i" && itemIds.includes(l.from.id)) ||
            (l.to.t === "i" && itemIds.includes(l.to.id)) ||
            linkIds.includes(String(l.id));
          if (doomed) snapLinksMap.set(l.id ?? JSON.stringify([l.from, l.to]), l);
        }
        if (itemIds.length) {
          G.items = G.items.filter((it) => !itemIds.includes(it.id));
          G.links = G.links.filter((l) =>
            !((l.from.t === "i" && itemIds.includes(l.from.id)) || (l.to.t === "i" && itemIds.includes(l.to.id))));
        }
        if (linkIds.length) {
          // String(): защита от рассинхрона типов id в старых сохранениях
          G.links = G.links.filter((l) => !linkIds.includes(String(l.id)));
        }
        const rmItems = beforeItems - G.items.length;
        const rmLinks = beforeLinks - G.links.length;
        selClear();
        renderBlocks();
        scheduleSaveBoard();
        if (rmItems + rmLinks) {
          pushOp({ t: "del", items: snapItems, links: [...snapLinksMap.values()].map(snapLink) });
          toast(`Удалено: блоки ${rmItems} · линии ${rmLinks}`);
        } else {
          toast("Ничего не удалено — выделение устарело, кликни по линии заново");
        }
      } else if (e.key === "Escape") {
        sel.clear();
      }
    });

    document.getElementById("graphReload").addEventListener("click", () => void reloadGraphData());
    document.getElementById("graphUndo").addEventListener("click", () => undoGraph());
    document.getElementById("graphRedo").addEventListener("click", () => redoGraph());
    document.getElementById("graphLayout").addEventListener("click", () => {
      // разовая укладка физикой — работает даже при выключенной ⚙-физике
      physicsBypass = true;
      reheat(1);
    });
    document.getElementById("gzIn").addEventListener("click", () => zoomAt(CW / 2, CH / 2, 1.3));
    document.getElementById("gzOut").addEventListener("click", () => zoomAt(CW / 2, CH / 2, 1 / 1.3));
    document.getElementById("gzFit").addEventListener("click", fitAll);
    document.getElementById("boardClear").addEventListener("click", async () => {
      if (!G.items.length && !G.links.length) { toast("Поле и так пустое"); return; }
      if (!clearArmed) {
        clearArmed = true;
        toast("Клик ещё раз — убрать все блоки и связи");
        setTimeout(() => (clearArmed = false), 3000);
        return;
      }
      clearArmed = false;
      G.items = []; G.links = []; sel.clear();
      renderBlocks();
      await flushBoard();
      toast("Поле очищено ✓", "ok");
    });
    const searchEl = document.getElementById("graphSearch");
    searchEl.addEventListener("input", () => { searchQ = searchEl.value; });
    searchEl.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { searchQ = ""; searchEl.value = ""; }
      else if (e.key === "Enter" && searchQ.trim()) {
        const q = searchQ.trim().toLowerCase();
        const hit = G.nodes.find((n) => n.label.toLowerCase().includes(q));
        if (hit) openNote(hit.file); else toast("Ничего не найдено");
      }
    });

    resizeCanvas();
  }

  // ---------------- global entry points ----------------
  window.reloadGraphData = async function reloadGraphData() {
    ensureDom();
    if (!stage) return;
    const { hadSaved } = await loadData();
    renderBlocks();
    reheat(0.15);
    if (!viewInitialized || !hadSaved) { fitAll(); viewInitialized = true; }
    startLoop();
  };

  window.flushGraphSaves = function flushGraphSaves() {
    void flushBoard();
    void flushPositions();
  };
  window.addEventListener("beforeunload", () => window.flushGraphSaves());
  document.addEventListener("visibilitychange", () => { if (document.hidden) window.flushGraphSaves(); });
})();

// Made by MrDuck