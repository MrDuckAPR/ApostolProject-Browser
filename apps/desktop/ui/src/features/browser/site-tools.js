// Made by MrDuck
// ---------------------------------------------------------------------
// Custom right-click menu for the shell GUI (replaces the native one).
// The graph canvas keeps its own specialized menus.
// ---------------------------------------------------------------------

// Нативное меню поверх наших меню графа: контекстменю второго ПКМ
// таргетится уже в ОТКРЫВШЕЕСЯ .graph-menu (оно под курсором), до stage
// не доходит и никто не делает preventDefault. Гасим на захвате.
document.addEventListener("contextmenu", (e) => {
  const t = e.target instanceof HTMLElement ? e.target : null;
  if (t && t.closest(".graph-menu")) {
    e.preventDefault();
    e.stopPropagation();
  }
}, true);

document.addEventListener("contextmenu", (e) => {
  if (e.target.closest("#graphStage") || e.target.closest(".graph-menu")) return; // own menus
  e.preventDefault();
  showShellMenu(e.clientX, e.clientY, e.target);
});

function ctxItem(label, fn, danger = false) {
  return { label, fn, danger };
}
function showShellMenu(x, y, target) {
  hideGraphMenu();
  const items = [];
  const pill = target.closest?.(".tab-pill");
  const rail = target.closest?.(".rail-item");
  if (pill) {
    // пилюли хранят ссылку на объект вкладки (renderTabStrip ставит _tabRef)
    const tab = pill._tabRef ||
      tabs.find((t) => t.id === activeTabId) ||
      tabs.find((t) => t.label === pill.querySelector(".tab-pill-title")?.textContent);
    if (tab) {
      items.push(ctxItem("🔄 Обновить", () => invokeV2("page_navigate", { id: tab.id, url: tab.url }).catch(() => {})));
      const inSplit = window.__apbSplitPair &&
        (tab.id === window.__apbSplitPair.left || tab.id === window.__apbSplitPair.right);
      if (inSplit) {
        items.push(ctxItem("⬓ Выйти из разделения", () => window.apbSplitExit(tab.id)));
      } else if (!tab.isNew && !tab.asleep && tab.url && tab.id !== activeTabId) {
        items.push(ctxItem("⬓ Разделить экран (сплит)", () => window.apbSplitWith(tab.id)));
      }
      items.push(ctxItem("📄 Дублировать", () => createTab(tab.url, null, { background: true })));
      items.push(ctxItem("✕ Закрыть вкладку", () => closeTab(tab.id), true));
      items.push(ctxItem("🧹 Закрыть остальные", () => {
        for (const t of [...tabs]) if (t.id !== tab.id) closeTab(t.id);
      }, true));
    }
  }
  if (rail && rail.dataset.tab && rail.dataset.tab !== "ai") {
    items.push(ctxItem("Открыть панель", () => rail.click()));
  }

  // ---- Воркспейс ----
  const wsPill = target.closest?.(".ws-pill");
  if (wsPill && wsPill.dataset.i !== undefined && typeof wsDoc !== "undefined" && wsDoc) {
    const wi = Number(wsPill.dataset.i);
    const w = (wsDoc.list || [])[wi];
    if (w) {
      if (wi !== wsDoc.current) items.push(ctxItem("Переключиться", () => switchWs(wi)));
      items.push(ctxItem("✎ Переименовать", async () => {
        const nn = await prompt("Имя воркспейса:", w.name);
        if (!nn || !nn.trim()) return;
        w.name = nn.trim();
        await saveWs();
        renderWsPills();
      }));
      items.push(ctxItem("⧉ Дублировать", async () => {
        const copy = { name: w.name + " (копия)", tabs: [...(w.tabs || [])], active: w.active ?? 0 };
        wsDoc.list.splice(wi + 1, 0, copy);
        await saveWs();
        renderWsPills();
        toast("Воркспейс продублирован");
      }));
      if ((wsDoc.list || []).length > 1) {
        items.push({ separator: true });
        items.push(ctxItem("🗑 Удалить воркспейс", () => deleteWs(wi), true));
      }
    }
  }

  // ---- Профиль ----
// Made by MrDuck
  const profLi = target.closest?.("#profilesList li");
  if (profLi && profLi.dataset.id) {
    const pid = profLi.dataset.id;
    const pname = profLi.dataset.name || pid;
    const isActive = profLi.classList.contains("active-profile");
    if (isActive) {
      items.push(ctxItem("⚙ Настройки профиля", () => openInternal("settings")));
    } else {
      items.push(ctxItem("↪ Переключиться на «" + pname + "»", async () => {
        await invoke("switch_profile", { id: pid });
        await loadProfiles();
        await refreshSidePanels();
      }));
    }
    items.push(ctxItem("✎ Переименовать профиль", async () => {
      const nn = await prompt("Новое имя профиля:", pname);
      if (!nn || !nn.trim() || nn.trim() === pname) return;
      try {
        await invoke("rename_profile", { id: pid, name: nn.trim() });
        await loadProfiles();
        toast("Профиль переименован");
      } catch (err) { alert("Ошибка: " + err); }
    }));
    items.push({ separator: true });
    items.push(ctxItem("🗑 Удалить профиль и все его данные", async () => {
      if (!(await confirm(`Удалить профиль «${pname}» со ВСЕМИ заметками, историей и настройками? Действие необратимо.`))) return;
      try {
        await invoke("delete_profile", { id: pid });
        await loadProfiles();
        await refreshSidePanels();
        toast("Профиль удалён");
      } catch (err) { alert("Ошибка: " + err); }
    }, true));
  }

  // ---- Заметка ----
  const noteLi = target.closest?.("#notesList li");
  if (noteLi && noteLi.dataset.file) {
    const file = noteLi.dataset.file;
    const base = file.replace(/\.md$/, "");
    items.push(ctxItem("Открыть заметку", () => openNote(file)));
    items.push(ctxItem("✎ Переименовать", async () => {
      const nn = await prompt("Новое имя (можно Папка/Имя):", base);
      if (!nn || !nn.trim()) return;
      // Слэш разрешён (папки), остальное санитизируем по сегментам; '..' запрещён
      const clean = nn.trim().replace(/^\/+|\/+$/g, "").split("/")
        .map((seg) => seg.replace(/[\\:*?"<>|]/g, "-").trim())
        .filter(Boolean).join("/");
      if (clean.includes("..")) return;
      const nf = clean.endsWith(".md") ? clean : clean + ".md";
      if (nf === file) return;
      try {
        const content = await invoke("read_note", { path: file });
        await invoke("create_note", { path: nf, content });
        await invoke("note_delete", { path: file });
        await refreshNotes();
        toast("Заметка переименована");
      } catch (err) { alert("Ошибка: " + err); }
    }));
    items.push(ctxItem("⧉ Дублировать", async () => {
      try {
        const content = await invoke("read_note", { path: file });
        let copy = base + " (копия).md";
        let k2 = 2;
        while ((await invoke("list_notes")).includes(copy)) copy = base + ` (копия ${k2++}).md`;
        await invoke("create_note", { path: copy, content });
        await refreshNotes();
        toast("Создана копия");
      } catch (err) { alert("Ошибка: " + err); }
    }));
    items.push({ separator: true });
    items.push(ctxItem("⬇ Экспорт .md", async () => {
      try {
        const content = await invoke("read_note", { path: file });
        const fname = base.replace(/\//g, "_") + ".md";
        const p = await invoke("save_text_file", { name: fname, contents: content });
        toast("Сохранено: " + p, "ok");
      } catch (err) { alert("Ошибка экспорта: " + err); }
    }));
    items.push(ctxItem("🗑 Удалить заметку", async () => {
      if (!(await confirm(`Удалить заметку «${base}»? Действие необратимо.`))) return;
      try {
        await invoke("note_delete", { path: file });
        await refreshNotes();
        toast("Заметка удалена");
      } catch (err) { alert("Ошибка: " + err); }
    }, true));
  }
  if (!items.length) {
    if (currentTabObj()) {
      items.push(ctxItem("⟳ Обновить страницу", () => document.getElementById("navReload").click()));
      items.push(ctxItem("← Назад", () => jumpHistory(-1)));
      items.push(ctxItem("→ Вперёд", () => jumpHistory(1)));
      items.push({ separator: true });
    } else {
      items.push(ctxItem("🏠 Главная страница", () => { activeTabId = null; showHome(); renderTabStrip(); }));
    }
    items.push(ctxItem("＋ Новая вкладка", () => document.getElementById("newTabBtn").click()));
    items.push(ctxItem("⚙ Настройки", () => openInternal("settings")));
  }
// Made by MrDuck
  APBPopup.menu(items, x, y);
}
// Reuse the same clamping for every popup menu
// Made by MrDuck
function placeMenuSafe(m, x, y) {
  document.body.appendChild(m);
  requestAnimationFrame(() => {
    const tabVisible = !!currentTabObj();
    const br = document.getElementById("browserView").getBoundingClientRect();
    const mw = m.offsetWidth || 220, mh = m.offsetHeight || 160;
    let nx = Math.min(x, window.innerWidth - mw - 10);
    let ny = Math.min(y, window.innerHeight - mh - 10);
    if (tabVisible && nx < br.right && nx + mw > br.left && ny < br.bottom && ny + mh > br.top) {
      if (br.left - mw - 6 > 0) nx = Math.max(4, br.left - mw - 6);
      else ny = Math.max(4, br.top - mh - 6);
    }
    m.style.left = nx + "px";
    m.style.top = ny + "px";
  });
}

// ---------------------------------------------------------------------
// Find in page (Ctrl+F) — injects a self-contained find bar INTO the
// active page webview (shell cannot reach across origins).
// ---------------------------------------------------------------------

const FIND_JS = [
  "(function(){",
  "if(window.__APB_FIND__){window.__APB_FIND__.open();return;}",
  "var S={q:'',i:0,hits:[]};",
  "var css=document.createElement('style');",
  "css.textContent='.apb-hl{background:#ffe066;color:#111;border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.08)}.apb-hl.cur{background:#ff9642;color:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.12),0 2px 10px rgba(255,150,66,.5)}"
    + "@keyframes apbf-in{from{opacity:0;transform:translateY(-16px) scale(.96)}}"
    + "#apb-findbar{position:fixed;top:14px;right:20px;z-index:2147483647;display:flex;gap:6px;align-items:center;"
    + "background:rgba(15,15,21,.78);backdrop-filter:blur(20px) saturate(150%);-webkit-backdrop-filter:blur(20px) saturate(150%);"
    + "color:#ececf1;border:1px solid rgba(127,176,255,.30);border-radius:999px;padding:8px 8px 8px 14px;"
    + "font:12.5px system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.5),0 0 0 1px rgba(127,176,255,.10),inset 0 1px 0 rgba(255,255,255,.07);"
    + "animation:apbf-in .3s cubic-bezier(.34,1.56,.64,1) both}"
    + "#apb-findbar .ico{font-size:13px;opacity:.9;color:#7fb0ff;margin-right:2px}"
    + "#apb-findbar input{width:200px;background:none;border:none;outline:none;color:#f2f2f4;font:inherit;caret-color:#7fb0ff;transition:width .25s cubic-bezier(.22,1,.36,1)}"
    + "#apb-findbar input:focus{width:260px}"
    + "#apb-findbar input::placeholder{color:#77778a}"
    + "#apb-findbar .cnt{min-width:48px;text-align:center;font-size:11px;font-variant-numeric:tabular-nums;color:#a6a6b0;background:rgba(255,255,255,.08);border-radius:999px;padding:4px 8px}"
    + "#apb-findbar .sep{width:1px;height:16px;background:rgba(255,255,255,.14)}"
    + "#apb-findbar button{width:26px;height:26px;display:grid;place-items:center;background:none;border:none;border-radius:50%;color:#a6a6b0;font-size:13px;cursor:pointer;line-height:1;transition:background .15s ease,color .15s ease,transform .15s ease}"
    + "#apb-findbar button:hover{background:rgba(255,255,255,.12);color:#fff;transform:scale(1.1)}"
    + "#apb-findbar button:active{transform:scale(.9)}';",
  "document.documentElement.appendChild(css);",
  "var bar=document.createElement('div');bar.id='apb-findbar';",
  "bar.innerHTML='<span class=\\'ico\\'>🔍</span><input type=\\'text\\' placeholder=\\'Найти на странице…\\'><span class=\\'cnt\\'>–</span><span class=\\'sep\\'></span><button data-a=\\'prev\\' title=\\'Назад (Shift+Enter)\\'>‹</button><button data-a=\\'next\\' title=\\'Вперёд (Enter)\\'>›</button><button data-a=\\'close\\' title=\\'Закрыть (Esc)\\'>✕</button>';",
  "var inp=bar.querySelector('input'),cnt=bar.querySelector('.cnt');",
  "function clear(){for(var k=0;k<S.hits.length;k++){var m=S.hits[k];if(m.parentNode){m.parentNode.replaceChild(document.createTextNode(m.textContent),m);}}S.hits=[];}",
  "function norm(){var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:function(n){if(!n.nodeValue.trim())return NodeFilter.FILTER_REJECT;var p=n.parentNode;if(!p)return NodeFilter.FILTER_REJECT;var t=p.nodeName;if(t==='SCRIPT'||t==='STYLE'||t==='MARK')return NodeFilter.FILTER_REJECT;if(p.id==='apb-findbar')return NodeFilter.FILTER_REJECT;return NodeFilter.FILTER_ACCEPT;}});var out=[],n;while((n=w.nextNode()))out.push(n);return out;}",
  "function run(){clear();S.hits=[];if(!S.q){upd();return;}var nodes=norm();var ql=S.q.toLowerCase();for(var k=0;k<nodes.length&&S.hits.length<800;k++){var node=nodes[k];var text=node.nodeValue;var low=text.toLowerCase();var idx=low.indexOf(ql);while(idx!==-1&&S.hits.length<800){var range=document.createRange();range.setStart(node,idx);range.setEnd(node,idx+S.q.length);var mark=document.createElement('mark');mark.className='apb-hl';try{range.surroundContents(mark);S.hits.push(mark);node=mark.nextSibling;}catch(e){break;}if(!node||!node.nodeValue)break;low=node.nodeValue.toLowerCase();idx=low.indexOf(ql);}}upd();show();}",
  "function show(){if(!S.hits.length)return;if(S.i>=S.hits.length)S.i=0;if(S.i<0)S.i=S.hits.length-1;for(var k=0;k<S.hits.length;k++)S.hits[k].classList.remove('cur');var m=S.hits[S.i];m.classList.add('cur');m.scrollIntoView({block:'center',behavior:'smooth'});}",
  "function upd(){cnt.textContent=S.hits.length?(S.i+1)+'/'+S.hits.length:(S.q?'0/0':'–');}",
  "function next(d){if(!S.hits.length)return;S.i=(S.i+d+S.hits.length)%S.hits.length;show();upd();}",
  "inp.addEventListener('input',function(){S.q=inp.value;S.i=0;run();});",
  "bar.addEventListener('click',function(e){var a=e.target.closest('button');if(!a)return;var act=a.dataset.a;if(act==='next'){next(1);}if(act==='prev'){next(-1);}if(act==='close'){close();}});",
  "function key(e){if(e.key==='Escape'){e.preventDefault();close();}else if(e.key==='Enter'){e.preventDefault();next(e.shiftKey?-1:1);}}",
  "window.addEventListener('keydown',key,true);",
  "function close(){clear();window.removeEventListener('keydown',key,true);bar.remove();delete window.__APB_FIND__;}",
  "function open(){document.body.appendChild(bar);inp.focus();inp.select();run();}",
  "window.__APB_FIND__={open:open};open();",
  "})();",
].join("\n");

document.addEventListener("keydown", (e) => {
  const k = (e.key || "").toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (k === "f" || e.code === "KeyF")) {
    e.preventDefault();
    const t = currentTabObj();
    if (t && !t.isNew) invokeV2("page_eval", { id: t.id, js: FIND_JS }).catch(() => {});
    else {
      const h = document.getElementById("homeSearchInput");
      if (h && !h.closest(".hidden")) h.focus();
      else document.getElementById("addressInput").focus();
    }
  }
});


// Made by MrDuck