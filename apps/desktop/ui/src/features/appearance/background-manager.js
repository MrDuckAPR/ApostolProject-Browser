// APB v8.2 — single owner of live backgrounds and native window materials.
(()=>{
  const STORE='apb-appearance-v8';
  const MATERIAL_UNLOCK='apb-experimental-transparency-unlocked-v1';
  const LIVE=new Set(['network','aurora','gradient','waves','particles']);
  const DEFAULTS={background:'gradient',primary:'#816dff',secondary:'#35d8ff',intensity:.72,speed:.55,density:1,interactive:true,quality:'balanced',windowMode:'off',opacity:.78,blur:28,saturation:145,motion:1};
  const PRESETS={
    cosmos:{background:'network',primary:'#8b5cf6',secondary:'#22d3ee',theme:'dark'},
    aurora:{background:'aurora',primary:'#20e3a2',secondary:'#7868ff',theme:'dark'},
    sunset:{background:'gradient',primary:'#ff568d',secondary:'#ffb45f',theme:'dark'},
    ocean:{background:'waves',primary:'#287dff',secondary:'#39ecff',theme:'dark'},
    forest:{background:'particles',primary:'#22c55e',secondary:'#84cc16',theme:'dark'},
    rose:{background:'network',primary:'#ec4899',secondary:'#38bdf8',theme:'dark'},
    ember:{background:'particles',primary:'#f97316',secondary:'#ef4444',theme:'dark'},
    minimal:{background:'off',primary:'#64748b',secondary:'#94a3b8',theme:'system'}
  };
  let saved={};try{saved=JSON.parse(localStorage.getItem(STORE)||localStorage.getItem('apb-appearance-v4')||'{}')}catch{}
  let state={...DEFAULTS,...saved,windowMode:'off'},host=null,instance=null,lastNative='';
  const isUnlocked=()=>localStorage.getItem(MATERIAL_UNLOCK)==='1';
  const invokeNative=(cmd,args)=>{try{if(window.__TAURI_INTERNALS__?.invoke)return window.__TAURI_INTERNALS__.invoke(cmd,args);if(typeof window.invokeV2==='function')return window.invokeV2(cmd,args);if(typeof window.invoke==='function')return window.invoke(cmd,args)}catch{}return Promise.reject(new Error('Tauri IPC unavailable'))};
  function ensureHost(){if(host)return;host=document.createElement('div');host.id='apbFxRoot';host.setAttribute('aria-hidden','true');document.body.prepend(host)}
  const liveActive=()=>LIVE.has(state.background)&&state.windowMode==='off';
  function mount(){ensureHost();instance?.destroy();instance=null;const active=liveActive();host.classList.toggle('off',!active);if(active)instance=window.APBFxRegistry.create(state.background,host,{...state})}
  function applyNative(){const root=document.documentElement,active=state.windowMode!=='off';root.dataset.windowEffect=state.windowMode;root.classList.toggle('apb-window-transparent',active);root.classList.toggle('apb-window-clear',state.windowMode==='clear');root.classList.toggle('apb-window-blur',['mica','acrylic','blur'].includes(state.windowMode));if(lastNative===state.windowMode)return;lastNative=state.windowMode;invokeNative('window_transparency',{mode:state.windowMode,isLight:root.dataset.theme==='light'}).catch(()=>{})}
  function sync(source='state'){
    const values={apBgType:state.background,apPrimary:state.primary,apSecondary:state.secondary,apFxIntensity:state.intensity*100,apFxSpeed:state.speed*100,apFxDensity:state.density*100,apWindowMode:state.windowMode,apSurfaceOpacity:state.opacity*100,apSurfaceBlur:state.blur,apSurfaceSaturation:state.saturation,apMotionIntensity:state.motion*100};
    for(const[id,value]of Object.entries(values)){const el=document.getElementById(id);if(el)el.value=String(typeof value==='number'?Math.round(value):value)}
    const interaction=document.getElementById('apFxInteractive');if(interaction)interaction.checked=state.interactive;
    document.dispatchEvent(new CustomEvent('apb:appearance',{detail:{...state,liveActive:liveActive(),source}}));
  }
  function apply(remount=false,source='state'){
    const root=document.documentElement,style=root.style;style.setProperty('--apb-a',state.primary);style.setProperty('--apb-b',state.secondary);style.setProperty('--glass-a',state.opacity);style.setProperty('--apb-blur',state.blur+'px');style.setProperty('--apb-sat',state.saturation+'%');style.setProperty('--motion-scale',state.motion);root.classList.toggle('apb-visual-active',liveActive());document.body?.classList.toggle('no-motion',state.motion===0);
    if(remount||!instance)mount();else instance.update({...state});applyNative();sync(source);
  }
  function update(patch,remount=false,source='control'){
    patch={...patch};
    if(patch.windowMode&&patch.windowMode!=='off'&&!isUnlocked()){patch.windowMode='off';document.dispatchEvent(new CustomEvent('apb:material-lock-request'))}
    const oldBackground=state.background,oldMode=state.windowMode;state={...state,...patch};if(LIVE.has(patch.background)||patch.background==='image')state.windowMode='off';localStorage.setItem(STORE,JSON.stringify(state));apply(remount||oldBackground!==state.background||oldMode!==state.windowMode,source);
  }
  function markPreset(name){document.querySelectorAll('[data-apb-preset]').forEach(button=>button.classList.toggle('active',button.dataset.apbPreset===name))}
  function preset(name){const value=PRESETS[name];if(!value)return;markPreset(name);const{theme,...appearance}=value;if(typeof window.applyTheme==='function')window.applyTheme(theme);update({...appearance,windowMode:'off'},true,'preset');document.dispatchEvent(new CustomEvent('apb:palette-sync',{detail:{primary:appearance.primary,secondary:appearance.secondary,source:'preset'}}))}
  function reset(){state={...DEFAULTS};localStorage.removeItem(STORE);markPreset('');lastNative='';apply(true,'reset')}
  const byte=n=>Math.round(n).toString(16).padStart(2,'0');
  function hsl(h,s,l){s/=100;l/=100;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;let r=0,g=0,b=0;if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];return`#${byte((r+m)*255)}${byte((g+m)*255)}${byte((b+m)*255)}`}
  function random(){markPreset('');const hue=Math.floor(Math.random()*360),gap=65+Math.floor(Math.random()*80),primary=hsl(hue,72,58),secondary=hsl((hue+gap)%360,78,61),types=['network','gradient','waves','particles','aurora'],background=types[Math.floor(Math.random()*types.length)];update({primary,secondary,background,windowMode:'off'},true,'random');document.dispatchEvent(new CustomEvent('apb:palette-sync',{detail:{primary,secondary,source:'random'}}))}
  function bind(){
    const bg=document.getElementById('apBgType');bg?.addEventListener('change',()=>{markPreset('');update({background:bg.value,windowMode:'off'},true,'background')});
    for(const[id,key]of Object.entries({apPrimary:'primary',apSecondary:'secondary',apWindowMode:'windowMode',apFxInteractive:'interactive'})){const el=document.getElementById(id);el?.addEventListener('input',()=>update({[key]:el.type==='checkbox'?el.checked:el.value},key==='windowMode','control'))}
    for(const[id,[key,div]]of Object.entries({apFxIntensity:['intensity',100],apFxSpeed:['speed',100],apFxDensity:['density',100],apSurfaceOpacity:['opacity',100],apSurfaceBlur:['blur',1],apSurfaceSaturation:['saturation',1],apMotionIntensity:['motion',100]})){const el=document.getElementById(id);el?.addEventListener('input',()=>update({[key]:Number(el.value)/div},false,key==='density'?'density':'control'))}
    document.querySelectorAll('[data-apb-preset]').forEach(button=>button.addEventListener('click',()=>preset(button.dataset.apbPreset)));document.getElementById('apFxRandom')?.addEventListener('click',random);
  }
  document.addEventListener('visibilitychange',()=>{if(!instance)return;document.hidden?instance.pause():instance.resume()});new MutationObserver(()=>{lastNative='';applyNative()}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  window.APBAppearance={get:()=>({...state}),update,preset,reset,random,presets:PRESETS,isMaterialUnlocked:isUnlocked};
  const start=()=>{bind();apply(true,'startup')};document.readyState==='loading'?document.addEventListener('DOMContentLoaded',start,{once:true}):start();
})();
