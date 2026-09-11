/**
 * COMMITTEE (KAMETI) BACKEND — merged into Code.gs
 * ------------------------------------------------
 * This file lives in the SAME Apps Script project as Code.gs and shares its
 * SPREADSHEET_ID, getSpreadsheet(), and respond() helpers, and its single
 * doGet(e) (Apps Script only runs one doGet/doPost per project — the
 * committee actions are dispatched from Code.gs's doGet, not from here).
 *
 * Do not add another doGet/doPost or another SPREADSHEET_ID/getSpreadsheet()
 * to this file — that's exactly the conflict that broke things last time
 * (two doGet definitions silently fight over which one runs, and two
 * `const SPREADSHEET_ID` declarations throw a redeclaration error).
 *
 * Sheets it manages (auto-created on first use, in the Mittal Khata Book spreadsheet):
 *
 * "Committees"
 *   No | TotalMembers | TotalMonths | MonthlyAmount | TotalAmount | CutPercent | ExtraProfit | StartMonth | Status
 *   StartMonth is actually a full YYYY-MM-DD date (the boli day, e.g. "runs the
 *   5th of each month") — kept under its original column name to avoid a sheet
 *   migration, but only its year+month are used for month-index arithmetic.
 *
 * "Committee Instalments"
 *   No | Person | IsTaken | Amount | TakenMonth | KIST | GHATA | Sarkari | Status | PendingMonth
 *
 * "Kameti - <person>" (one sheet per committee, named after its Committee person)
 *   Month | Boli date | Sarkari GHATA | Actual GHATA | KIST/member | Taken by | Amount received
 *   Pre-filled with one row per month of the committee's whole duration as soon
 *   as it's created (Sarkari GHATA only depends on cut% and month position, so
 *   it's known upfront) — this is the "complete picture" of that committee.
 *   Actual GHATA/KIST/Boli date are filled in as each month is saved from the
 *   app. Whichever row's month matches a member's TakenMonth gets that
 *   member's name + the amount they received, highlighted with a background
 *   colour, kept in sync from both saveCommitteeMonth_ and saveCommitteeInstalment_.
 */

// Month fields (StartMonth, TakenMonth) are stored as text, but Google Sheets
// sometimes auto-converts a bare date-looking string into an actual Date cell
// on save — reading that back with a plain String() then prints its full JS
// toString() ("Tue Sep 01 2026 00:00:00 GMT+0530 ..."). Normalize any Date
// cell back to plain text here, and force new writes to stay text via a
// leading apostrophe (asText_) so this doesn't happen again going forward.
function toYearMonthString_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM');
  return String(value || '');
}
function toDateString_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(value || '');
}
function asText_(value) {
  const trimmed = String(value || '').trim();
  return trimmed ? "'" + trimmed : '';
}

function getCommitteesSheet_() {
  const spreadsheet = getSpreadsheet();
  let sheet = spreadsheet.getSheetByName(COMMITTEES_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(COMMITTEES_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['No', 'TotalMembers', 'TotalMonths', 'MonthlyAmount', 'TotalAmount', 'CutPercent', 'ExtraProfit', 'StartMonth', 'Status']);
  }
  return sheet;
}

function getCommitteeInstalmentsSheet_() {
  const spreadsheet = getSpreadsheet();
  let sheet = spreadsheet.getSheetByName(COMMITTEE_INSTALMENTS_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(COMMITTEE_INSTALMENTS_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['No', 'Person', 'IsTaken', 'Amount', 'TakenMonth', 'KIST', 'GHATA', 'Sarkari', 'Status', 'PendingMonth']);
  }
  return sheet;
}

function readCommittees_() {
  const sheet = getCommitteesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  return values
    .filter((row) => String(row[0] || '').trim())
    .map((row) => ({
      no: String(row[0]),
      totalMembers: Number(row[1]) || 0,
      totalMonths: Number(row[2]) || 0,
      monthlyAmount: Number(row[3]) || 0,
      totalAmount: Number(row[4]) || 0,
      cutPercent: Number(row[5]) || 0,
      extraProfit: Number(row[6]) || 0,
      startMonth: toDateString_(row[7]) || toYearMonthString_(row[7]),
      status: String(row[8] || ''),
    }));
}

function addCommittee_(params) {
  const sheet = getCommitteesSheet_();
  const committee = {
    no: String(params.no || '').trim(),
    totalMembers: Number(params.totalMembers) || 0,
    totalMonths: Number(params.totalMonths) || 0,
    monthlyAmount: Number(params.monthlyAmount) || 0,
    totalAmount: Number(params.totalAmount) || 0,
    cutPercent: Number(params.cutPercent) || 0,
    extraProfit: Number(params.extraProfit) || 0,
    startMonth: String(params.startMonth || '').trim(),
    status: params.status || 'Running',
  };
  sheet.appendRow([
    committee.no, committee.totalMembers, committee.totalMonths, committee.monthlyAmount,
    committee.totalAmount, committee.cutPercent, committee.extraProfit, asText_(committee.startMonth), committee.status,
  ]);
  ensureCommitteeMonthRows_(committee);
}

function readCommitteeInstalments_(committeeNo) {
  const sheet = getCommitteeInstalmentsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  return values
    .map((row, index) => ({
      row: index + 2, no: String(row[0] || ''), person: String(row[1] || ''), isTaken: String(row[2] || ''),
      amount: Number(row[3]) || 0, takenMonth: toYearMonthString_(row[4]), kist: Number(row[5]) || 0,
      ghata: Number(row[6]) || 0, sarkari: Number(row[7]) || 0, status: String(row[8] || ''), pendingMonth: String(row[9] || ''),
    }))
    .filter((entry) => entry.person && (!committeeNo || entry.no === String(committeeNo)));
}

// Upserts one member row for a committee, matched by (No, Person).
function saveCommitteeInstalment_(params) {
  const sheet = getCommitteeInstalmentsSheet_();
  const no = String(params.no || '').trim();
  const person = String(params.person || '').trim();
  const existing = readCommitteeInstalments_(no).find((entry) => entry.person.toLowerCase() === person.toLowerCase());
  const values = [no, person, params.isTaken || 'No', Number(params.amount) || 0, asText_(params.takenMonth), Number(params.kist) || 0, Number(params.ghata) || 0, Number(params.sarkari) || 0, params.status || '', params.pendingMonth || ''];
  if (existing) {
    sheet.getRange(existing.row, 1, 1, 10).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
  const committee = readCommittees_().find((c) => c.no === no);
  if (committee) applyTakenHighlight_(committee);
}

// ---------- Per-committee "Kameti - <person>" sheet ----------

function committeeSheetName_(no) {
  const clean = String(no || '').replace(/[:\\\/\?\*\[\]]/g, ' ').trim().slice(0, 80);
  return `Kameti - ${clean || 'Unnamed'}`;
}

function getCommitteeSheetByNo_(no) {
  const spreadsheet = getSpreadsheet();
  const name = committeeSheetName_(no);
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Month', 'Boli date', 'Sarkari GHATA', 'Actual GHATA', 'KIST/member', 'Taken by', 'Amount received']);
  }
  return sheet;
}

// Only the year+month of a committee's StartMonth (which is really a full date)
// matter for lining up which row of its timeline a given month falls on.
function committeeStartYearMonth_(committee) {
  return String(committee.startMonth || '').slice(0, 7);
}
function monthIndexFor_(committee, targetYYYYMM) {
  const start = committeeStartYearMonth_(committee);
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(targetYYYYMM || '')) return null;
  const [fy, fm] = start.split('-').map(Number);
  const [ty, tm] = targetYYYYMM.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}
function addMonthsToYearMonth_(startYYYYMM, offset) {
  const [y, m] = startYYYYMM.split('-').map(Number);
  const total = (m - 1) + offset;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12 + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}
function sarkariGhataFor_(committee, monthYYYYMM) {
  const idx = monthIndexFor_(committee, monthYYYYMM);
  if (idx === null) return 0;
  const cut = (Number(committee.cutPercent) || 0) / 100;
  return Math.max(0, Math.round(committee.totalMembers * committee.monthlyAmount * cut * (committee.totalMonths - idx)));
}

// Ensures the committee's own sheet has one row for every month of its
// duration, with Sarkari GHATA pre-filled — this only needs the committee's
// numbers, not any actual entry, so it can all exist upfront as "the plan".
function ensureCommitteeMonthRows_(committee) {
  const startYM = committeeStartYearMonth_(committee);
  if (!/^\d{4}-\d{2}$/.test(startYM) || !committee.totalMonths) return;
  const sheet = getCommitteeSheetByNo_(committee.no);
  const lastRow = sheet.getLastRow();
  const existingMonths = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().map((r) => toYearMonthString_(r[0]))
    : [];
  for (let i = 1; i <= committee.totalMonths; i++) {
    const month = addMonthsToYearMonth_(startYM, i - 1);
    if (existingMonths.includes(month)) continue;
    sheet.appendRow([asText_(month), '', sarkariGhataFor_(committee, month), '', '', '', '']);
  }
}

function readCommitteeMonths_(committeeNo) {
  const sheet = getCommitteeSheetByNo_(committeeNo);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  return values
    .map((row, index) => ({
      row: index + 2,
      month: toYearMonthString_(row[0]),
      boliDate: toDateString_(row[1]),
      sarkariGhata: Number(row[2]) || 0,
      ghata: Number(row[3]) || 0,
      kist: Number(row[4]) || 0,
      takenBy: String(row[5] || ''),
      amountReceived: Number(row[6]) || 0,
    }))
    .filter((entry) => entry.month);
}

// Marks whichever row's month matches a member's TakenMonth with that member's
// name + the amount they received (total collected = KIST × members), and
// highlights the row — kept in sync whenever a month or a member's taken
// month changes.
function applyTakenHighlight_(committee) {
  const sheet = getCommitteeSheetByNo_(committee.no);
  const rows = readCommitteeMonths_(committee.no);
  if (!rows.length) return;
  const members = readCommitteeInstalments_(committee.no);
  rows.forEach((r) => {
    const taker = members.find((m) => m.takenMonth === r.month);
    const rowRange = sheet.getRange(r.row, 1, 1, 7);
    if (taker) {
      const received = r.kist ? r.kist * committee.totalMembers : 0;
      sheet.getRange(r.row, 6, 1, 2).setValues([[taker.person, received]]);
      rowRange.setBackground('#d9ead3');
    } else {
      sheet.getRange(r.row, 6, 1, 2).setValues([['', '']]);
      rowRange.setBackground(null);
    }
  });
}

// Saves this month's GHATA (boli) for a committee, derives KIST from it, and
// copies both into every member's row in Committee Instalments for that committee.
function saveCommitteeMonth_(params) {
  const no = String(params.no || '').trim();
  const month = String(params.month || '').trim();
  if (!no || !month) throw new Error('Committee and month are required');
  const committee = readCommittees_().find((c) => c.no === no);
  if (!committee) throw new Error('Committee not found');

  ensureCommitteeMonthRows_(committee);

  const ghata = Number(params.ghata) || 0;
  const kist = committee.totalMembers ? Math.round(committee.monthlyAmount - (ghata / committee.totalMembers)) : committee.monthlyAmount;
  const boliDate = asText_(params.boliDate);

  const sheet = getCommitteeSheetByNo_(no);
  const existing = readCommitteeMonths_(no).find((entry) => entry.month === month);
  if (existing) {
    sheet.getRange(existing.row, 2, 1, 1).setValues([[boliDate]]);
    sheet.getRange(existing.row, 4, 1, 2).setValues([[ghata, kist]]);
  } else {
    sheet.appendRow([asText_(month), boliDate, sarkariGhataFor_(committee, month), ghata, kist, '', '']);
  }

  const instSheet = getCommitteeInstalmentsSheet_();
  readCommitteeInstalments_(no).forEach((member) => {
    instSheet.getRange(member.row, 6, 1, 2).setValues([[kist, ghata]]); // KIST (col 6), GHATA (col 7)
  });

  applyTakenHighlight_(committee);

  return { ok: true, ghata, kist };
}
