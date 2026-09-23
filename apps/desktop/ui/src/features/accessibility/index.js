// APB accessibility: semantic tabs/panels, keyboard navigation, dialog trap, contrast audit.
(()=>{
const q=(s,r=document)=>[...r.querySelectorAll(s)], labelOf=e=>(e.getAttribute('aria-label')||e.title||e.textContent||'').replace(/\s+/g,' ').trim();
const skip=document.createElement('a');skip.href='#browserView';skip.className='skip-link';skip.textContent='Перейти к содержимому';document.body.prepend(skip);document.getElementById('browserView')?.setAttribute('tabindex','-1');
function labelControls(root=document){
 q('button:not([aria-label])',root).forEach(b=>{const l=labelOf(b);if(l)b.setAttribute('aria-label',l)});
 q('select:not([aria-label])',root).forEach(e=>e.setAttribute('aria-label',e.title||e.closest('label')?.innerText||e.id));
 q('input:not([aria-label]):not([type=hidden])',root).forEach(e=>{const l=e.closest('label')?.innerText||e.placeholder||e.id;if(l)e.setAttribute('aria-label',l.trim())});
 q('svg',root).forEach(e=>e.setAttribute('aria-hidden','true'));
}
function markTabs(list,buttons,panelFor){if(!list||!buttons.length)return;list.setAttribute('role','tablist');buttons.forEach(b=>{b.setAttribute('role','tab');const active=b.classList.contains('active');b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;const panel=panelFor(b);if(panel){if(!panel.id)panel.id='apb-panel-'+Math.random().toString(36).slice(2);b.setAttribute('aria-controls',panel.id);panel.setAttribute('role','tabpanel');panel.setAttribute('aria-hidden',String(!active))}})}
function refresh(){
 labelControls();
 const internal=document.getElementById('internalHost');
 markTabs(document.querySelector('.isec-nav'),q('.isec-link'),b=>internal?.querySelector(`.internal-page#${CSS.escape(b.dataset.isec||'')}`));
 markTabs(document.querySelector('.editor-tabs'),q('.editor-tabs button'),b=>document.querySelector('.etab-'+CSS.escape(b.dataset.etab||'')));
 q('.tab-list,.tab-list-h').forEach(list=>markTabs(list,q('.tab-pill',list),()=>null));
 q('.side-tools').forEach(x=>{x.setAttribute('role','navigation');x.setAttribute('aria-label','Инструменты браузера')});
 q('[role=status],#toastStack').forEach(x=>x.setAttribute('aria-live','polite'));
}
let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;refresh()})}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});refresh();
// One delegated arrow-key handler prevents duplicate listeners after rerenders.
document.addEventListener('keydown',e=>{
 const tab=e.target.closest?.('[role=tab]');if(!tab)return;
 const list=tab.closest('[role=tablist]');if(!list)return;
 const tabs=q('[role=tab]',list).filter(x=>!x.disabled&&x.offsetParent!==null);const i=tabs.indexOf(tab);if(i<0)return;
 if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1)+tabs.length)%tabs.length;tabs[n].focus();tabs[n].click()}
 else if(e.key==='Enter'||e.key===' '){e.preventDefault();tab.click()}
},true);
// Focus trap for every visible modal; Escape closes the normal close button.
document.addEventListener('keydown',e=>{const modal=q('[role=dialog],dialog[open]').filter(x=>x.offsetParent!==null).at(-1);if(!modal)return;if(e.key==='Escape'){const close=modal.querySelector('[data-r=cancel],.dlg-close,[aria-label*="Закры"],button[value=cancel]');if(close){e.preventDefault();close.click()}return}if(e.key!=='Tab')return;const f=q('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',modal).filter(x=>!x.disabled&&x.offsetParent!==null);if(!f.length)return;const a=f[0],z=f.at(-1);if(e.shiftKey&&document.activeElement===a){e.preventDefault();z.focus()}else if(!e.shiftKey&&document.activeElement===z){e.preventDefault();a.focus()}},true);
// WCAG 2.2 contrast audit for custom theme colors.
function rgb(hex){const m=/^#([0-9a-f]{6})$/i.exec(hex||'');if(!m)return null;const n=parseInt(m[1],16);return[n>>16,(n>>8)&255,n&255]}
function lum(c){return c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)}
function ratio(a,b){a=rgb(a);b=rgb(b);if(!a||!b)return 0;const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
const host=document.querySelector('.theme-advanced');if(host){const audit=document.createElement('div');audit.className='contrast-audit';audit.setAttribute('role','status');audit.setAttribute('aria-live','polite');host.append(audit);const paint=()=>{const text=document.getElementById('thText')?.value,bg=document.getElementById('thBg')?.value,accent=document.getElementById('thAccent')?.value,on=document.getElementById('thOnAccent')?.value;const normal=ratio(text,bg),action=ratio(on,accent),ok=normal>=4.5&&action>=4.5;audit.textContent=`Контраст: текст ${normal.toFixed(2)}:1 · кнопки ${action.toFixed(2)}:1 — ${ok?'соответствует WCAG AA':'нужно не менее 4.5:1'}`;audit.dataset.valid=String(ok);audit.style.color=ok?'var(--success)':'var(--danger)'};q('#thText,#thBg,#thAccent,#thOnAccent').forEach(e=>e.addEventListener('input',paint));paint()}
})();
