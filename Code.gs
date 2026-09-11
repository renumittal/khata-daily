const SPREADSHEET_ID = '1GiL6u7h5uzf1IkL_1XYQQCxXROmyizHPMGhwU2RabIM';
const PEOPLE_SHEET_NAME = 'People';
const TRANSACTIONS_SHEET_NAME = 'Detail Transaction';
const COMMITTEES_SHEET_NAME = 'Committees';
const COMMITTEE_INSTALMENTS_SHEET_NAME = 'Committee Instalments';
const COMMITTEE_MONTHS_SHEET_NAME = 'Committee Months';

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
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Date', 'Type', 'Person', 'Category', 'Amount', 'Note', 'Entry ID', 'Created At', 'Verified']);
  } else if (!String(sheet.getRange(1, 9).getValue() || '').trim()) {
    sheet.getRange(1, 9).setValue('Verified');
  }
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

function toDateString(value, timeZone) {
  if (value instanceof Date) return Utilities.formatDate(value, timeZone, 'yyyy-MM-dd');
  return String(value || '').slice(0, 10);
}

function toIsoString(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value || '');
}

function readTransactions() {
  const sheet = getTransactionsSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const timeZone = getSpreadsheet().getSpreadsheetTimeZone();
  const values = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  return values
    .filter((row) => row[6])
    .map((row) => ({
      date: toDateString(row[0], timeZone),
      type: String(row[1] || ''),
      person: String(row[2] || ''),
      category: String(row[3] || ''),
      amount: Number(row[4]) || 0,
      note: String(row[5] || ''),
      id: String(row[6]),
      createdAt: toIsoString(row[7]),
      verified: String(row[8] || '').trim().toLowerCase() === 'yes',
    }));
}

function readUnverifiedTransactions() {
  return readTransactions().filter((entry) => !entry.verified);
}

// Maps Entry ID (column G) to its sheet row number, for targeted updates.
function mapTransactionRowsById(sheet) {
  const lastRow = sheet.getLastRow();
  const map = new Map();
  if (lastRow < 2) return map;
  const ids = sheet.getRange(2, 7, lastRow - 1, 1).getValues();
  ids.forEach((row, index) => {
    const id = String(row[0] || '');
    if (id) map.set(id, index + 2);
  });
  return map;
}

// Applies corrected fields (if any) to each transaction and flags it Verified in the sheet.
function verifyTransactions(updates) {
  const sheet = getTransactionsSheet();
  const rowsById = mapTransactionRowsById(sheet);
  return updates.map((update) => {
    const row = rowsById.get(String(update.id));
    if (!row) return { id: update.id, ok: false };
    sheet.getRange(row, 1, 1, 6).setValues([[
      update.date, update.type, update.person, update.category || '', Number(update.amount), update.note || '',
    ]]);
    sheet.getRange(row, 9).setValue('yes');
    return { id: update.id, ok: true };
  });
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

  if (params.action === 'transactions') {
    return respond(e, { ok: true, transactions: readTransactions() });
  }

  if (params.action === 'unverified') {
    return respond(e, { ok: true, transactions: readUnverifiedTransactions() });
  }

  if (params.action === 'verify') {
    try {
      const updates = JSON.parse(params.updates || '[]');
      const results = verifyTransactions(updates);
      return respond(e, { ok: true, results });
    } catch (error) {
      return respond(e, { ok: false, error: String(error) });
    }
  }

  if (params.action === 'allPeople') {
    const rows = readPeopleRows().sort((a, b) => a.name.localeCompare(b.name));
    return respond(e, { ok: true, people: rows.map((entry) => ({ name: entry.name, active: entry.active })) });
  }

  if (params.action === 'committees') {
    return respond(e, { ok: true, committees: readCommittees_() });
  }

  if (params.action === 'addCommittee') {
    try {
      addCommittee_(params);
      return respond(e, { ok: true });
    } catch (error) {
      return respond(e, { ok: false, error: String(error) });
    }
  }

  if (params.action === 'committeeInstalments') {
    return respond(e, { ok: true, instalments: readCommitteeInstalments_(params.no) });
  }

  if (params.action === 'saveCommitteeInstalment') {
    try {
      saveCommitteeInstalment_(params);
      return respond(e, { ok: true });
    } catch (error) {
      return respond(e, { ok: false, error: String(error) });
    }
  }

  if (params.action === 'committeeMonths') {
    return respond(e, { ok: true, months: readCommitteeMonths_(params.no) });
  }

  if (params.action === 'committeeAnalysis') {
    return respond(e, {
      ok: true,
      committees: readCommittees_(),
      instalments: readCommitteeInstalments_(),
      months: readAllCommitteeMonths_(),
    });
  }

  if (params.action === 'saveCommitteeMonth') {
    try {
      const result = saveCommitteeMonth_(params);
      return respond(e, result);
    } catch (error) {
      return respond(e, { ok: false, error: String(error) });
    }
  }

  if (params.action === 'calendarMonth') {
    try {
      return respond(e, { ok: true, rows: readCalendarMonth_(params.month) });
    } catch (error) {
      return respond(e, { ok: false, error: String(error) });
    }
  }

  if (params.action === 'unverifiedCommitteeMonths') {
    return respond(e, { ok: true, months: readAllUnverifiedCommitteeMonths_() });
  }

  if (params.action === 'verifyCommitteeMonths') {
    try {
      const updates = JSON.parse(params.updates || '[]');
      const results = verifyCommitteeMonths_(updates);
      return respond(e, { ok: true, results });
    } catch (error) {
      return respond(e, { ok: false, error: String(error) });
    }
  }

  if (params.action === 'updateCommitteeStartMonth') {
    try {
      updateCommitteeStartMonth_(params.no, params.startMonth);
      return respond(e, { ok: true });
    } catch (error) {
      return respond(e, { ok: false, error: String(error) });
    }
  }

  if (params.action === 'renameInstalmentPerson') {
    try {
      renameInstalmentPerson_(params.no, params.newPerson);
      return respond(e, { ok: true });
    } catch (error) {
      return respond(e, { ok: false, error: String(error) });
    }
  }

  if (params.action === 'personNet') {
    try {
      return respond(e, { ok: true, ...readPersonNet_(params.person) });
    } catch (error) {
      return respond(e, { ok: false, error: String(error) });
    }
  }

  if (params.action === 'refreshCalendarMonths') {
    try {
      const months = String(params.months || '').split(',').map((m) => m.trim()).filter(Boolean);
      months.forEach((m) => refreshCalendarMonthSheet_(m));
      return respond(e, { ok: true });
    } catch (error) {
      return respond(e, { ok: false, error: String(error) });
    }
  }

  const people = [...new Set(readPeopleRows().filter((entry) => entry.active).map((entry) => entry.name))].sort();
  return respond(e, { ok: true, people });
}
