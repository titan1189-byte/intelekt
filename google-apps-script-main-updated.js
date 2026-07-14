// ============================================================
// ЗАГАЛЬНІ НАЛАШТУВАННЯ
// ============================================================
const GENERAL = {
  ARCHIVE_SHEET:      'Архів',
  ARCHIVE_DATE_COL:   8,   // H — дата втрати
  ARCHIVE_UNIT_COL:   9,   // I — назва підрозділу
  ARCHIVE_START_ROW:  2,
  STATUS_COL:         6,   // F — статус в аркушах підрозділів
  FIRST_DATA_ROW:     3,
  TOTAL_COLS:         7,   // A:G
  PERIOD_CELL:        'F1',

  // Аркуш зведеної інформації
  SUMMARY_SHEET:      'Зведена інформація',
  SUMMARY_FIRST_ROW:  3,   // рядок старту зведеної

  // Підсвічування в основній таблиці
  HIGHLIGHT_SS_URL:    'https://docs.google.com/spreadsheets/d/1ARWgOhuyFsN96WpJVwCtD4k-Mk0ang0j1l2LHlsMfdg/edit',
  HIGHLIGHT_SHEETS:    ['1РБпАК', '2РБпАК', '1РУБпАК', '2РУБпАК', 'НРК'],
  HIGHLIGHT_NAME_COL:  2,  // B
  HIGHLIGHT_SN_COL:    3,  // C
  HIGHLIGHT_FIRST_ROW: 2,
  COLOR_REPAIR:        '#FFCCCC',
  COLOR_DAMAGED:       '#E8CCFF',
};

// ============================================================
// КОНФІГ ПІДРОЗДІЛІВ
// sumStartCol — перша колонка діапазону в аркуші "Зведена інформація"
//   1 РБпАК  → A(1), B(2), C(3)
//   1 РУБпАК → E(5), F(6), G(7)
//   2 РБпАК  → I(9), J(10), K(11)
//   НРК      → M(13), N(14), O(15)
//   2 РУБпАК → Q(17), R(18), S(19)
// ============================================================
const UNITS = [
  {
    name: '1 РБпАК', unit: '1 РБпАК', lostSection: 'Втрачено',
    sumStartCol: 1,  // A
    sectionMap: {
      'На складі підрозділу':  'Справні засоби',
      'ТЗ ТАНГО':              'Справні засоби',
      'ТЗ БРАВО':              'Справні засоби',
      'ТЗ ЕХО':               'Справні засоби',
      'ТЗ Падаван':            'Справні засоби',
      'Ремонт':                'Ремонт',
      'Пошкоджені на позиції': 'Пошкоджені на позиції',
      'Втрачено':              'Втрачено',
    },
  },
  {
    name: '1 РУБпАК', unit: '1 РУБпАК', lostSection: 'Втрачено',
    sumStartCol: 5,  // E
    sectionMap: {
      'На складі підрозділу':  'Справні засоби',
      'ЛХ Сейшели':            'Справні засоби',
      'ТЗ Тайфун':             'Справні засоби',
      'ТЗ Дубаї':              'Справні засоби',
      'ТЗ Торнадо':            'Справні засоби',
      'ТЗ Альфа':              'Справні засоби',
      'ТЗ Міраж':              'Справні засоби',
      'Ремонт':                'Ремонт',
      'Пошкоджені на позиції': 'Пошкоджені на позиції',
      'Втрачено':              'Втрачено',
    },
  },
  {
    name: '2 РБпАК', unit: '2 РБпАК', lostSection: 'Втрачено',
    sumStartCol: 9,  // I
    sectionMap: {
      'На складі підрозділу':  'Справні засоби',
      'ТЗ Ямайка':             'Справні засоби',
      'ТЗ Гаїті':              'Справні засоби',
      'Ремонт':                'Ремонт',
      'Пошкоджені на позиції': 'Пошкоджені на позиції',
      'Втрачено':              'Втрачено',
    },
  },
  {
    name: 'НРК', unit: 'НРК', lostSection: 'Втрачено',
    sumStartCol: 13, // M
    sectionMap: {
      'На складі підрозділу':  'Справні засоби',
      'ПУРК Кариби':           'Справні засоби',
      'ЛХ Сейшели':            'Справні засоби',
      'Ремонт':                'Ремонт',
      'Пошкоджені на позиції': 'Пошкоджені на позиції',
      'Втрачено':              'Втрачено',
    },
  },
  {
    name: '2 РУБпАК', unit: '2 РУБпАК', lostSection: 'Втрачено',
    sumStartCol: 17, // Q
    sectionMap: {
      'На складі підрозділу':  'Справні засоби',
      'Склад РМ':              'Справні засоби',
      'Чпокер':                'Справні засоби',
      'Кальмар':               'Справні засоби',
      'Канонір':               'Справні засоби',
      'Бурса':                 'Справні засоби',
      'Кобзар':                'Справні засоби',
      'ЛХ Сейшели':            'Справні засоби',
      'Ремонт':                'Ремонт',
      'Пошкоджені на позиції': 'Пошкоджені на позиції',
      'Втрачено':              'Втрачено',
    },
  },
  {
    name: 'Грек', unit: 'Грек', lostSection: 'Втрачено',
    sumStartCol: 21, // U
    sectionMap: {
      'На складі підрозділу':  'Справні засоби',
      'ПУРК Мінотавр':           'Справні засоби',
      'ПУРК Геркулес':            'Справні засоби',
      'ЛХ Ровер':            'Справні засоби',
      'ЛХ Геліос':            'Справні засоби',
      'ПУРК Монако':            'Справні засоби',
      'Ремонт':                'Ремонт',
      'Пошкоджені на позиції': 'Пошкоджені на позиції',
      'Втрачено':              'Втрачено',
    },
  },
];

// ============================================================
// МЕНЮ
// ============================================================
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const items = [
    ['Грек',     'оновитиМеню_Грек',     'очиститиВтрати_Грек',     'надіслатиЗвіт_Грек'],
    ['1 РБпАК',  'оновитиМеню_1РБпАК',  'очиститиВтрати_1РБпАК',  'надіслатиЗвіт_1РБпАК'],
    ['1 РУБпАК', 'оновитиМеню_1РУБпАК', 'очиститиВтрати_1РУБпАК', 'надіслатиЗвіт_1РУБпАК'],
    ['2 РБпАК',  'оновитиМеню_2РБпАК',  'очиститиВтрати_2РБпАК',  'надіслатиЗвіт_2РБпАК'],
    ['НРК',      'оновитиМеню_НРК',      'очиститиВтрати_НРК',      'надіслатиЗвіт_НРК'],
    ['2 РУБпАК', 'оновитиМеню_2РУБпАК', 'очиститиВтрати_2РУБпАК', 'надіслатиЗвіт_2РУБпАК'],
    
  ];
  for (const [name, m1, m3, m4] of items) {
    ui.createMenu(name)
      .addItem('Оновити меню статусів',     m1)
      .addSeparator()
      .addItem('Очищення втрат (вручну)',    m3)
      .addSeparator()
      .addItem('Надіслати звіт у WhatsApp', m4)
      .addToUi();
  }
  ui.createMenu('Службові функції')
    .addItem('Оновити всі зведені інформації', 'оновитиВсіЗведені')
    .addSeparator()
    .addItem('Оновити підсвічування в основній таблиці', 'підсвітитиВОсновній')
    .addToUi();
}

// ============================================================
// ІМЕНОВАНІ ОБГОРТКИ ДЛЯ МЕНЮ
// ============================================================
function оновитиМеню_1РБпАК()    { оновитиМеню_(UNITS[0]); }
function оновитиМеню_1РУБпАК()   { оновитиМеню_(UNITS[1]); }
function оновитиМеню_2РБпАК()    { оновитиМеню_(UNITS[2]); }
function оновитиМеню_НРК()        { оновитиМеню_(UNITS[3]); }
function оновитиМеню_2РУБпАК()   { оновитиМеню_(UNITS[4]); }
function оновитиМеню_Грек()       { оновитиМеню_(UNITS[5]); }

function оновитиЗведену_1РБпАК()  { оновитиЗведену_(UNITS[0]); }
function оновитиЗведену_1РУБпАК() { оновитиЗведену_(UNITS[1]); }
function оновитиЗведену_2РБпАК()  { оновитиЗведену_(UNITS[2]); }
function оновитиЗведену_НРК()      { оновитиЗведену_(UNITS[3]); }
function оновитиЗведену_2РУБпАК() { оновитиЗведену_(UNITS[4]); }
function оновитиЗведену_Грек()     { оновитиЗведену_(UNITS[5]); }

function очиститиВтрати_1РБпАК()  { очиститиВтрати_(UNITS[0]); }
function очиститиВтрати_1РУБпАК() { очиститиВтрати_(UNITS[1]); }
function очиститиВтрати_2РБпАК()  { очиститиВтрати_(UNITS[2]); }
function очиститиВтрати_НРК()      { очиститиВтрати_(UNITS[3]); }
function очиститиВтрати_2РУБпАК() { очиститиВтрати_(UNITS[4]); }
function очиститиВтрати_Грек()     { очиститиВтрати_(UNITS[5]); }

function надіслатиЗвіт_1РБпАК()  { надіслатиЗвіт_(UNITS[0]); }
function надіслатиЗвіт_1РУБпАК() { надіслатиЗвіт_(UNITS[1]); }
function надіслатиЗвіт_2РБпАК()  { надіслатиЗвіт_(UNITS[2]); }
function надіслатиЗвіт_НРК()      { надіслатиЗвіт_(UNITS[3]); }
function надіслатиЗвіт_2РУБпАК() { надіслатиЗвіт_(UNITS[4]); }
function надіслатиЗвіт_Грек()     { надіслатиЗвіт_(UNITS[5]); }

// ============================================================
// onEdit — перенос рядка між секціями
// ============================================================
function onEdit(e) {
  try {
    const sheet = e.range.getSheet();
    const unit = UNITS.find(u => u.name === sheet.getName());
    if (!unit) return;

    const col = e.range.getColumn();
    const row = e.range.getRow();

    // БЛОК 1: Заповнення B/C/D → спадне меню в F
    if (col >= 2 && col <= 4) {
      if (!e.value || !e.value.toString().trim()) return;
      const sections = getSections_(sheet);
      if (!getSectionForRow_(row, sections)) return;
      if (sheet.getRange(row, GENERAL.STATUS_COL).getDataValidation()) return;
      setDropdownForRow_(sheet, row, sections);
      return;
    }

    // БЛОК 2: Зміна статусу → перенос рядка
    if (col !== GENERAL.STATUS_COL) return;
    const newStatus = (e.value || '').toString().trim();
    if (!newStatus) return;

    const sections = getSections_(sheet);
    const currentSection = getSectionForRow_(row, sections);
    if (!currentSection || newStatus === currentSection.name.trim()) return;

    const targetSection = sections.find(s => s.name.trim() === newStatus);
    if (!targetSection) return;

    const rowData    = sheet.getRange(row, 1, 1, GENERAL.TOTAL_COLS).getValues()[0];
    const validation = sheet.getRange(row, GENERAL.STATUS_COL).getDataValidation();
    const prevName   = currentSection.name;

    sheet.deleteRow(row);

    const sectionsAfter = getSections_(sheet);
    const updTarget = sectionsAfter.find(s => s.name.trim() === newStatus);
    if (!updTarget) return;

    const insertRow = updTarget.endRow;
    sheet.insertRowBefore(insertRow);

    rowData[GENERAL.STATUS_COL - 1] = newStatus;
    const insertRange = sheet.getRange(insertRow, 1, 1, GENERAL.TOTAL_COLS);
    insertRange.setValues([rowData]);
    insertRange.setBackground(null);

    sheet.getRange(insertRow, GENERAL.STATUS_COL)
      .setDataValidation(validation || buildValidationRule_(sectionsAfter));

    renumberSection_(sheet, prevName);
    renumberSection_(sheet, newStatus);

  } catch (err) {
    Logger.log('onEdit error: ' + err.message);
  }
}

// ============================================================
// ОНОВИТИ МЕНЮ СТАТУСІВ — пакетна валідація
// ============================================================
function оновитиМеню_(unit) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(unit.name);
  if (!sheet) return;

  const sections = getSections_(sheet);
  if (!sections.length) return;

  const rule    = buildValidationRule_(sections);
  const lastRow = sheet.getLastRow();
  const allData = sheet.getRange(
    GENERAL.FIRST_DATA_ROW, 1,
    lastRow - GENERAL.FIRST_DATA_ROW + 1, GENERAL.TOTAL_COLS
  ).getValues();

  for (const sec of sections) {
    for (let row = sec.startRow; row < sec.endRow; row++) {
      const i  = row - GENERAL.FIRST_DATA_ROW;
      const rd = allData[i];
      if (!rd || (!rd[1] && !rd[2] && !rd[3])) continue;
      sheet.getRange(row, GENERAL.STATUS_COL).setDataValidation(rule);
    }
  }
  Logger.log('Меню оновлено: ' + unit.name);
}

// ============================================================
// ОНОВИТИ ЗВЕДЕНУ ІНФОРМАЦІЮ ОДНОГО ПІДРОЗДІЛУ
// Читає аркуш підрозділу, агрегує, пише в аркуш
// "Зведена інформація" в діапазон unit.sumStartCol : +2
// Третя колонка (sumStartCol+2) — сума qty секції (підсумок)
// ============================================================
function оновитиЗведену_(unit) {
  const ss         = SpreadsheetApp.getActiveSpreadsheet();
  const unitSheet  = ss.getSheetByName(unit.name);
  const sumSheet   = ss.getSheetByName(GENERAL.SUMMARY_SHEET);
  if (!unitSheet || !sumSheet) {
    Logger.log('Не знайдено аркуш: ' + unit.name + ' або ' + GENERAL.SUMMARY_SHEET);
    return;
  }

  const lastRowUnit = unitSheet.getLastRow();
  if (lastRowUnit < GENERAL.FIRST_DATA_ROW) return;

  // --- КРОК 1: Читаємо аркуш підрозділу ОДНИМ запитом ---
  const allData = unitSheet.getRange(
    GENERAL.FIRST_DATA_ROW, 1,
    lastRowUnit - GENERAL.FIRST_DATA_ROW + 1, GENERAL.TOTAL_COLS
  ).getValues();

  // Агрегуємо: { 'Справні засоби': { 'Мавік 3': 5 }, ... }
  const grouped = {};
  let currentGroup = null;

  for (const row of allData) {
    const cellA = row[0] ? row[0].toString().trim() : '';
    const cellB = row[1] ? row[1].toString().trim() : '';
    if (cellA && !cellB) {
      currentGroup = unit.sectionMap[cellA] || null;
      continue;
    }
    if (!currentGroup || !cellB) continue;
    const qty = Number(row[3]) || 0;
    if (!grouped[currentGroup]) grouped[currentGroup] = {};
    grouped[currentGroup][cellB] = (grouped[currentGroup][cellB] || 0) + qty;
  }

  // --- КРОК 2: Читаємо розмежовувачі зі зведеної (перша колонка діапазону підрозділу) ---
  const colNum  = unit.sumStartCol;      // №
  const colName = unit.sumStartCol + 1;  // Назва
  const colQty  = unit.sumStartCol + 2;  // К-сть + підсумок секції

  // Використовуємо getMaxRows() щоб охопити всі рядки включно з порожніми
  // (важливо для останньої секції як "Втрачено" — під нею може не бути даних)
  const lastRowSum  = sumSheet.getLastRow();
  const maxRowSum   = sumSheet.getMaxRows();
  if (lastRowSum < GENERAL.SUMMARY_FIRST_ROW) return;

  const sumRowCount = maxRowSum - GENERAL.SUMMARY_FIRST_ROW + 1;
  // Читаємо 3 колонки діапазону підрозділу в зведеній ОДНИМ запитом
  const sumData = sumSheet.getRange(
    GENERAL.SUMMARY_FIRST_ROW, colNum, sumRowCount, 3
  ).getValues();

  // Знаходимо заголовки секцій (перша колонка непорожня, друга порожня)
  const sumHeaders = [];
  for (let i = 0; i < sumData.length; i++) {
    const c1 = sumData[i][0] ? sumData[i][0].toString().trim() : '';
    const c2 = sumData[i][1] ? sumData[i][1].toString().trim() : '';
    if (c1 && !c2) {
      sumHeaders.push({ name: c1, headerRow: i + GENERAL.SUMMARY_FIRST_ROW });
    }
  }
  if (!sumHeaders.length) {
    Logger.log('Зведена: розмежовувачі не знайдено для ' + unit.name);
    return;
  }

  // --- КРОК 3: Будуємо матрицю і пишемо ОДНИМ setValues на секцію ---
  for (let h = 0; h < sumHeaders.length; h++) {
    const header     = sumHeaders[h];
    const dataStart  = header.headerRow + 1;
    const sectionEnd = h + 1 < sumHeaders.length
      ? sumHeaders[h + 1].headerRow
      : maxRowSum + 1;
    const available  = sectionEnd - dataStart;
    if (available <= 0) continue;

    const items    = grouped[header.name] ? Object.entries(grouped[header.name]) : [];
    const secTotal = items.reduce((sum, [, qty]) => sum + qty, 0);

    // Записуємо підсумок секції в третю колонку рядка-розмежовувача
    // (рядок header.headerRow, колонка colQty)
    sumSheet.getRange(header.headerRow, colQty).setValue(secTotal || '');

    // Будуємо матрицю рядків даних (available × 3)
    const writeMatrix = [];
    for (let i = 0; i < available; i++) {
      if (i < items.length) {
        const [name, qty] = items[i];
        writeMatrix.push([i + 1, name, qty]);
      } else {
        writeMatrix.push(['', '', '']);
      }
    }

    // Один setValues замість available × 3 викликів
    sumSheet.getRange(dataStart, colNum, available, 3).setValues(writeMatrix);

    if (items.length > available) {
      Logger.log('Увага [' + unit.name + ']: "' + header.name + '" — ' +
        items.length + ' позицій, лише ' + available + ' рядків у зведеній.');
    }
  }

  Logger.log('Зведену оновлено [' + unit.name + ']: ' + new Date());
}

// ============================================================
// ОНОВИТИ ВСІ ЗВЕДЕНІ — один виклик для тригера за часом
// ============================================================
function оновитиВсіЗведені() {
  for (const unit of UNITS) {
    оновитиЗведену_(unit);
  }
  Logger.log('Всі зведені оновлено: ' + new Date());
}

// ============================================================
// ОЧИЩЕННЯ ВТРАТ → АРХІВ — пакетний запис
// ============================================================
function очиститиВтрати_(unit) {
  const ss           = SpreadsheetApp.getActiveSpreadsheet();
  const sheet        = ss.getSheetByName(unit.name);
  const archiveSheet = ss.getSheetByName(GENERAL.ARCHIVE_SHEET);
  if (!sheet || !archiveSheet) return;

  const sections    = getSections_(sheet);
  const lostSection = sections.find(s => s.name.trim() === unit.lostSection);
  if (!lostSection) return;

  const secRowCount = lostSection.endRow - lostSection.startRow;
  if (secRowCount <= 0) return;

  // Читаємо секцію ОДНИМ запитом
  const secData = sheet.getRange(
    lostSection.startRow, 1, secRowCount, GENERAL.TOTAL_COLS
  ).getValues();

  const rowsToArchive = secData.filter(rd => rd[1] || rd[2] || rd[3]);
  if (!rowsToArchive.length) {
    Logger.log('[' + unit.name + '] Секція втрат порожня');
    return;
  }

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy');
  const n     = rowsToArchive.length;

  // Вставляємо рядки і пишемо пакетно
  archiveSheet.insertRowsAfter(GENERAL.ARCHIVE_START_ROW - 1, n);
  archiveSheet.getRange(GENERAL.ARCHIVE_START_ROW, 1, n, GENERAL.TOTAL_COLS).setValues(rowsToArchive);
  archiveSheet.getRange(GENERAL.ARCHIVE_START_ROW, GENERAL.ARCHIVE_DATE_COL, n, 1)
    .setValues(rowsToArchive.map(() => [today]));
  archiveSheet.getRange(GENERAL.ARCHIVE_START_ROW, GENERAL.ARCHIVE_UNIT_COL, n, 1)
    .setValues(rowsToArchive.map(() => [unit.name]));

  // Видаляємо рядки знизу вгору
  for (let row = lostSection.endRow - 1; row >= lostSection.startRow; row--) {
    sheet.deleteRow(row);
  }

  Logger.log('[' + unit.name + '] Архів: ' + n + ' записів, ' + today);
}

// ============================================================
// НАДІСЛАТИ ЗВІТ У WHATSAPP
// Читає зведену з аркуша "Зведена інформація" для підрозділу
// ============================================================
function запитатиПеріодЗвіту_(defaultPeriod) {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'Період звіту',
    'Вкажіть час, який буде прописано в звіті. Наприклад: 16:00-09:00',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return null;

  const period = response.getResponseText().toString().trim();
  return period || defaultPeriod || '';
}

function сформуватиТекстWhatsAppЗвіту_(unitName, period, sections) {
  const labels = {
    'Справні засоби': '✅ НА СКЛАДІ / СПРАВНІ',
    'Ремонт': '🛠 РЕМОНТ',
    'Пошкоджені на позиції': '⚠️ ПОШКОДЖЕНІ НА ПОЗИЦІЇ',
    'Втрачено': '❌ ВТРАЧЕНО',
  };

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy');
  const dateLine = period ? today + ', ' + period : today;
  const lines = [
    '📋 ЗВІТ: ' + unitName,
    '🕒 Період: ' + dateLine,
    '',
    '━━━━━━━━━━━━━━━━',
  ];

  for (const section of sections) {
    lines.push('', labels[section.name] || section.name.toString().toUpperCase());

    if (!section.items.length) {
      lines.push('• немає');
      continue;
    }

    for (const item of section.items) {
      lines.push('• ' + item.name + ' — ' + item.qty + ' шт');
    }
    lines.push('Разом: ' + section.total + ' шт');
  }

  lines.push(
    '',
    '━━━━━━━━━━━━━━━━',
    '',
    '© 2025 Корпорація Інтелект. Всі права захищені.'
  );

  return lines.join('\n');
}

function надіслатиЗвіт_(unit) {
  const ss       = SpreadsheetApp.getActiveSpreadsheet();
  const unitSheet = ss.getSheetByName(unit.name);
  const sumSheet  = ss.getSheetByName(GENERAL.SUMMARY_SHEET);
  if (!unitSheet || !sumSheet) return;

  const colNum  = unit.sumStartCol;
  const lastRow = sumSheet.getLastRow();
  if (lastRow < GENERAL.SUMMARY_FIRST_ROW) {
    SpreadsheetApp.getUi().alert('Зведена порожня для ' + unit.name);
    return;
  }

  // Читаємо діапазон підрозділу в зведеній ОДНИМ запитом
  const sumData = sumSheet.getRange(
    GENERAL.SUMMARY_FIRST_ROW, colNum,
    lastRow - GENERAL.SUMMARY_FIRST_ROW + 1, 3
  ).getValues();

  // Читаємо часовий діапазон з F1 аркуша підрозділу
  const defaultPeriod = unitSheet.getRange(GENERAL.PERIOD_CELL).getValue().toString().trim();
  const period = запитатиПеріодЗвіту_(defaultPeriod);
  if (period === null) return;

  // Парсимо секції в пам'яті
  const sections = [];
  let cur = null;
  for (const row of sumData) {
    const c1 = row[0] ? row[0].toString().trim() : '';
    const c2 = row[1] ? row[1].toString().trim() : '';
    if (c1 && !c2) {
      cur = { name: c1, items: [], total: 0 };
      sections.push(cur);
    } else if (cur && c2) {
      const qty = Number(row[2]) || 0;
      cur.items.push({ name: c2, qty });
      cur.total += qty;
    }
  }

  if (!sections.length) {
    SpreadsheetApp.getUi().alert('Зведена порожня для ' + unit.name);
    return;
  }

  const text = сформуватиТекстWhatsAppЗвіту_(unit.unit, period, sections);

  const url  = 'https://wa.me/?text=' + encodeURIComponent(text);
  const html = HtmlService.createHtmlOutput(
    '<script>window.open("' + url + '","_blank");google.script.host.close();</script>'
  ).setWidth(10).setHeight(10);
  SpreadsheetApp.getUi().showModalDialog(html, 'Відкриваємо WhatsApp...');

  // Після відправки — архівуємо втрати цього підрозділу
  очиститиВтрати_(unit);
}

// ============================================================
// ПІДСВІЧУВАННЯ В ОСНОВНІЙ ТАБЛИЦІ
// ============================================================
function підсвітитиВОсновній() {
  try {
    if (!GENERAL.HIGHLIGHT_SS_URL || !GENERAL.HIGHLIGHT_SS_URL.trim()) {
      Logger.log('підсвічування: HIGHLIGHT_SS_URL не вказано');
      return;
    }

    const ss       = SpreadsheetApp.getActiveSpreadsheet();
    const colorMap = {}; // "назва|||сн" → колір або null

    // Читаємо всі підрозділи — по одному getValues на аркуш
    for (const unit of UNITS) {
      const sheet = ss.getSheetByName(unit.name);
      if (!sheet) continue;

      const lastRow = sheet.getLastRow();
      if (lastRow < GENERAL.FIRST_DATA_ROW) continue;

      const allData = sheet.getRange(
        GENERAL.FIRST_DATA_ROW, 1,
        lastRow - GENERAL.FIRST_DATA_ROW + 1, GENERAL.TOTAL_COLS
      ).getValues();

      let color = null;
      for (const row of allData) {
        const cellA = row[0] ? row[0].toString().trim() : '';
        const cellB = row[1] ? row[1].toString().trim() : '';
        if (cellA && !cellB) {
          color = cellA === 'Ремонт'                ? GENERAL.COLOR_REPAIR
                : cellA === 'Пошкоджені на позиції' ? GENERAL.COLOR_DAMAGED
                : null;
          continue;
        }
        if (!cellB) continue;
        const sn = row[2] ? row[2].toString().trim() : '';
        colorMap[cellB + '|||' + sn] = color;
      }
    }

    if (!Object.keys(colorMap).length) return;

    const targetSS = SpreadsheetApp.openByUrl(GENERAL.HIGHLIGHT_SS_URL);

    for (const sheetName of GENERAL.HIGHLIGHT_SHEETS) {
      const targetSheet = targetSS.getSheetByName(sheetName);
      if (!targetSheet) { Logger.log('Не знайдено: ' + sheetName); continue; }

      const lastRow = targetSheet.getLastRow();
      if (lastRow < GENERAL.HIGHLIGHT_FIRST_ROW) continue;

      const rowCount = lastRow - GENERAL.HIGHLIGHT_FIRST_ROW + 1;
      // Читаємо B:C ОДНИМ запитом
      const data = targetSheet.getRange(
        GENERAL.HIGHLIGHT_FIRST_ROW, GENERAL.HIGHLIGHT_NAME_COL, rowCount, 2
      ).getValues();

      // Змінюємо колір ТІЛЬКИ для збігів
      for (let i = 0; i < data.length; i++) {
        const name = data[i][0] ? data[i][0].toString().trim() : '';
        const sn   = data[i][1] ? data[i][1].toString().trim() : '';
        const key  = name + '|||' + sn;
        if (!(key in colorMap)) continue;
        const absRow = GENERAL.HIGHLIGHT_FIRST_ROW + i;
        targetSheet.getRange(absRow, GENERAL.HIGHLIGHT_NAME_COL).setBackground(colorMap[key]);
        targetSheet.getRange(absRow, GENERAL.HIGHLIGHT_SN_COL).setBackground(colorMap[key]);
      }
      Logger.log('Підсвічено: ' + sheetName);
    }

    Logger.log('Підсвічування оновлено: ' + new Date());
  } catch (err) {
    Logger.log('підсвічування помилка: ' + err.message);
    Logger.log('підсвічування помилка: ' + err.message);
  }
}

// ============================================================
// ДОПОМІЖНІ ФУНКЦІЇ
// ============================================================

// Знайти всі секції аркуша — ОДИН пакетний getValues
function getSections_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < GENERAL.FIRST_DATA_ROW) return [];

  const data = sheet.getRange(
    GENERAL.FIRST_DATA_ROW, 1,
    lastRow - GENERAL.FIRST_DATA_ROW + 1, GENERAL.TOTAL_COLS
  ).getValues();

  const sections = [];
  for (let i = 0; i < data.length; i++) {
    const cellA = data[i][0] ? data[i][0].toString().trim() : '';
    const cellB = data[i][1] ? data[i][1].toString().trim() : '';
    if (cellA && !cellB) {
      sections.push({
        name:      cellA,
        headerRow: i + GENERAL.FIRST_DATA_ROW,
        startRow:  i + GENERAL.FIRST_DATA_ROW + 1,
        endRow:    null,
      });
    }
  }
  for (let i = 0; i < sections.length; i++) {
    sections[i].endRow = i + 1 < sections.length
      ? sections[i + 1].headerRow
      : lastRow + 1;
  }
  return sections;
}

function getSectionForRow_(row, sections) {
  return sections.find(s => row >= s.startRow && row < s.endRow) || null;
}

// Перенумерація — ОДИН getValues + ОДИН setValues
function renumberSection_(sheet, sectionName) {
  const sections = getSections_(sheet);
  const sec = sections.find(s => s.name.trim() === sectionName.trim());
  if (!sec) return;

  const rowCount = sec.endRow - sec.startRow;
  if (rowCount <= 0) return;

  const data = sheet.getRange(sec.startRow, 1, rowCount, GENERAL.TOTAL_COLS).getValues();
  let num = 1;
  const nums = data.map(row => [row[1] || row[2] || row[3] ? num++ : '']);
  sheet.getRange(sec.startRow, 1, rowCount, 1).setValues(nums);
}

function buildValidationRule_(sections) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(sections.map(s => s.name), true)
    .setAllowInvalid(false)
    .build();
}

function setDropdownForRow_(sheet, row, sections) {
  sheet.getRange(row, GENERAL.STATUS_COL).setDataValidation(buildValidationRule_(sections));
}

function doGet(e) {
  return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
}
