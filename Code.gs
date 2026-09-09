const SPREADSHEET_ID = '1cbm9_wLZkvP-6wZvaMolIa9CjL4qqAEy31HI6i6czQ';
const PEOPLE_SHEET_NAME = 'Sheet1';
const TRANSACTIONS_SHEET_NAME = 'Transactions';

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getPeopleSheet() {
  const spreadsheet = getSpreadsheet();
  return spreadsheet.getSheetByName(PEOPLE_SHEET_NAME) || spreadsheet.getSheets()[0];
}

function getTransactionsSheet() {
  const spreadsheet = getSpreadsheet();
  let sheet = spreadsheet.getSheetByName(TRANSACTIONS_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(TRANSACTIONS_SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(['Date', 'Type', 'Person', 'Category', 'Amount', 'Note', 'Entry ID', 'Created At']);
  return sheet;
}

function doPost(request) {
  const data = JSON.parse(request.postData.contents);
  saveTransaction(data);
  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

function saveTransaction(data) {
  const sheet = getTransactionsSheet();
  sheet.appendRow([data.date, data.type, data.person, data.category || '', Number(data.amount), data.note || '', data.id, data.createdAt]);
}

// Sheet1 layout: column A = name (starting row 2, "People" header in A1),
// column B = status ("inactive" hides the person, anything else counts as active).
function readPeopleRows() {
  const sheet = getPeopleSheet();
  const lastRow = sheet ? sheet.getLastRow() : 0;
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  return values
    .map((row, index) => ({ row: index + 2, name: String(row[0] || '').trim(), active: String(row[1] || '').trim().toLowerCase() !== 'inactive' }))
    .filter((entry) => entry.name);
}

function findPersonRow(rows, name) {
  const target = name.trim().toLowerCase();
  return rows.find((entry) => entry.name.toLowerCase() === target);
}

function respond(e, payload) {
  const result = JSON.stringify(payload);
  const callback = e && e.parameter && e.parameter.callback;
  if (callback && /^[A-Za-z_$][\w$]*$/.test(callback)) {
    return ContentService.createTextOutput(`${callback}(${result})`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(result).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const params = (e && e.parameter) || {};

  if (params.action === 'save') {
    try {
      saveTransaction(params);
      return respond(e, { ok: true });
    } catch (error) {
      return respond(e, { ok: false, error: String(error) });
    }
  }

  if (params.action === 'addPerson') {
    const name = String(params.name || '').trim();
    if (!name) return respond(e, { ok: false, error: 'Name required' });
    const sheet = getPeopleSheet();
    const rows = readPeopleRows();
    const existing = findPersonRow(rows, name);
    if (existing) {
      sheet.getRange(existing.row, 2).setValue('');
    } else {
      sheet.appendRow([name, '']);
    }
    return respond(e, { ok: true });
  }

  if (params.action === 'setActive') {
    const name = String(params.name || '').trim();
    const sheet = getPeopleSheet();
    const rows = readPeopleRows();
    const existing = findPersonRow(rows, name);
    if (!existing) return respond(e, { ok: false, error: 'Not found' });
    sheet.getRange(existing.row, 2).setValue(params.active === 'false' ? 'inactive' : '');
    return respond(e, { ok: true });
  }

  if (params.action === 'allPeople') {
    const rows = readPeopleRows().sort((a, b) => a.name.localeCompare(b.name));
    return respond(e, { ok: true, people: rows.map((entry) => ({ name: entry.name, active: entry.active })) });
  }

  const people = [...new Set(readPeopleRows().filter((entry) => entry.active).map((entry) => entry.name))].sort();
  return respond(e, { ok: true, people });
}
