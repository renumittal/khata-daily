const SPREADSHEET_ID = '1cbm9_wLZkvP-6wZvaMolIa9CjL4qqAEy31HI6i6czQ';
const PEOPLE_SHEET_NAME = 'Sheet1';
const TRANSACTIONS_SHEET_NAME = 'Transactions';
const PERSON_COLUMN = 1; // Column A on Sheet1 contains the people names.

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
  const sheet = getPeopleSheet();
  const lastRow = sheet ? sheet.getLastRow() : 0;
  const values = lastRow > 0 ? sheet.getRange(1, PERSON_COLUMN, lastRow, 1).getValues() : [];
  const people = [...new Set(values.flat().map((name) => String(name).trim()).filter((name) => name && !['people', 'person', 'name'].includes(name.toLowerCase())))].sort();
  return respond(e, { ok: true, people });
}
