// APB v8 — home widgets on a real CSS grid with smooth pointer sorting. Empty by default.
(()=>{
const KEY='apb-home-widgets-v9',META={clock:['Время','◷'],calendar:['Календарь','▦'],weather:['Погода','☁'],tasks:['Задачи','✓'],focus:['Фокус-таймер','◎'],stopwatch:['Секундомер','◴'],quote:['Идея дня','❝'],session:['Статистика сессии','⌁']};
const IDS=Object.keys(META);
const UNIT=110,ROW=16,MAXCOLS=12;
const BGS=[['auto','Как обычно'],['none','Без фона'],['sunset','Закат'],['ocean','Океан'],['forest','Лес'],['candy','Конфета'],['graphite','Графит'],['midnight','Ночь']];
const FONTS=[['s','Мелкий'],['n','Обычный'],['l','Крупный']];
const baseSize=()=>({width:440,height:288});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const defaults=()=>({order:[...IDS],hidden:[...IDS],sizes:Object.fromEntries(IDS.map(id=>[id,baseSize()])),motion:true,pinned:[],style:Object.fromEntries(IDS.map(id=>[id,{bg:'auto',font:'n'}]))});
function load(){let raw={};try{raw=JSON.parse(localStorage.getItem(KEY)||'{}')}catch{}const d=defaults(),cfg={...d,...raw};cfg.order=[...cfg.order.filter(id=>META[id]),...IDS.filter(id=>!cfg.order.includes(id))];cfg.hidden=[...new Set((cfg.hidden||IDS).filter(id=>META[id]))];cfg.sizes={...d.sizes,...(cfg.sizes||{})};cfg.pinned=[...(cfg.pinned||[]).filter(id=>META[id])];cfg.style={...d.style,...(cfg.style||{})};return cfg}
let cfg=load(),pending=0;const row=()=>document.getElementById('widgetsRow'),save=()=>localStorage.setItem(KEY,JSON.stringify(cfg));
function ensureEmpty(root){let empty=document.getElementById('widgetsEmpty');if(!empty){empty=document.createElement('div');empty.id='widgetsEmpty';empty.className='widgets-empty';empty.innerHTML='<b>На главной пока нет виджетов</b><span>Добавьте только те карточки, которыми будете пользоваться.</span><button class="ghost-btn" type="button">Добавить виджеты</button>';root.before(empty);empty.querySelector('button').onclick=open}empty.classList.toggle('hidden',IDS.some(id=>!cfg.hidden.includes(id)))}
function span(size){const s=size||baseSize();return{cols:clamp(Math.round(s.width/UNIT),3,MAXCOLS),rows:clamp(Math.round(s.height/ROW),3,72)}}
function apply(animate=false){const root=row();if(!root)return;root.classList.toggle('widgets-motion',cfg.motion);cfg.order.forEach((id,index)=>{const card=root.querySelector(`[data-widget="${id}"]`);if(!card)return;const s=span(cfg.sizes[id]);card.style.order=index;card.style.gridColumn='span '+s.cols;card.style.gridRow='span '+s.rows;card.style.removeProperty('--widget-width');card.style.removeProperty('--widget-height');card.classList.toggle('hidden',cfg.hidden.includes(id));const st=cfg.style[id]||{bg:'auto',font:'n'};card.dataset.wbg=st.bg;card.dataset.wfont=st.font;if(animate&&cfg.motion&&!cfg.hidden.includes(id)){card.classList.remove('widget-enter');requestAnimationFrame(()=>card.classList.add('widget-enter'))}});ensureEmpty(root)}
function update(patch,animate=false){cfg={...cfg,...patch};save();apply(animate)}
function toggle(id,visible){if(!META[id])return;cfg.hidden=visible?cfg.hidden.filter(x=>x!==id):[...new Set([...cfg.hidden,id])];save();apply(true);renderEditor()}
function reorder(source,target){const p=cfg.pinned||[];if(p.includes(source)||p.includes(target))return false;const a=cfg.order.indexOf(source),b=cfg.order.indexOf(target);if(a<0||b<0||a===b)return false;const next=[...cfg.order],moved=next.splice(a,1)[0];next.splice(b,0,moved);cfg.order=next;apply(false);return true}
const overlay=document.createElement('div');overlay.className='widget-editor-overlay hidden';overlay.innerHTML=`<div class="widget-editor" role="dialog" aria-modal="true"><div class="we-head"><div><b>Виджеты главной</b><small>Включите нужные. Порядок меняется прямо на главной перетаскиванием за название.</small></div><button id="weClose">×</button></div><div id="weList" class="we-list"></div><div class="we-options"><label>Анимации<input id="weMotion" type="checkbox"></label></div><div class="we-foot"><button id="weHideAll" class="ghost-btn">Скрыть все</button><button id="weDone" class="primary-btn">Готово</button></div></div>`;document.body.append(overlay);
function renderEditor(){const list=overlay.querySelector('#weList');list.replaceChildren();cfg.order.forEach(id=>{const [name,icon]=META[id],st=cfg.style[id]||{bg:'auto',font:'n'},item=document.createElement('div');item.className='we-row';item.innerHTML=`<div class="we-top"><span class="we-icon">${icon}</span><span class="we-name">${name}</span><label class="we-switch"><input type="checkbox" ${cfg.hidden.includes(id)?'':'checked'}><i></i></label></div><div class="we-style"><label>Фон<select data-k="bg">${BGS.map(b=>`<option value="${b[0]}" ${st.bg===b[0]?'selected':''}>${b[1]}</option>`).join('')}</select></label><label>Шрифт<select data-k="font">${FONTS.map(f=>`<option value="${f[0]}" ${st.font===f[0]?'selected':''}>${f[1]}</option>`).join('')}</select></label></div>`;item.querySelector('input').onchange=e=>toggle(id,e.target.checked);item.querySelectorAll('select[data-k]').forEach(sel=>sel.onchange=e=>{cfg.style=cfg.style||{};cfg.style[id]={...(cfg.style[id]||{}),[sel.dataset.k]:sel.value};save();apply(false)});list.append(item)});overlay.querySelector('#weMotion').checked=cfg.motion}
function open(){renderEditor();overlay.classList.remove('hidden')}function close(){overlay.classList.add('hidden')}
overlay.querySelector('#weClose').onclick=close;overlay.querySelector('#weDone').onclick=close;overlay.onclick=e=>{if(e.target===overlay)close()};overlay.querySelector('#weMotion').onchange=e=>update({motion:e.target.checked},true);overlay.querySelector('#weHideAll').onclick=()=>{cfg.hidden=[...IDS];save();apply();renderEditor()};
function visibleRects(root){return new Map([...root.querySelectorAll('.widget:not(.hidden)')].map(el=>[el.dataset.widget,el.getBoundingClientRect()]))}
function animateGridShift(root,before,exclude){
 if(!cfg.motion||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 root.querySelectorAll('.widget:not(.hidden)').forEach(el=>{
  if(el===exclude)return;const old=before.get(el.dataset.widget),now=el.getBoundingClientRect();if(!old)return;
  const dx=old.left-now.left,dy=old.top-now.top;if(Math.abs(dx)<.5&&Math.abs(dy)<.5)return;
  el.getAnimations().filter(a=>a.id==='apb-widget-reflow').forEach(a=>a.cancel());
  const a=el.animate([{transform:`translate3d(${dx}px,${dy}px,0)`},{transform:'translate3d(0,0,0)'}],{duration:220,easing:'cubic-bezier(.22,1,.36,1)'});a.id='apb-widget-reflow';
 })
}
function commitKeyboardResize(card,id,dw,dh){
 const root=row(),before=visibleRects(root),old=cfg.sizes[id]||baseSize();
 cfg.sizes[id]={width:clamp(old.width+dw,330,MAXCOLS*UNIT),height:clamp(old.height+dh,48,1152)};
 apply(false);animateGridShift(root,before,card);save();
 card.classList.add('widget-resize-pulse');setTimeout(()=>card.classList.remove('widget-resize-pulse'),220);
}
function bindCard(card){
 const id=card.dataset.widget,head=card.querySelector('.w-head'),title=head?.querySelector('span:first-child');
if(title){title.draggable=false;title.classList.add('widget-drag-title');title.title='Зажмите и перетащите виджет'}
 if(head){
  const pin=document.createElement('button');pin.className='w-pin';pin.type='button';pin.innerHTML='<svg class="w-pin-ic" viewbox="0 0 24 24"><use href="#i-lock-open"/></svg>';pin.title='Закрепить виджет (не двигается при сортировке)';pin.setAttribute('aria-label','Закрепить или открепить виджет');
  const syncPin=()=>{const on=(cfg.pinned||[]).includes(id);pin.classList.toggle('pinned',on);const u=pin.querySelector('use');if(u)u.setAttribute('href',on?'#i-lock':'#i-lock-open')};
  syncPin();
  pin.onclick=e=>{e.stopPropagation();const p=cfg.pinned||[];cfg.pinned=p.includes(id)?p.filter(x=>x!==id):[...p,id];save();syncPin()};
  head.append(pin);
 }
 if(card.querySelector('.widget-resize'))return;
 const h=document.createElement('button');h.className='widget-resize';h.type='button';h.textContent='◢';h.title='Плавно изменить ширину и высоту виджета';h.setAttribute('aria-label','Изменить размер виджета');card.append(h);
 h.onkeydown=e=>{
  const step=e.shiftKey?110:22;
  if(e.key==='ArrowRight'){e.preventDefault();commitKeyboardResize(card,id,step,0)}
  else if(e.key==='ArrowLeft'){e.preventDefault();commitKeyboardResize(card,id,-step,0)}
  else if(e.key==='ArrowDown'){e.preventDefault();commitKeyboardResize(card,id,0,step)}
  else if(e.key==='ArrowUp'){e.preventDefault();commitKeyboardResize(card,id,0,-step)}
 };
 h.onpointerdown=e=>{
  if(e.button!==0)return;e.preventDefault();e.stopPropagation();
  const root=row(),model=cfg.sizes[id]||baseSize(),rect=card.getBoundingClientRect();
  const st={pid:e.pointerId,x:e.clientX,y:e.clientY,startW:rect.width,startH:rect.height,modelW:model.width,modelH:model.height,lastSpan:span(model),frame:0,targetW:rect.width,targetH:rect.height};
  card.classList.add('widget-resizing');document.body.classList.add('widget-resize-active');h.setPointerCapture(e.pointerId);
  const paint=()=>{
   st.frame=0;const w=clamp(st.targetW,330,MAXCOLS*UNIT),hh=clamp(st.targetH,48,1152);
   card.style.setProperty('--resize-w',w+'px');card.style.setProperty('--resize-h',hh+'px');
   const modelW=clamp(st.modelW+(w-st.startW),330,MAXCOLS*UNIT),modelH=clamp(st.modelH+(hh-st.startH),48,1152),next=span({width:modelW,height:modelH});
   card.dataset.resizeLabel=`${Math.round(w)} × ${Math.round(hh)} · ${next.cols}×${next.rows}`;
   cfg.sizes[id]={width:modelW,height:modelH};
   if(next.cols!==st.lastSpan.cols||next.rows!==st.lastSpan.rows){const before=visibleRects(root);st.lastSpan=next;apply(false);animateGridShift(root,before,card)}
  };
  h.onpointermove=ev=>{if(ev.pointerId!==st.pid)return;st.targetW=st.startW+ev.clientX-st.x;st.targetH=st.startH+ev.clientY-st.y;if(!st.frame)st.frame=requestAnimationFrame(paint)};
  const done=ev=>{
   if(ev&&ev.pointerId!==undefined&&ev.pointerId!==st.pid)return;
   if(st.frame){cancelAnimationFrame(st.frame);paint()}
   const preview=card.getBoundingClientRect();card.classList.remove('widget-resizing');document.body.classList.remove('widget-resize-active');card.style.removeProperty('--resize-w');card.style.removeProperty('--resize-h');delete card.dataset.resizeLabel;apply(false);
   const snapped=card.getBoundingClientRect(),sx=snapped.width?preview.width/snapped.width:1,sy=snapped.height?preview.height/snapped.height:1;
   if(cfg.motion&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&(Math.abs(sx-1)>.01||Math.abs(sy-1)>.01))card.animate([{transform:`scale(${sx},${sy})`,transformOrigin:'left top'},{transform:'scale(1)',transformOrigin:'left top'}],{duration:180,easing:'cubic-bezier(.22,1,.36,1)'});
   h.onpointermove=h.onpointerup=h.onpointercancel=h.onlostpointercapture=null;save();
  };
  h.onpointerup=done;h.onpointercancel=done;h.onlostpointercapture=done;
 };
}
function clearTargets(){document.querySelectorAll('#widgetsRow .widget-drop-target').forEach(x=>x.classList.remove('widget-drop-target'))}
function bindPointerSort(card){const title=card.querySelector('.widget-drag-title');if(!title)return;let st=null;
title.addEventListener('pointerdown',e=>{if(e.button!==0)return;if((cfg.pinned||[]).includes(card.dataset.widget))return;st={pid:e.pointerId,x:e.clientX,y:e.clientY,live:false,id:card.dataset.widget,target:null};title.setPointerCapture?.(e.pointerId)});
 title.addEventListener('pointermove',e=>{if(!st||e.pointerId!==st.pid)return;const dx=e.clientX-st.x,dy=e.clientY-st.y;
  if(!st.live){if(Math.hypot(dx,dy)<6)return;st.live=true;card.classList.add('widget-pointer-dragging');document.body.classList.add('widget-sort-active')}
  e.preventDefault();card.style.setProperty('--drag-x',dx+'px');card.style.setProperty('--drag-y',dy+'px');
  card.style.pointerEvents='none';const el=document.elementFromPoint(e.clientX,e.clientY);card.style.pointerEvents='';
  const target=el?.closest('#widgetsRow .widget:not(.hidden)');clearTargets();st.target=null;
  if(!target||target===card||(cfg.pinned||[]).includes(target.dataset.widget))return;
  target.classList.add('widget-drop-target');st.target=target.dataset.widget});
 const finish=e=>{if(!st||e.pointerId!==st.pid)return;const state=st;st=null;const was=state.live;
  if(was){
   const root=row(),visual=card.getBoundingClientRect(),before=visibleRects(root),targetId=state.target;
   card.classList.remove('widget-pointer-dragging');card.style.removeProperty('--drag-x');card.style.removeProperty('--drag-y');
   if(targetId&&reorder(state.id,targetId)){
    animateGridShift(root,before,card);
    const finalRect=card.getBoundingClientRect(),dx=visual.left-finalRect.left,dy=visual.top-finalRect.top;
    if(cfg.motion&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
     card.getAnimations().filter(a=>a.id==='apb-widget-drop').forEach(a=>a.cancel());
     const a=card.animate([{transform:`translate3d(${dx}px,${dy}px,0)`,scale:'1.02'},{transform:'translate3d(0,0,0)',scale:'1'}],{duration:260,easing:'cubic-bezier(.22,1,.36,1)'});a.id='apb-widget-drop';
    }
   }
  }
  card.classList.remove('widget-pointer-dragging');card.style.removeProperty('--drag-x');card.style.removeProperty('--drag-y');document.body.classList.remove('widget-sort-active');clearTargets();if(was)save()};
 title.addEventListener('pointerup',finish);title.addEventListener('pointercancel',finish);title.addEventListener('lostpointercapture',finish)}
document.querySelectorAll('#widgetsRow .widget').forEach(card=>{bindCard(card);bindPointerSort(card)});
document.getElementById('widgetsCfgBtn')?.addEventListener('click',open);document.getElementById('widgetsCfgAppearanceBtn')?.addEventListener('click',open);document.querySelectorAll('#widgetsRow .w-hide').forEach(b=>b.addEventListener('click',()=>{const id=b.closest('[data-widget]')?.dataset.widget;if(id)toggle(id,false)}));
const ideas=['Сделай одну маленькую вещь лучше, чем вчера.','Сначала ясность, потом скорость.','Инструмент хорош, когда не мешает работе.','Сложное решение стоит сначала объяснить простыми словами.','Отдых — часть устойчивой работы.','Тишина — тоже ответ.','Удаляй лишнее — останется главное.','Правильное имя переменной экономит часы.','Ошибка, которую видишь, — уже пол-исправления.','Сначала воспроизведи, потом чини.','Скорость важна, но надёжность дороже.','Одна задача до конца лучше трёх до середины.','Переключение контекста стоит дорого.','Документация читается будущим тобой.','Меньше зависимостей — меньше сюрпризов.','Регулярный git спасает от паники.','Код читают люди, а не только машины.','Мелкие коммиты — крупная услуга.','Простота — высшая форма изящества.','Проверяй ввод, как будто он злонамерен.','Интерфейс — это диалог, а не монолог.','Пользователь не виноват в непонятном интерфейсе.','Хорошая архитектура делает сложное очевидным.','Правило трёх: третий раз — обобщай.','Не оптимизируй то, что не измерено.','Приватность — это способность быть скучным.','Данные — это не имущество, а доверие.','Трекер не собирает данные — он шпионит.','Безопасность — это привычка, а не галочка.','Пароль длиннее — стена выше.','Защита начинается с малых привычек.','Резервная копия — это тишина.','Шифрование — вежливость к чужим глазам.','Сложный пароль — простая жизнь.','Утро — самое честное время суток.','Сначала пойми проблему, потом выбирай инструмент.','Усталость — плохой советчик.','Прогресс не обязан быть быстрым.','Главное — начать сегодня.','Работа не должна убегать от тебя по ночам.','Иногда лучший рефакторинг — удаление.','Не будь как интерфейс, который всё усложняет.','Тише работаешь — дальше проект уйдёт.','Красота кода — в читаемости.','Один глубокий час лучше трёх отвлечённых.','Название функции — это её документация.','Читай ошибку полностью, а не первую строку.','Если проблема повторилась дважды — это уже система.','Экран — это окно, а не стена.','Мышление вне экрана тоже считается работой.','Решай проблему, а не её симптом.','Сложное разбери на кусочки по одному.','Лучший комментарий — тот, что не нужен.','Тайм-менеджмент — это про внимание, а не часы.','Не откладывай ревью на «потом».','Инструменты должны служить, а не владеть.','Пользователь — главный тестировщик.','Простота интерфейса начинается с простоты модели данных.','Сомневайся в своих предположениях.','Хороший вопрос — половина ответа.','Работай с уважением к будущему себе.','Не храни секреты в мессенджерах.','Первое решение обычно самое тяжёлое.','Инженер думает, а потом печатает.','Сначала сделай, потом сделай красиво.','Ошибки — это плата за настоящий опыт.','Иногда лучше сделать паузу, чем залить кривой код.','Хороший продукт не требует инструкции.','Свобода — это про выбор инструментов.','Меньше слов — больше смысла.','Проверяй свои привилегии и разрешения.','Уважение к чужому времени — лучший дизайн.','Сложность редко бывает необходимой.','Копируй смысл, а не код.','Одна хорошая метафора объясняет больше схемы.','Делай резервные копии ДО, а не ПОСЛЕ.','Качество — это не добавить, а не сломать.'];
const NET_KEY='apb-quote-net-v1';
const daySeed=()=>{const d=new Date(),s=new Date(d.getFullYear(),0,0);return Math.floor((d-s)/86400000)};
const qEl=document.getElementById('dailyQuote'),aEl=document.getElementById('dailyQuoteAuthor'),bEl=document.getElementById('quoteNext');
function paint(text,author){if(qEl)qEl.textContent=text;if(aEl)aEl.textContent=author}
let last=0;
let manual=false;
const MODE_KEY='apb-quote-mode-v1';
const GREAT=[['Камень, который ты не поднимаешь, тебя не давит.','Хилон из Спарты'],['Когда мы не можем достичь согласия, мы должны научиться достигать компромисса.','Катон Старший'],['Победа любит подготовку, а не удачу.','Александр Македонский'],['Лучше быть первым в деревне, чем вторым в Риме.','Гай Юлий Цезарь'],['Пришёл, увидел, победил.','Гай Юлий Цезарь'],['Разделяй и властвуй.','Гай Юлий Цезарь'],['Даже смерть не отменяет дисциплины.','Спартак'],['Я пришёл, я увидел, я победил — но сначала я спросил, зачем.','Гай Юлий Цезарь'],['Кто владеет информацией, тот владеет миром.','Уинстон Черчилль'],['Никогда не сдавайся — это единственный верный путь.','Уинстон Черчилль'],['Тяжело в учении — легко в бою.','Александр Суворов'],['Сам погибай, а товарища выручай.','Александр Суворов'],['Мы — русские, какой восторг!','Александр Суворов'],['Дисциплина — мать победы.','Александр Суворов'],['Пуля — дура, штык — молодец.','Александр Суворов'],['Армия баранов под руководством льва сильнее армии львов под руководством барана.','Александр Суворов'],['Медленно, но верно.','Пётр I'],['Делу время — потехе час.','Пётр I'],['Знать, что владеешь правом, — значит иметь силу.','Екатерина II'],['Лучше простить десять виновных, чем наказать одного невиновного.','Екатерина II'],['Государь, который не знает своих подданных, — чужак в своём государстве.','Екатерина II'],['Отдых после дела — дело после отдыха.','Марк Аврелий'],['Наша жизнь есть то, что мы думаем о ней.','Марк Аврелий'],['Если тебе трудно — значит, ты делаешь что-то важное.','Марк Аврелий'],['Счастье — в способности быть довольным малым.','Марк Аврелий'],['Правитель — это не власть, а ответственность.','Марк Аврелий'],['Тот, кто игнорирует прошлое, рискует его повторить.','Конфуций'],['Не важно, как медленно ты идёшь, — важно не останавливаться.','Конфуций'],['Правитель должен сначала победить себя.','Конфуций'],['Кто не знает истории, обречён её повторять.','Цицерон'],['Пока я жив, надеюсь.','Цицерон'],['Справедливость — основа государства.','Солон'],['Знающий не говорит, говорящий не знает.','Лао-цзы'],['Путь в тысячу ли начинается с первого шага.','Лао-цзы'],['Кто управляет другими, теряет себя; кто управляет собой, обретает всё.','Лао-цзы'],['Нет ничего более постоянного, чем временное.','Деций Младший'],['Деньги — это не цель, а инструмент.','Наполеон Бонапарт'],['Невозможно — это слово из словаря дураков.','Наполеон Бонапарт'],['Дай мне хороших матерей, и я дам тебе хорошую нацию.','Наполеон Бонапарт'],['В политике глупость не является препятствием.','Наполеон Бонапарт'],['Каждый солдат носит в ранце жезл маршала.','Наполеон Бонапарт'],['Воображение правит миром.','Наполеон Бонапарт'],['Я знаю, что ничего не знаю.','Сократ'],['Не пытайся казаться, а старайся быть.','Пифагор'],['Мудрый правитель — тот, кто слушает.','Аристотель'],['Цель не оправдывает средства, если цель грязная.','Сенека'],['Правительство — это доверие, а не контроль.','Карл Великий'],['Молчание — золото, а слово — серебро.','Соломон'],['Всё, что делаешь, делай искренне.','Конфуций'],['Сначала ясность, потом власть.','Цезарь'],['Лучший способ предсказать будущее — создать его.','Пётр I']];
const STATHAM=[['Я не играю по правилам, я их устанавливаю.','Джейсон Стэтхем'],['Всё, что меня не убивает, делает меня быстрее.','Джейсон Стэтхем'],['Я не говорю много — я делаю.','Джейсон Стэтхем'],['Если враг спокоен — значит, он что-то задумал.','Джейсон Стэтхем'],['Насилие — это язык, который понимают все.','Джейсон Стэтхем'],['Время — единственное, что нельзя вернуть.','Джейсон Стэтхем'],['Иногда лучше подождать, чем рисковать.','Джейсон Стэтхем'],['Мне не нужны слова, чтобы доказать, кто я.','Джейсон Стэтхем'],['У любого человека есть план, пока...','Джейсон Стэтхем'],['Я не завидую, я работаю.','Джейсон Стэтхем'],['Дорогу осилит идущий.','Джейсон Стэтхем'],['Главное — не попадаться.','Джейсон Стэтхем'],['Я возвращаю долги.','Джейсон Стэтхем'],['Я не проигрываю — я перегруппировываюсь.','Джейсон Стэтхем'],['Лучше один раз сделать, чем сто раз объяснять.','Джейсон Стэтхем'],['Ты можешь бежать, но спрятаться негде.','Джейсон Стэтхем'],['Слабые плачут, сильные действуют.','Джейсон Стэтхем'],['Удача любит подготовленных.','Джейсон Стэтхем'],['У меня нет врагов — у меня есть цели.','Джейсон Стэтхем'],['Мышцы — это броня, скорость — оружие.','Джейсон Стэтхем'],['Каждый выбор имеет цену.','Джейсон Стэтхем'],['Я не спрашиваю разрешения.','Джейсон Стэтхем'],['Всё, что блестит, — не всегда золото, но бывает и так.','Джейсон Стэтхем'],['Сила — это не только кулаки.','Джейсон Стэтхем'],['Не стоит недооценивать противника.','Джейсон Стэтхем'],['Молчание — тоже оружие.','Джейсон Стэтхем'],['Я довожу дело до конца.','Джейсон Стэтхем'],['Каждая секунда на счету.','Джейсон Стэтхем'],['Я не иду на компромисс с преступностью.','Джейсон Стэтхем'],['Ты — то, что ты делаешь, а не то, что говоришь.','Джейсон Стэтхем'],['Ошибся один раз — извинись. Ошибся дважды — исправь.','Джейсон Стэтхем'],['Я стреляю, чтобы остановить.','Джейсон Стэтхем'],['Лучший план — тот, который сработал.','Джейсон Стэтхем'],['В этом городе свои законы.','Джейсон Стэтхем'],['Не беги от проблемы — беги к решению.','Джейсон Стэтхем'],['Я помню каждое лицо, которое меня предало.','Джейсон Стэтхем'],['Занятность — не ошибка, а стиль.','Джейсон Стэтхем'],['Если хочешь что-то сделать хорошо — сделай сам.','Джейсон Стэтхем'],['Мне не нужен повод — мне нужна цель.','Джейсон Стэтхем'],['Я не боюсь темноты.','Джейсон Стэтхем'],['Скорость решает всё.','Джейсон Стэтхем'],['Никогда не оглядывайся — там может быть тот, кого ты боишься.','Джейсон Стэтхем'],['Я — не герой, я — профессионал.','Джейсон Стэтхем'],['Если у тебя есть план — не останавливайся.','Джейсон Стэтхем'],['Каждое утро — новый бой.','Джейсон Стэтхем'],['Я умею слушать, когда надо.','Джейсон Стэтхем'],['Не давай обещаний, которые не сдержишь.','Джейсон Стэтхем'],['Мой код — мои правила.','Джейсон Стэтхем'],['Не важно, что ты задекларировал, — важно, что сделал.','Джейсон Стэтхем'],['Парадокс Стэтхема: чем быстрее бежишь, тем дольше стоишь.','Джейсон Стэтхем']];
let mode='team';
try{mode=localStorage.getItem(MODE_KEY)||'team'}catch{}
function syncQuoteModes(){
  const seg=document.getElementById('quoteModes');if(!seg)return;
  const buttons=[...seg.querySelectorAll('button[data-qm]')];
  const active=buttons.find(b=>b.dataset.qm===mode)||buttons[0];
  buttons.forEach(b=>b.classList.toggle('on',b===active));
  const thumb=seg.querySelector('.seg-thumb');
  if(thumb&&active){thumb.style.width=active.offsetWidth+'px';thumb.style.translate=`${active.offsetLeft}px 0`}
}
function setMode(m){mode=m;try{localStorage.setItem(MODE_KEY,m)}catch{};syncQuoteModes();manual=true;pickLocal()}
document.querySelectorAll('#quoteModes button[data-qm]').forEach(btn=>btn.addEventListener('click',()=>setMode(btn.dataset.qm)));
syncQuoteModes();
if('ResizeObserver' in window){try{const seg=document.getElementById('quoteModes');if(seg)new ResizeObserver(syncQuoteModes).observe(seg)}catch{}}
function pickLocal(){
  const pool=mode==='great'?GREAT:mode==='statham'?STATHAM:ideas;
  let i=Math.floor(Math.random()*pool.length);
  if(pool.length>1&&i===last)i=(i+1)%pool.length;
  last=i;
  if(mode==='great')paint(pool[i][0],pool[i][1]);
  else if(mode==='statham')paint(pool[i][0],pool[i][1]);
  else paint(ideas[i],'Команда APB');
}
function paintNet(q,a){paint(q,(a||'Интернет')+' · из сети');if(bEl){bEl.disabled=false;bEl.title='Следующая мысль'}}
document.getElementById('quoteNext')?.addEventListener('click',()=>{manual=true;pickLocal()});
let netShownFor=null;
function maybeNet(){
  const key=daySeed();
  if(netShownFor===key||manual)return;
  (async()=>{
   try{
    let cached=null;try{cached=JSON.parse(localStorage.getItem(NET_KEY)||'null')}catch{}
    if(cached&&cached.day===key){netShownFor=key;paintNet(cached.quote,cached.author);return}
    const r=await fetch('https://dummyjson.com/quotes/random');if(!r.ok)throw new Error('http '+r.status);
    const j=await r.json();if(!j||!j.quote)throw new Error('bad payload');
    const rec={day:key,quote:j.quote,author:j.author||'Интернет'};
    try{localStorage.setItem(NET_KEY,JSON.stringify(rec))}catch{}
    netShownFor=key;
    paintNet(rec.quote,rec.author);
   }catch(e){}
  })();
}
// При каждом заходе на главную: новый случайный локальный афоризм; раз в сутки
// сверху ложится свежий «из сети» (кэш на день, как и раньше). Счётчик «i/N»
// убран: мысль дня больше не выглядит очередью.
function quoteAtHome(){pickLocal();maybeNet()}
window.__apbQuote={onHome:quoteAtHome,next:quoteAtHome};
quoteAtHome();
window.APBWidgets={open,apply,toggle,get:()=>structuredClone(cfg),import:value=>{cfg={...defaults(),...(value||{})};save();apply(true)}};apply();})();

// «Текущая сессия» (index.html:465): аптайм/вкладки/ядра/память/сеть.
// Rust — session_stats (main.rs:280 → session/mod.rs:77). Поллер раз в 2с
// честно спрашивает бэкенд и красят не «—», а живые цифры.
(function(){
  const ids=['sessionTime','sessionTabs','systemCores','networkState'];
  const has=ids.some(id=>document.getElementById(id));
  if(!has)return;
  const paint=s=>{if(s&&typeof s==='object'){
    const sec=(s.session_seconds|0),t=(s.tabs|0),cs=(s.cores|0),mb=(s.working_set_mb|0);
    const h=(sec/3600)|0,m=((sec%3600)/60)|0;
    const time=document.getElementById('sessionTime');if(time)time.textContent=h?`${h} ч ${m} мин`:m?`${m} мин`:(sec?`${sec} с`:'—');
    const tabs=document.getElementById('sessionTabs');if(tabs)tabs.textContent=t||'—';
    const cores=document.getElementById('systemCores');if(cores)cores.textContent=cs||'—';
    const net=document.getElementById('networkState');if(net)net.textContent=(s.network===null||s.network===undefined)?'Online':String(s.network);
    document.getElementById('systemRam')?.textContent ? document.getElementById('systemRam').textContent = (mb||'—')+' МБ' : 0;
  }};
  const av=window.__TAURI__&&window.__TAURI__.core?window.__TAURI__.core.invoke.bind(window.__TAURI__.core):null;
  const tick=async()=>{if(!av)return;try{paint(await av('session_stats'))}catch(e){}};
  tick();setInterval(tick,2000);
})();
