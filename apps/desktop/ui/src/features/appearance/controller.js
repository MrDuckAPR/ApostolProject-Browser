// APB v8.2 — appearance UI, instant range fill and experimental-material consent.
(()=>{
  const MATERIAL_KEY='apb-experimental-transparency-unlocked-v1';
  const LIVE=new Set(['network','aurora','gradient','waves','particles']);let lastPalette='';
  function paint(range){const min=Number(range.min||0),max=Number(range.max||100),value=Number(range.value||0);range.style.setProperty('--fill',`${Math.max(0,Math.min(100,(value-min)/(max-min)*100))}%`)}
  document.addEventListener('input',event=>{if(event.target?.matches('input[type="range"]'))paint(event.target)},true);
  const paintAll=()=>document.querySelectorAll('input[type="range"]').forEach(paint);
  const unlocked=()=>localStorage.getItem(MATERIAL_KEY)==='1';
  function updateLockUI(){
    const open=unlocked(),card=document.querySelector('.material-card'),controls=document.getElementById('materialControls');
    card?.classList.toggle('material-locked',!open);controls?.setAttribute('aria-disabled',String(!open));controls?.querySelectorAll('input,select,button').forEach(el=>el.disabled=!open);
    document.getElementById('materialUnlock')?.classList.toggle('hidden',open);document.getElementById('materialRelock')?.classList.toggle('hidden',!open);
    if(!open&&window.APBAppearance?.get().windowMode!=='off')window.APBAppearance.update({windowMode:'off'},true,'lock');
  }
  function openWarning(){const dialog=document.getElementById('materialWarningDialog'),consent=document.getElementById('materialConsent'),confirm=document.getElementById('materialConfirmUnlock');if(!dialog)return;consent.checked=false;confirm.disabled=true;dialog.showModal()}
  document.getElementById('materialUnlock')?.addEventListener('click',openWarning);document.addEventListener('apb:material-lock-request',openWarning);
  document.getElementById('materialConsent')?.addEventListener('change',event=>document.getElementById('materialConfirmUnlock').disabled=!event.target.checked);
  const acceptMaterial=()=>{const dialog=document.getElementById('materialWarningDialog'),consent=document.getElementById('materialConsent');if(!consent?.checked)return;localStorage.setItem(MATERIAL_KEY,'1');dialog?.close('unlock');updateLockUI();if(typeof toast==='function')toast('Экспериментальная прозрачность разблокирована','warn')};
  document.getElementById('materialConfirmUnlock')?.addEventListener('click',event=>{event.preventDefault();acceptMaterial()});
  document.getElementById('materialRelock')?.addEventListener('click',()=>{localStorage.removeItem(MATERIAL_KEY);window.APBAppearance?.update({windowMode:'off'},true,'relock');updateLockUI();if(typeof toast==='function')toast('Прозрачность снова заблокирована','ok')});
  function sync(detail=window.APBAppearance?.get?.()||{}){
    const type=detail.background||'off';document.getElementById('backgroundImageOptions')?.classList.toggle('hidden',type!=='image');
    for(const id of ['apPrimary','apSecondary','apFxIntensity','apFxSpeed','apFxDensity','apFxInteractive']){const el=document.getElementById(id);if(el)el.disabled=!LIVE.has(type)}
    const status=document.getElementById('materialStatus');if(status)status.textContent=!unlocked()?'🔒 Экспериментальная функция закрыта.':detail.windowMode&&detail.windowMode!=='off'?`Материал ${detail.windowMode}: живой фон приостановлен.`:LIVE.has(type)?'Обычный режим: живой фон работает.':'Обычный режим: системная прозрачность выключена.';
    const materialActive=unlocked()&&detail.windowMode&&detail.windowMode!=='off';for(const id of ['apSurfaceOpacity','apSurfaceBlur','apSurfaceSaturation']){const el=document.getElementById(id);if(el)el.disabled=!materialActive}document.querySelector('.material-card')?.classList.toggle('material-active',!!materialActive);updateLockUI();requestAnimationFrame(paintAll);
  }
  document.addEventListener('apb:appearance',event=>sync(event.detail));
  document.addEventListener('apb:palette-sync',event=>{const{primary,secondary}=event.detail||{},key=`${primary}|${secondary}`;if(primary&&secondary&&key!==lastPalette){lastPalette=key;window.APBThemeStudio?.syncFromEffect(primary,secondary)}});
  document.addEventListener('apb:fx-count',event=>{const out=document.getElementById('apFxDensityValue');if(out)out.textContent=event.detail.label});
  document.getElementById('apFxDensity')?.addEventListener('input',event=>{const out=document.getElementById('apFxDensityValue');if(out)out.textContent=`Плотность: ${event.target.value}%`});
  document.getElementById('apBgReset')?.addEventListener('click',()=>window.APBAppearance?.update({background:'off',windowMode:'off'},true));
  document.getElementById('apBgFileBtn')?.addEventListener('click',()=>{if(document.getElementById('apBgType')?.value!=='image')window.APBAppearance?.update({background:'image',windowMode:'off'},true)});
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');if(!reduced.matches){const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('section-visible');observer.unobserve(entry.target)}}),{threshold:.08});document.querySelectorAll('.appearance-group,.home-row-head').forEach(el=>observer.observe(el))}
  window.addEventListener('load',()=>{updateLockUI();sync();paintAll()},{once:true});updateLockUI();sync();
})();
