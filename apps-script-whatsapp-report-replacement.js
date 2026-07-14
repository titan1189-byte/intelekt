// Replace the existing "надіслатиЗвіт_(unit)" function in Google Apps Script with this block.
// It keeps the same GENERAL / UNITS configuration and the same "очиститиВтрати_(unit)" call.

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

const ПОЗИЦІЇ_БГ_НАЗВА_ = 'На позиції БГ';
const ПОЗИЦІЇ_БГ_ПРЕФІКСИ_ = ['лх', 'тз', 'пурк'];

function нормалізуватиТекст_(value) {
  return value.toString().replace(/\s+/g, ' ').trim().toLowerCase();
}

function цеРозділПозиційБГ_(sectionName) {
  const value = нормалізуватиТекст_(sectionName || '');
  return ПОЗИЦІЇ_БГ_ПРЕФІКСИ_.some((prefix) => value.indexOf(prefix) === 0);
}

function числоЗвіту_(value) {
  const number = Number(value.toString().replace(/\s+/g, '').replace(',', '.'));
  return isFinite(number) ? number : 0;
}

function текстКількості_(value) {
  return value % 1 === 0 ? value.toString() : value.toString().replace('.', ',');
}

function сформуватиСекціюПозиційБГ_(unitSheet) {
  const totals = {};
  const lastRow = unitSheet.getLastRow();
  if (lastRow < GENERAL.FIRST_DATA_ROW) {
    return { name: ПОЗИЦІЇ_БГ_НАЗВА_, items: [], total: 0 };
  }

  const rows = unitSheet.getRange(1, 1, lastRow, GENERAL.TOTAL_COLS).getValues();
  let currentSection = '';

  for (const row of rows) {
    const nonEmpty = row.map((cell) => cell.toString().trim()).filter(Boolean);
    if (nonEmpty.length === 1) {
      currentSection = nonEmpty[0];
      continue;
    }

    if (!цеРозділПозиційБГ_(currentSection)) continue;

    const name = row[1] ? row[1].toString().trim() : '';
    if (!name || нормалізуватиТекст_(name).indexOf('назва майна') >= 0) continue;

    const qty = числоЗвіту_(row[3] || 1);
    totals[name] = (totals[name] || 0) + qty;
  }

  const items = Object.keys(totals)
    .sort()
    .map((name) => ({ name, qty: totals[name] }));
  const total = items.reduce((sum, item) => sum + item.qty, 0);

  return {
    name: ПОЗИЦІЇ_БГ_НАЗВА_,
    items,
    total
  };
}

function сформуватиТекстWhatsAppЗвіту_(unitName, period, sections) {
  const labels = {
    'Справні засоби': '[СКЛАД] НА СКЛАДІ / СПРАВНІ',
    'Ремонт': '[РЕМОНТ] РЕМОНТ',
    'Пошкоджені на позиції': '[ПОШКОДЖЕНО] ПОШКОДЖЕНІ НА ПОЗИЦІЇ',
    'Втрачено': '[ВТРАЧЕНО] ВТРАЧЕНО',
    [ПОЗИЦІЇ_БГ_НАЗВА_]: '[ПОЗИЦІЇ БГ] НА ПОЗИЦІЇ БГ',
  };

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM.yyyy');
  const dateLine = period ? today + ', ' + period : today;
  const lines = [
    'ЗВІТ: ' + unitName,
    'Період: ' + dateLine,
    '',
    '====================',
  ];

  for (const section of sections) {
    lines.push('', labels[section.name] || section.name.toString().toUpperCase());

    if (!section.items.length) {
      lines.push('• немає');
      continue;
    }

    for (const item of section.items) {
      lines.push('• ' + item.name + ' — ' + текстКількості_(item.qty) + ' шт');
    }
    lines.push('Разом: ' + текстКількості_(section.total) + ' шт');
  }

  lines.push(
    '',
    '====================',
    '',
    '© 2025 Корпорація Інтелект. Всі права захищені.'
  );

  return lines.join('\n');
}

function надіслатиЗвіт_(unit) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const unitSheet = ss.getSheetByName(unit.name);
  const sumSheet = ss.getSheetByName(GENERAL.SUMMARY_SHEET);
  if (!unitSheet || !sumSheet) return;

  const colNum = unit.sumStartCol;
  const lastRow = sumSheet.getLastRow();
  if (lastRow < GENERAL.SUMMARY_FIRST_ROW) {
    SpreadsheetApp.getUi().alert('Зведена порожня для ' + unit.name);
    return;
  }

  const sumData = sumSheet.getRange(
    GENERAL.SUMMARY_FIRST_ROW,
    colNum,
    lastRow - GENERAL.SUMMARY_FIRST_ROW + 1,
    3
  ).getValues();

  const defaultPeriod = unitSheet.getRange(GENERAL.PERIOD_CELL).getValue().toString().trim();
  const period = запитатиПеріодЗвіту_(defaultPeriod);
  if (period === null) return;

  const sections = [];
  let currentSection = null;
  for (const row of sumData) {
    const sectionName = row[0] ? row[0].toString().trim() : '';
    const itemName = row[1] ? row[1].toString().trim() : '';

    if (sectionName && !itemName) {
      currentSection = { name: sectionName, items: [], total: 0 };
      sections.push(currentSection);
      continue;
    }

    if (!currentSection || !itemName) continue;
    const qty = Number(row[2]) || 0;
    currentSection.items.push({ name: itemName, qty });
    currentSection.total += qty;
  }

  if (!sections.length) {
    SpreadsheetApp.getUi().alert('Зведена порожня для ' + unit.name);
    return;
  }

  sections.push(сформуватиСекціюПозиційБГ_(unitSheet));

  const text = сформуватиТекстWhatsAppЗвіту_(unit.unit, period, sections);
  const url = 'https://wa.me/?text=' + encodeURIComponent(text);
  const html = HtmlService.createHtmlOutput(
    '<script>window.open("' + url + '","_blank");google.script.host.close();</script>'
  ).setWidth(10).setHeight(10);

  SpreadsheetApp.getUi().showModalDialog(html, 'Відкриваємо WhatsApp...');
  очиститиВтрати_(unit);
}
