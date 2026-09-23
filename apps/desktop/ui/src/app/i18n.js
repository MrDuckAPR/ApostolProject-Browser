// ---------------------------------------------------------------------
// i18n: язык интерфейса RU/EN. Словарь — источник правды; строки без
// перевода остаются как есть. DOM-режим: переводит статический HTML и
// живые изменения (MutationObserver: новые узлы + title/placeholder).
// Сделано by MrDuck.
// ---------------------------------------------------------------------

const I18N_DICT = {
  // ===================== ОБЩИЕ / ХРОМ =====================
  "Настройки": "Settings",
  "Оформление": "Appearance",
  "Приватность": "Privacy",
  "История": "History",
  "Пароли": "Passwords",
  "Заметки": "Notes",
  "Закладки": "Bookmarks",
  "Искать": "Search",
  "поиск": "search",
  "продолжение": "continue",
  "подсказка": "suggestion",
  "открыть сайт": "open site",
  "Загрузки": "Downloads",
  "Профили": "Profiles",
  "Воркспейсы": "Workspaces",
  "Задачи": "Tasks",
  "Граф": "Graph",
  "Вкладки": "Tabs",
  "Рисование": "Draw",
  "Редактор": "Editor",
  "Просмотр": "View",
  "Погода": "Weather",
  "Календарь": "Calendar",
  "Часы": "Clock",
  "Тема": "Theme",
  "Чёрная тема": "Dark theme",
  "Белая тема": "Light theme",
  "Язык интерфейса": "Interface language",
  "Язык (Language)": "Language",
  "Звуки": "Sounds",
  "Звуки интерфейса (граф, действия)": "Interface sounds (graph, actions)",
  "Персонализация": "Personalization",
  "Профиль оформления": "Appearance profile",
  "Сбросить персонализацию": "Reset personalization",
  "Инструменты": "Tools",
  "Внутренние страницы": "Internal pages",
  "Омнибокс": "Omnibox",
  "Навигация": "Navigation",
  "Очистить поле": "Clear field",
  "Прочее": "Other",

  // ===================== ПЕРСОНАЛИЗАЦИЯ =====================
  "Акцентный цвет": "Accent color",
  "Скругления углов": "Corner radius",
  "Ширина боковой панели": "Sidebar width",
  "Плотность интерфейса": "Interface density",
  "Компактная": "Compact",
  "Обычная": "Normal",
  "Просторная": "Spacious",
  "Анимации": "Animations",
  "Эффект стекла (blur)": "Glass effect (blur)",
  "Прозрачность стекла": "Glass opacity",
  "Расположение вкладок": "Tab position",
  "Слева (боковая панель)": "Left (sidebar)",
  "Сверху (как у всех)": "Top (like everyone)",
  "Сторона боковой панели вкладок": "Tab sidebar side",
  "Сторона панели (закладки/история/заметки)": "Panel side (bookmarks/history/notes)",
  "Слева": "Left",
  "Справа": "Right",
  "Скрыть инструменты слева снизу": "Hide bottom-left tools",
  "Открывать свёрнутую панель при наведении": "Expand collapsed panel on hover",
  "Счётчик вкладок на воркспейсах": "Tab count on workspaces",
  "Шрифт интерфейса": "Interface font",
  "Шрифт": "Font",
  "Системный": "System",
  "Свой шрифт (файл .ttf/.otf/.woff)": "Custom font (.ttf/.otf/.woff file)",
  "Выбрать…": "Choose…",
  "Шрифт заголовков": "Heading font",
  "Как основной": "Same as body",
  "Размер шрифта": "Font size",
  "Своя тема": "Custom theme",
  "Своя тема (переопределяет чёрную/белую)": "Custom theme (overrides dark/light)",
  "Фон интерфейса": "Interface background",
  "Панели и шапки": "Panels and headers",
  "Карточки и списки": "Cards and lists",
  "Наведение и активные": "Hover and active",
  "Границы": "Borders",
  "Текст": "Text",
  "Вторичный текст": "Secondary text",
  "Ссылки и акцент-текст": "Links and accent text",
  "Акцент": "Accent",
  "Ошибки/удаление": "Errors/delete",
  "Применить цвета": "Apply colors",
  "Сбросить": "Reset",
  "Сохранить как…": "Save as…",
  "Загрузить": "Load",
  "Удалить": "Delete",
  "— мои темы —": "— my themes —",
  "Фон интерфейса (весь браузер)": "Background (entire browser)",
  "Цвет фона": "Background color",
  "Затемнение картинки": "Image dimming",
  "Картинка-фон": "Background image",
  "Размещение": "Fit",
  "Растянуть (cover)": "Fill (cover)",
  "Вписать (contain)": "Fit (contain)",
  "Реальный размер": "Actual size",
  "Замостить": "Tile",
  "Размытие (блюр)": "Blur",
  "Только главная (не весь интерфейс)": "Home page only",
  "Сбросить фон": "Reset background",
  "Настройки применяются мгновенно и сохраняются в браузере.":
    "Settings apply instantly and are stored in the browser.",
  "Раскладка настроек": "Settings layout",
  "Два столбца настроек": "Two settings columns",
  "Ширина блоков настроек": "Settings block width",
  "Два столбца раскладывают поля настроек компактнее; ширина блока управляет их шириной.":
    "Two columns pack settings more compactly; block width controls their width.",
  "Выбор чёрной/белой темы, акценты, шрифты, фон и кастомная тема переехали на вкладку «🎨 Оформление».":
    "Dark/light theme, accents, fonts, background and custom theme moved to the «🎨 Appearance» tab.",
  "Потяните, чтобы изменить ширину": "Drag to resize width",
  "Потяните, чтобы изменить ширину панели": "Drag to resize panel width",
  "Потяните — изменить размер": "Drag to resize",

  // ===================== ТУЛБАР / ВКЛАДКИ =====================
  "Поиск…": "Search…",
  "Поиск": "Search",
  "Новый воркспейс": "New workspace",
  "Новая вкладка": "New tab",
  "Новая вкладка (Ctrl+T)": "New tab (Ctrl+T)",
  "Свернуть панель": "Collapse panel",
  "Вернуть боковую панель": "Restore side panel",
  "Назад": "Back",
  "Вперёд": "Forward",
  "Обновить": "Reload",
  "⟳ Обновить страницу": "⟳ Reload page",
  "Перейти": "Go",
  "Поиск или адрес сайта": "Search or site address",
  "Поиск в интернете или адрес сайта": "Search the web or enter address",
  "Разделить экран (сплит)": "Split screen",
  "Свернуть": "Minimize",
  "Развернуть / восстановить": "Maximize / restore",
  "Закрыть": "Close",
  "← Назад": "← Back",
  "→ Вперёд": "→ Forward",
  "↩ История": "↩ History",
  "＋ Новая вкладка": "＋ New tab",
  "Тёмная тема для сайта (если у сайта её нет)":
    "Dark theme for this site (if it lacks one)",
  "Выключить тёмную тему сайта": "Turn off site dark theme",
  "Перевести страницу через ИИ": "Translate page with AI",
  "Клик — перейти, × — закрыть, ПКМ по вкладке — контекстное меню.":
    "Click to open, × to close, right-click a tab for its menu.",
  "Закрыть вкладку": "Close tab",
  "✕ Закрыть вкладку": "✕ Close tab",
  "Закрыть все, кроме этой": "Close others",
  "🧹 Закрыть остальные": "🧹 Close others",
  "⧉ Дублировать": "⧉ Duplicate",
  "📄 Дублировать": "📄 Duplicate",
  "✎ Переименовать": "✎ Rename",
  "Название вкладки:": "Tab name:",
  "⚙ Настройки": "⚙ Settings",
  "⚙ Настройки профиля": "⚙ Profile settings",
  "Закрепить сайт": "Pin site",
  "Открепить": "Unpin",
  "Нужна вторая открытая вкладка для сплита": "Need a second open tab for split",
  "Нужны две открытые вкладки": "Need two open tabs",
  "Воркспейс": "Workspace",

  // ===================== ГЛАВНАЯ =====================
  "Недавние": "Recent",
  "Закреплённые": "Pinned",
  "Показать всё": "Show all",
  "Свежие заметки": "Recent notes",
  "⚙ Настроить виджеты": "⚙ Configure widgets",
  "Скрыть виджет": "Hide widget",
  "Пока нет закладок": "No bookmarks yet",
  "Пока пусто": "Nothing here yet",
  "Сменить город": "Change city",
  "Город для погоды:": "Weather city:",
  "Например: Москва": "e.g. Moscow",
  "Настройте погоду на главной — здесь будет кэш.":
    "Set up weather on the home page — a cache will appear here.",
  "город не найден": "city not found",

  // ===================== ПОГОДА =====================
  "Ясно": "Clear",
  "Преимущ. ясно": "Mostly clear",
  "Малооблачно": "Partly cloudy",
  "Переменная облачность": "Variable cloudiness",
  "Облачно": "Cloudy",
  "Пасмурно": "Overcast",
  "Туман": "Fog",
  "Дождь": "Rain",
  "Морось": "Drizzle",
  "Ливень": "Heavy rain",
  "Ливни": "Showers",
  "Сильные ливни": "Heavy showers",
  "Ледяной дождь": "Freezing rain",
  "Гроза": "Thunderstorm",
  "Гроза с градом": "Thunderstorm with hail",
  "Снег": "Snow",
  "Небольшой снег": "Light snow",
  "Сильный снег": "Heavy snow",
  "Снегопад": "Snowfall",
  "Снежные зёрна": "Snow grains",
  "Изморозь": "Rime",
  "Ветер": "Wind",
  "облачно": "cloudy",
  "облачную": "cloudy",
  "облачный": "cloudy",

  // ===================== ИСТОРИЯ =====================
  "Текущий профиль": "Current profile",
  "Все профили": "All profiles",
  "Чья история показывается": "Whose history is shown",
  "Очистить историю": "Clear history",
  "Очистить историю текущего профиля": "Clear this profile's history",
  "Анонимные профили историю не пишут. Записи сгруппированы по дням.":
    "Anonymous profiles don't keep history. Entries are grouped by day.",
  "Записей пока нет — добавьте первую через форму ниже":
    "No entries yet — add the first one below",
  "Сегодня": "Today",
  "Вчера": "Yesterday",

  // ===================== ПАРОЛИ / СЕЙФ =====================
  "Создать сейф": "Create vault",
  "Сейф не создан": "Vault not created",
  "Разблокировать": "Unlock",
  "Парольная фраза (минимум 8 символов)": "Passphrase (min 8 characters)",
  "Сейф шифрует пароли AES-256-GCM с ключом Argon2id.":
    "The vault encrypts passwords with AES-256-GCM and an Argon2id key.",
  "Данные никогда не покидают этот компьютер.":
    "Data never leaves this computer.",
  "Генератор паролей": "Password generator",
  "Импорт из CSV (Chrome, Firefox, Bitwarden)": "Import from CSV (Chrome, Firefox, Bitwarden)",
  "Экспорт в CSV": "Export to CSV",
  "Название": "Name",
  "Логин": "Login",
  "Пароль": "Password",
  "🔑 Пароль": "🔑 Password",
  "📋 Логин": "📋 Login",
  "👁 Показать": "👁 Show",
  "Пароль скопирован": "Password copied",
  "Логин скопирован": "Login copied",
  "Сейф разблокирован": "Vault unlocked",
  "Сейф заблокирован — введите фразу": "Vault locked — enter the passphrase",
  "Сейф пуст — нечего экспортировать.": "Vault is empty — nothing to export.",
  "Не удалось прочитать файл как CSV.": "Could not read the file as CSV.",
  "Не найдено ни одной записи с названием и паролем.":
    "No entries with a name and password found.",

  // ===================== AI =====================
  "AI-чат": "AI chat",
  "AI-ассистент": "AI assistant",
  "✦ AI-ассистент": "✦ AI assistant",
  "Закрыть чат": "Close chat",
  "Настройка AI": "AI settings",
  "Спросите что-нибудь…  (Enter — отправить)": "Ask anything…  (Enter to send)",
  "Отправить": "Send",
  "Сохранить и начать чат": "Save and start chat",
  "Думаю…": "Thinking…",
  "Добавлять текст активной страницы в запрос": "Attach active page text to queries",
  "ENV-переменная с API-ключом (для облака)": "ENV variable with API key (for cloud)",
  "Ollama (локально)": "Ollama (local)",
  "Модель (llama3.2)": "Model (llama3.2)",
  "host (например 127.0.0.1)": "host (e.g. 127.0.0.1)",
  "порт": "port",
  "локальный": "local",
  "Перевести страницу на:": "Translate page to:",
  "Перевожу…": "Translating…",
  "Страница прочитана, спрашиваю модель…": "Page read, asking the model…",
  "Нет открытой страницы для перевода.": "No open page to translate.",
  "Кратко перескажи страницу ниже.": "Briefly summarize the page below.",
  "Ошибка перевода:": "Translation error:",

  // ===================== ПАЛИТРА / КОМАНДЫ =====================
  "Команда… (Esc — закрыть)": "Command… (Esc to close)",
  "Закрыть подсказки": "Dismiss suggestions",
  "Ничего не найдено": "Nothing found",

  // ===================== ЗАМЕТКИ =====================
  "Имя файла заметки": "Note file name",
  "Имя файла заметки:": "Note file name:",
  "Имя или Папка/Имя (например, Работа/Idea.md)": "Name or Folder/Name (e.g. Work/Idea.md)",
  "Папка/Имя.md": "Folder/Name.md",
  "создаст подпапку": "will create a subfolder",
  "Тег": "Tag",
  "Теги через запятую": "Tags, comma-separated",
  "Открыть заметку": "Open note",
  "Новая заметка": "New note",
  "Название новой заметки:": "New note name:",
  "В заметке нет картинок": "No images in the note",
  "Заметка не открыта": "No note open",
  "Заметка не найдена:": "Note not found:",
  "Заметка удалена": "Note deleted",
  "Заметка переименована": "Note renamed",
  "🗑 Удалить заметку": "🗑 Delete note",
  "📄 Текст из заметки": "📄 Text from note",
  "🏞 Картинки из заметки": "🏞 Images from note",
  "🖼 Картинку с компьютера": "🖼 Image from disk",
  "🌐 Картинку по URL": "🌐 Image by URL",
  "Вставить рисунок в заметку": "Insert drawing into note",
  "Экспорт .md в Загрузки": "Export .md to Downloads",
  "⬇ Экспорт .md": "⬇ Export .md",
  "⚠ Картинка не загрузилась:": "⚠ Image failed to load:",
  "⚠ Не загрузилась:": "⚠ Failed to load:",
  "URL картинки или GIF:": "Image or GIF URL:",
  "Новый URL картинки:": "New image URL:",
  "Новый источник картинки:": "New image source:",
  "Картинка:": "Image:",
  "картинка": "image",
  "Обрабатываю картинку…": "Processing image…",
  "Картинка добавлена ✓": "Image added ✓",
  "Картинка слишком большая даже после сжатия — выберите другую.":
    "Image too large even after compression — pick another.",
  "Не удалось обработать картинку": "Could not process the image",
  "Не удалось прочитать картинку:": "Could not read the image:",
  "Картинка ещё не загрузилась": "Image hasn't loaded yet",
  "Полотно пустое — нарисуйте что-нибудь.": "Canvas is empty — draw something.",
  "Просмотр картинки": "Image viewer",

  // ===================== РЕДАКТОР (меню) =====================
  "Отменить": "Undo",
  "Отменить (Ctrl+Z)": "Undo (Ctrl+Z)",
  "Вернуть": "Redo",
  "Вернуть (Ctrl+Shift+Z)": "Redo (Ctrl+Shift+Z)",
  "Жирный (Ctrl+B)": "Bold (Ctrl+B)",
  "Курсив (Ctrl+I)": "Italic (Ctrl+I)",
  "Зачёркнутый": "Strikethrough",
  "Заголовок 1": "Heading 1",
  "Заголовок 2": "Heading 2",
  "Заголовок 3": "Heading 3",
  "Список": "List",
  "Нумерованный список": "Numbered list",
  "Цитата": "Quote",
  "Блок кода": "Code block",
  "Чекбокс": "Checkbox",
  "Разделитель": "Divider",
  "Таблица": "Table",
  "Ссылка": "Link",
  "Внутренняя ссылка [[…]]": "Internal link [[…]]",
  "∑ Формулы LaTeX": "∑ LaTeX formulas",
  "Шпаргалка: markdown и формулы": "Cheat sheet: markdown and formulas",

  // ===================== РИСОВАНИЕ =====================
  "Толщина": "Thickness",
  "Цвет": "Color",
  "Прямоугольник": "Rectangle",
  "Овал": "Oval",
  "Линия": "Line",
  "Стрелка": "Arrow",
  "Перо": "Pen",
  "Маркер": "Marker",
  "Ластик": "Eraser",
  "Стикер": "Sticker",
  "Текст стикера:": "Sticker text:",
  "✂️ Выделение и удаление": "✂️ Select and delete",
  "⬇ В заметку": "⬇ To note",
  "Закрыть редактор": "Close editor",
  "Редактор: Рисование и Просмотр": "Editor: Draw and View",

  // ===================== ГРАФ =====================
  "Граф знаний": "Knowledge graph",
  "Визуальный граф связей заметок": "Visual graph of note connections",
  "Связи": "Connections",
  "🔗 Связи": "🔗 Connections",
  "🗂 Папки": "🗂 Folders",
  "🖼 Картинки и рисование": "🖼 Images and drawing",
  "Что можно делать в графе": "What you can do in the graph",
  "Клик по заметке": "Click a note",
  "— открыть её в редакторе": "— open it in the editor",
  "Клик по линии": "Click a line",
  "— выбрать связь; ещё клик — удалить, Del — то же": "— select it; click again to delete, Del too",
  "Тянуть выделенное": "Drag selection",
  "— групповой перенос": "— group move",
  "ПКМ / СКМ + тянуть": "RMB / MMB + drag",
  "по фону — панорама": "on empty space — pan",
  "Колесо мыши": "Mouse wheel",
  "— зум": "— zoom",
  "ПКМ + тянуть от фигуры": "RMB + drag from a shape",
  "— провести связь": "— draw a connection",
  "Двойной клик по пустоте": "Double-click empty space",
  "— новая заметка сразу": "— new note right away",
  "2×ЛКМ по фону": "2×LMB on empty space",
  "— меню создания (заметка, текст, картинка)": "— creation menu (note, text, image)",
  "2×ПКМ по фону": "2×RMB on empty space",
  "— сетка, привязка, якоря, физика, стиль линий": "— grid, snapping, anchors, physics, line style",
  "ЛКМ-рамка по фону": "LMB-lasso on empty space",
  "— выделить группу": "— select a group",
  "Одиночный ПКМ по пустоте ничего не открывает": "Single RMB on empty space opens nothing",
  "— снять выделение": "— clear selection",
  "— удалить блоки и линии (заметки-файлы не удаляются)": "— remove blocks and lines (note files stay)",
  "— убрать блоки (заметки останутся)": "— remove blocks (notes remain)",
  "Убрать все блоки и связи (заметки останутся)":
    "Remove all blocks and links (notes remain)",
  "Текст в блоках правится на месте": "Text inside blocks is edited in place",
  "● точка на краю карточки": "● dot on the card edge",
  "— тянуть связь левой кнопкой": "— drag a link with LMB",
  "— отмена и возврат": "— undo and redo",
  "— переложить граф физикой": "— relayout the graph with physics",
  "— попадают в поиск": "— picked up by search",
  "— фильтр заметок, Enter открывает найденную": "— note filter, Enter opens the match",
  "— меню создания": "— creation menu",
  "Настройки графа: сетка, привязка, якоря": "Graph settings: grid, snapping, anchors",
  "Клик ещё раз — убрать все блоки и связи": "Click again — remove all blocks and links",
  "✨ Уложить": "✨ Tidy up",
  "Разово переложить граф физикой": "Relayout graph with physics once",
  "Сохранить граф как PNG в Загрузки": "Save graph as PNG to Downloads",
  "Граф сохранён:": "Graph saved:",
  "Борд не сохранён:": "Board not saved:",
  "Создана копия": "Copy created",
  "Воркспейс продублирован": "Workspace duplicated",
  "Координатная сетка": "Coordinate grid",
  "Сворачивание панели": "Panel collapsing",
  "Прямые": "Straight",
  "Коннекторы всегда видны": "Connectors always visible",
  "Точки соединения плавают по краю блока": "Anchor dots float along block edge",
  "Якорные точки при наведении": "Anchor points on hover",
  "Разводить несколько линий между блоками": "Fan out multiple lines between blocks",
  "Список изменений не указан.": "No changelog provided.",
  "ПКМ по заметке — переименовать/переместить": "RMB on a note — rename/move",

  // ===================== БЛОКИ ГРАФА =====================
  "Блок": "Block",
  "🅣 Блок текста": "🅣 Text block",
  "Текст блока…": "Block text…",
  "Текст:": "Text:",
  "текст": "text",
  "Новая задача:": "New task:",
  "☑ Задачи": "☑ Tasks",
  "Добавить задачу": "Add task",
  "📅 Календарь": "📅 Calendar",
  "🕐 Время": "🕐 Time",
  "🕐 Часы": "🕐 Clock",
  "🌤 Погода": "🌤 Weather",
  "Удалить блок": "Delete block",
  "🔄 Обновить": "🔄 Refresh",
  "🔄 Заменить источник": "🔄 Replace source",
  "Ссылки и связи": "Links and connections",
  "на другую заметку (и в граф)": "to another note (and into the graph)",

  // ===================== ЗАКЛАДКИ =====================
  "+ Добавить закладку": "+ Add bookmark",
  "URL сайта:": "Site URL:",
  "Название:": "Name:",
  "Сохранить запись": "Save entry",
  "Название списка": "List name",
  "Создать": "Create",
  "Удалить список": "Delete list",
  "Список удалён": "List deleted",
  "Мой список": "My list",

  // ===================== СЕЙФ/ПРОФИЛИ =====================
  "Имя профиля": "Profile name",
  "Анонимный (временный, история не сохраняется)": "Anonymous (temporary, no history)",
  "Создать профиль": "Create profile",
  "Новый профиль": "New profile",
  "Новое имя профиля:": "New profile name:",
  "Профиль переименован": "Profile renamed",
  "Профиль удалён": "Profile deleted",
  "🗑 Удалить профиль и все его данные": "🗑 Delete profile and all its data",
  "· анонимный": "· anonymous",
  "история не пишется": "no history kept",
  "история сохраняется": "history kept",

  // ===================== ЗАГРУЗКИ =====================
  "Папка сохранения файлов": "File save folder",
  "По умолчанию — Загрузки Windows": "Default — Windows Downloads",
  "Папка загрузок сохранена": "Downloads folder saved",
  "Возвращено значение по умолчанию": "Reset to default",
  "Возвращено": "Reset",
  "Файлы сохраняются в папку загрузок активного профиля. Кликните по файлу, чтобы открыть папку.":
    "Files go to the active profile's downloads. Click a file to open the folder.",

  // ===================== ОБНОВЛЕНИЯ =====================
  "Обновления": "Updates",
  "Что нового": "What's new",
  "Проверить обновления": "Check for updates",
  "Проверять обновления при запуске": "Check updates on startup",
  "Установлена версия: …": "Installed version: …",
  "Установлена версия:": "Installed version:",
  "Текущая версия:": "Current version:",
  "У вас последняя версия ✅": "You're up to date ✅",
  "Уже последняя версия": "Already up to date",
  "Доступно обновление AP Browser": "AP Browser update available",
  "⬇ Обновить сейчас": "⬇ Update now",
  "⬇ Скачиваю обновление…": "⬇ Downloading update…",
  "✅ Обновление установлено. Перезапуск…": "✅ Update installed. Restarting…",
  "🎉 AP Browser обновлён до": "🎉 AP Browser updated to",
  "Проверяем…": "Checking…",
  "загружается…": "loading…",
  "Автопроверка включена": "Auto-check enabled",
  "Автопроверка выключена": "Auto-check disabled",
  "⚠ Обновления:": "⚠ Updates:",
  "Не удалось открыть настройки Windows.": "Could not open Windows settings.",
  "Ошибка установки": "Installation error",
  "Ошибка установки:": "Installation error:",
  "Ошибка экспорта:": "Export error:",
  "Экспорт не удался:": "Export failed:",

  // ===================== СЕТЬ / ПРИВАТНОСТЬ =====================
  "Сеть и прокси": "Network and proxy",
  "Сохранить настройки сети": "Save network settings",
  "Диагностика сети и маршрут": "Network diagnostics and route",
  "Проверить соединение": "Test connection",
  "Показать маршрут": "Show route",
  "Приватность текущего профиля": "Current profile privacy",
  "Уровень защиты (для текущего профиля)": "Protection level (current profile)",
  "Standard — базовый": "Standard — basic",
  "Balanced — сбалансированный": "Balanced",
  "Strict — строгий": "Strict",
  "Maximum — максимум": "Maximum",
  "Custom — свой": "Custom",
  "Блокировка (переключатели Custom)": "Blocking (Custom switches)",
  "Блокировать рекламу": "Block ads",
  "Блокировать трекеры": "Block trackers",
  "Блокировать fingerprint-скрипты": "Block fingerprinting scripts",
  "Сторонние cookies — блок": "Third-party cookies — blocked",
  "Чистить cookies при выходе": "Clear cookies on exit",
  "HTTPS-only режим": "HTTPS-only mode",
  "WebRTC: включён": "WebRTC: enabled",
  "WebRTC: выключен": "WebRTC: disabled",
  "WebRTC: скрыть публичные IP": "WebRTC: hide public IPs",
  "Свой DNS": "Custom DNS",
  "Системный DNS (незашифрованный)": "System DNS (unencrypted)",
  "Без прокси": "No proxy",
  "Proxy-цепочка (до 3 хопов)": "Proxy chain (up to 3 hops)",
  "Статистика и аудит": "Statistics and audit",
  "Исключения сайтов": "Site exceptions",
  "Домен и все его поддомены исключаются из сетевой блокировки — действует сразу.":
    "The domain and all subdomains are excluded from network blocking — effective immediately.",
  "Укажите домен, например example.com": "Enter a domain, e.g. example.com",
  "Убрать исключение": "Remove exception",
  "Исключение убрано": "Exception removed",
  "в списке исключений": "in exceptions list",
  "Свой список блокировки": "Custom blocklist",
  "+ Добавить список доменов": "+ Add domain list",
  "⟳ Сбросить счётчик блокировок": "⟳ Reset block counter",
  "Настройки сети сохранены": "Network settings saved",
  "Настройки сохранены:": "Settings saved:",
  "Сейф паролей": "Password vault",
  "Fingerprint-панель": "Fingerprint panel",
  "🛡 Приватность": "🛡 Privacy",
  "🛡 Разрешить трекеры": "🛡 Allow trackers",
  "трекеры разрешены": "trackers allowed",
  "🚨 Экстренный режим": "🚨 Emergency mode",
  "🛡 МАКС защита": "🛡 MAX protection",
  "Включён максимальный уровень приватности — клик открывает настройки":
    "Maximum privacy level on — click opens settings",
  "Emergency Privacy Mode включён — клик открывает настройки приватности":
    "Emergency Privacy Mode on — click opens privacy settings",
  "🚨 Emergency Mode ВКЛЮЧЁН — выключить": "🚨 Emergency Mode ON — turn off",
  "Максимальный уровень приватности включён": "Maximum privacy level enabled",
  "включено": "enabled",
  "выключено": "disabled",
  "Включить": "Enable",
  "Выключить": "Disable",
  "Переключиться": "Switch",

  // ===================== ТОСТЫ / ДИАЛОГИ =====================
  "Готово ✓": "Done ✓",
  "Отлично!": "Great!",
  "Загрузка…": "Loading…",
  "Отмена": "Cancel",
  "Позже": "Later",
  "Сохранить": "Save",
  "Открыть": "Open",
  "Сначала откройте вкладку": "Open a tab first",
  "Сначала откройте обе вкладки": "Open both tabs first",
  "Нечего отменять": "Nothing to undo",
  "Нечего возвращать": "Nothing to redo",
  "Поле и так пустое": "Field is already empty",
  "Поле очищено ✓": "Field cleared ✓",
  "Очистить": "Clear",
  "Настройка сохранена": "Setting saved",
  "Настройки применены ✓": "Settings applied ✓",
  "Цвета применены": "Colors applied",
  "Настройки графа сброшены": "Graph settings reset",
  "Сохранено:": "Saved:",
  "Экспортировано:": "Exported:",
  "Файл пуст.": "File is empty.",
  "Ошибка:": "Error:",
  "⚠ Ошибка:": "⚠ Error:",
  "ошибка": "error",
  "неизвестно": "unknown",
  "нет": "no",
  "готово": "done",
  "Не удалось открыть страницу:": "Could not open page:",
  "Не удалось открыть:": "Could not open:",
  "Не удалось прочитать страницу:": "Could not read page:",
  "Не удалось создать связь:": "Could not create link:",
  "Такая связь уже есть": "This link already exists",
  "Связь создана ✓": "Link created ✓",
  "Связь удалена": "Link deleted",
  "Линия выбрана — Del удаляет, клик ещё раз тоже":
    "Line selected — Del deletes, so does another click",
  "Ничего не удалено — выделение устарело, кликни по линии заново":
    "Nothing deleted — selection is stale, click the line again",
  "Файл повреждён или это не .apbtheme.": "File corrupted or not .apbtheme.",
  "Это не файл настроек APB.": "This is not an APB settings file.",
  "Применить настройки из файла? Текущие будут заменены.":
    "Apply settings from file? Current ones will be replaced.",
  "Название темы:": "Theme name:",
  "Моя тема": "My theme",
  "Название нового воркспейса:": "New workspace name:",
  "Имя воркспейса:": "Workspace name:",
  "Удалить воркспейс": "Delete workspace",
  "🗑 Удалить воркспейс": "🗑 Delete workspace",
  "клик — заменить источник": "click — replace source",
  "Право выдано:": "Permission granted:",
  "· права:": "· permissions:",
  "Включён максимальный уровень приватности": "Maximum privacy level enabled",

  // ===================== ПРИВЕТСТВИЯ / ТУР =====================
  "Доброе утро": "Good morning",
  "Добрый день": "Good afternoon",
  "Добрый вечер": "Good evening",
  "Доброй ночи": "Good night",
  "👋 Добро пожаловать в AP Browser": "👋 Welcome to AP Browser",
  "Далее →": "Next →",
  "🎉 Готово! Вы во всём разобрались": "🎉 Done! You've got it all",
  "Тур завершён. Вернуть: Настройки → Оформление → ❓ Подсказки":
    "Tour finished. Replay: Settings → Appearance → ❓ Hints",
  "Спасибо, что пользуетесь AP Browser!": "Thanks for using AP Browser!",
  "❓ Подсказка": "❓ Hint",
  "❓ Подсказки по браузеру": "❓ Browser hints",
  "? Справка": "? Help",
  "🏠 Главная страница": "🏠 Home page",
  "🧭 Навигация": "🧭 Navigation",
  "🔎 Прочее": "🔎 Misc",
  "➕ Создание": "➕ Create",

  // ===================== ПРОЧЕЕ =====================
  "Время": "Time",
  "Размер": "Size",
  "русский": "Russian",
  "без логина": "without login",
  "заметка": "note",
  "тег": "tag",
  "содержит": "contains",
  "пустой текст страницы": "empty page text",
  "не удалось обернуть invoke:": "failed to wrap invoke:",
  "Шрифт «": "Font «",
  "» применён": "» applied",
  "Callout-блок": "Callout block",
  "Настройки провайдера": "Provider settings",
  "Отдалить": "Zoom out",
  "Приблизить": "Zoom in",
  "Пока пусто — добавьте задачу": "Nothing yet — add a task",
};

// ---------------------------------------------------------------------
// Движок
// ---------------------------------------------------------------------

let i18nLang = localStorage.getItem("apb-lang") || "ru";

function t(s) {
  if (i18nLang !== "en") return s;
  return I18N_DICT[s] || s;
}
window.t = t;

function i18nTextNodes(root) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = node.parentElement;
      if (!p || p.closest("script,style,#apbBgLayer")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const out = [];
  let n;
  while ((n = walk.nextNode())) out.push(n);
  return out;
}

// Перевод атрибутов placeholder/title у элемента (и его поддерева)
function i18nApplyAttrs(el) {
  el.querySelectorAll?.("[placeholder],[title]").forEach((e) => i18nAttrsOf(e));
  i18nAttrsOf(el);
}
function i18nAttrsOf(el) {
  const ph = el.getAttribute?.("placeholder");
  if (ph) {
    const tr = I18N_DICT[ph.trim()];
    if (tr) {
      if (el.dataset.phOrig === undefined) el.dataset.phOrig = ph;
      if (ph !== tr) el.setAttribute("placeholder", tr);
    }
  }
  const ti = el.getAttribute?.("title");
  if (ti) {
    const tr = I18N_DICT[ti.trim()];
    if (tr) {
      if (el.dataset.tiOrig === undefined) el.dataset.tiOrig = ti;
      if (ti !== tr) el.setAttribute("title", tr);
    }
  }
}

function i18nApply(root = document.body) {
  if (i18nLang !== "en") return;
  for (const node of i18nTextNodes(root)) {
    const raw = node.nodeValue;
    const key = raw.trim();
    const tr = I18N_DICT[key];
    if (!tr) continue;
    const lead = raw.slice(0, raw.length - raw.trimStart().length);
    const tail = raw.slice(raw.trimEnd().length);
    node.nodeValue = lead + tr + tail;
  }
  i18nApplyAttrs(root);
}

function i18nRestore(root = document.body) {
  // Возврат RU: восстановить оригиналы атрибутов, где меняли.
  root.querySelectorAll?.("[data-ph-orig]").forEach((el) => {
    el.setAttribute("placeholder", el.dataset.phOrig);
    delete el.dataset.phOrig;
  });
  root.querySelectorAll?.("[data-ti-orig]").forEach((el) => {
    el.setAttribute("title", el.dataset.tiOrig);
    delete el.dataset.tiOrig;
  });
}

let i18nObserver = null;
function i18nStart() {
  if (i18nLang !== "en") return;
  document.documentElement.setAttribute("lang", "en");
  i18nApply();
  if (i18nObserver) return;
  i18nObserver = new MutationObserver((muts) => {
    if (i18nLang !== "en") return;
    for (const m of muts) {
      if (m.type === "attributes") {
        // Динамические title/placeholder (тултипы, подсказки) — на лету.
        i18nAttrsOf(m.target);
        continue;
      }
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.id === "apbBgLayer") continue;
        i18nApply(node);
      }
    }
  });
  i18nObserver.observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ["title", "placeholder"],
  });
}

function i18nSet(lang) {
  i18nLang = lang === "en" ? "en" : "ru";
  localStorage.setItem("apb-lang", i18nLang);
  // Полный пересчёт RU↔EN проще всего перезагрузкой страницы
  location.reload();
}

document.getElementById("apLangSel")?.addEventListener("change", (e) => i18nSet(e.target.value));
document.addEventListener("DOMContentLoaded", () => {
  const sel = document.getElementById("apLangSel");
  if (sel) sel.value = i18nLang;
  i18nStart();
});
if (document.readyState === "loading") {
  // скрипт в head-фазе — DOMContentLoaded выше всё сделает
} else {
  i18nStart();
}
