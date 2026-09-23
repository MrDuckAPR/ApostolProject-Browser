// APB v8.2 — dark, light and Windows/system theme modes.
const APB_THEME_KEY='apb-theme';
const apbSystemTheme=matchMedia('(prefers-color-scheme: light)');
function resolvedTheme(mode){return mode==='system'?(apbSystemTheme.matches?'light':'dark'):(mode==='light'?'light':'dark')}
function applyTheme(mode){
  if(!['dark','light','system'].includes(mode))mode='dark';
  const resolved=resolvedTheme(mode),root=document.documentElement;
  root.setAttribute('data-theme-mode',mode);root.setAttribute('data-theme',resolved);
  document.querySelectorAll('.theme-mode button[data-theme-choice],.theme-buttons button[data-theme-choice]').forEach(button=>button.classList.toggle('active',button.dataset.themeChoice===mode));
  localStorage.setItem(APB_THEME_KEY,mode);
  try{invoke('settings_theme_save',{theme:mode,resolved})}catch{}
  return resolved;
}
function resetCustomTheme(){
  const p=pzLoad();
  for(const key of ['thBg','thSoft','thSurface','thSurface2','thBorder','thText','thTextDim','thLink','thAccent','thOnAccent','thDanger','thSuccess','thWarning','thSelection','thShadow','bgColor'])p[key]='';
  localStorage.setItem('apb-ui',JSON.stringify(p));pzApply();pzSyncControls();
}
document.querySelectorAll('.theme-mode button[data-theme-choice],.theme-buttons button[data-theme-choice]').forEach(button=>button.addEventListener('click',()=>applyTheme(button.dataset.themeChoice)));
apbSystemTheme.addEventListener?.('change',()=>{if(localStorage.getItem(APB_THEME_KEY)==='system')applyTheme('system')});
window.applyTheme=applyTheme;window.resetCustomTheme=resetCustomTheme;
applyTheme(localStorage.getItem(APB_THEME_KEY)||'dark');
