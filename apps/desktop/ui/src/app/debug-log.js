// Made by MrDuck
// ============================================================
// ui/js/core/debug-log.js — DEBUG-ЛОГГЕР (только debug-сборки!)
//
// Подключение: НЕ через index.html. Бэкенд вшивает текст файла в бинарник
// (include_str!, см. main.rs DEBUG_FRONTEND_JS) и инжектит его как
// initialization_script окна shell — он выполняется ДО любого скрипта
// документа. В release-сборке этого кода в бинарнике нет вообще
// (cfg(debug_assertions) в cmd/debug.rs + main.rs).
//
// Ловит и складывает в файл всё, что нужно для посмертного анализа:
//   · необработанные ошибки JS (window error) + стеки
//   · unhandled promise rejections
//   · console.error / console.warn
//   · упавшие и медленные invoke-команды (обёртка ставится ДО того,
//     как boot-core захватит ссылку на invoke; как init-скрипт мы можем
//     стартовать раньше появления window.__TAURI__ — тогда повтор на
//     DOMContentLoaded)
//   · жизненный цикл графа (reloadGraphData / flushGraphSaves)
//
// Буфер в памяти → сброс каждые 2с / при скрытии окна / перед выгрузкой
// через команду debug_log_append →
// workspace/logs/shell-debug.log (ротация ~2 МБ → .old).
// Наружу: window.__apbLog(level, msg), window.__apbDump().
// ============================================================
(function () {
  "use strict";
  if (window.__apbLog) return; // защита от двойной загрузки

  const MAX_BUF = 600;
  const SLOW_MS = 800;
  const buf = [];
  let dirty = false;

  const ts = () => new Date().toISOString();
  const clean = (s) => String(s).replace(/\r/g, "");

  function push(level, msg) {
    buf.push(`[${ts()}] ${level} ${clean(msg ?? "")}`);
    if (buf.length > MAX_BUF) buf.splice(0, buf.length - MAX_BUF);
    dirty = true;
  }

  window.__apbLog = (level, msg) => push(String(level || "INFO").toUpperCase(), msg);
  window.__apbDump = () => buf.slice();

  function fmtErr(err) {
    if (!err) return "(empty error)";
    const st = err && err.stack ? "\n" + String(err.stack).split("\n").slice(0, 6).join("\n") : "";
    return (err.message || err.reason || String(err)) + st;
  }

  // ---------------- глобальные ловушки ----------------
  window.addEventListener("error", (e) => {
    push("ERROR", `window.onerror: ${e.message} @ ${e.filename || "?"}:${e.lineno}:${e.colno}` +
      (e.error && e.error.stack ? "\n" + String(e.error.stack).split("\n").slice(0, 6).join("\n") : ""));
  });
  window.addEventListener("unhandledrejection", (e) => {
    push("ERROR", "unhandledrejection: " + fmtErr(e.reason));
  });

  ["error", "warn"].forEach((level) => {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      try {
        push(level.toUpperCase(), args.map((a) =>
          typeof a === "string" ? a : (a instanceof Error ? fmtErr(a) : JSON.stringify(a))
        ).join(" "));
      } catch { /* форматирование не должно ронять приложение */ }
      orig(...args);
    };
  });

  // ---------------- invoke-обёртка ----------------
  // Как initialization_script мы стартуем до скриптов документа: глобала
  // __TAURI__ может ещё не быть. Оборачивание — в функцию с повтором на
  // DOMContentLoaded (до этого момента boot-core уже захватит invoke —
  // тогда упавшие invoke просто не логируются, это деградация, не поломка).
  // __TAURI__.core.invoke может быть read-only — пробуем каскад:
  //   1) прямая замена свойства  2) defineProperty на core
  //   3) подмена всего объекта core клоном с нашей обёрткой
  function tryWrapInvoke() {
    try {
      const tauri = window.__TAURI__;
      const orig = tauri && tauri.core && tauri.core.invoke;
      if (typeof orig !== "function") {
        push("WARN", "__TAURI__.core.invoke ещё нет — повтор на DOMContentLoaded");
        return false;
      }
      if (orig.__apbWrapped) return true; // уже обёрнут (двойная загрузка)
      const wrapped = async function (cmd, args) {
        const t0 = performance.now();
        try {
          const res = await orig(cmd, args);
          const dt = performance.now() - t0;
          if (dt > SLOW_MS) push("WARN", `invoke(${cmd}) медленная: ${Math.round(dt)}ms`);
          return res;
        } catch (err) {
          push("ERROR", `invoke(${cmd}) упал: ${err}` +
            (args ? `\n  args: ${JSON.stringify(args).slice(0, 400)}` : ""));
          throw err;
        }
      };
      wrapped.__apbWrapped = true;

      let ok = false;
      try { tauri.core.invoke = wrapped; ok = tauri.core.invoke === wrapped; } catch { ok = false; }
      if (!ok) {
        try {
          Object.defineProperty(tauri.core, "invoke", {
            value: wrapped, writable: true, configurable: true, enumerable: true,
          });
          ok = tauri.core.invoke === wrapped;
        } catch { ok = false; }
      }
      if (!ok && tauri.core && typeof tauri.core === "object") {
        try {
          const clone = Object.assign({}, tauri.core, { invoke: wrapped });
          Object.defineProperty(tauri, "core", {
            value: clone, writable: true, configurable: true, enumerable: true,
          });
          ok = tauri.core.invoke === wrapped;
        } catch { ok = false; }
      }
      push(ok ? "INFO" : "WARN",
        ok ? "invoke обёрнут логгером" : "invoke обернуть НЕ удалось — упавшие invoke не логируются");
      return ok;
    } catch (e) {
      push("ERROR", "не удалось обернуть invoke: " + e);
      return false;
    }
  }
  if (!tryWrapInvoke()) {
    document.addEventListener("DOMContentLoaded", () => { tryWrapInvoke(); });
  }

  // ---------------- жизненный цикл графа ----------------
  document.addEventListener("DOMContentLoaded", () => {
    push("INFO", `shell загружен: ${navigator.userAgent}`);
    const rg = window.reloadGraphData;
    if (typeof rg === "function" && !rg.__apbWrapped) {
      const w = async function () {
        const t0 = performance.now();
        try {
          const r = await rg.apply(this, arguments);
          push("INFO", `reloadGraphData ok за ${Math.round(performance.now() - t0)}ms`);
          return r;
        } catch (err) {
          push("ERROR", "reloadGraphData упал: " + fmtErr(err));
          throw err;
        }
      };
      w.__apbWrapped = true;
      window.reloadGraphData = w;
    }
    const fg = window.flushGraphSaves;
    if (typeof fg === "function" && !fg.__apbWrapped) {
      const w2 = async function () {
        try { return await fg.apply(this, arguments); }
        catch (err) { push("ERROR", "flushGraphSaves упал: " + fmtErr(err)); throw err; }
      };
      w2.__apbWrapped = true;
      window.flushGraphSaves = w2;
    }
  });

  // ---------------- сброс в файл ----------------
  async function flush() {
    if (!dirty || !buf.length) return;
    const batch = buf.splice(0, buf.length);
    dirty = false;
    try {
      const inv = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
      await inv("debug_log_append", { lines: batch }); // напрямую, без нашей обёртки-логгера
    } catch (err) {
      // не логируем провал логгера в сам логгер — вернём строки в буфер
      buf.unshift(...batch.slice(-100));
      dirty = true;
      console.debug("debug-log flush failed:", err);
    }
  }

  setInterval(() => void flush(), 2000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) void flush(); });
  window.addEventListener("beforeunload", () => void flush());
  window.addEventListener("pagehide", () => void flush());

  push("INFO", "debug-log инициализирован");
})();

// Made by MrDuck