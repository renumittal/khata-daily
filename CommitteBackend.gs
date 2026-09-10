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
 *
 * "Committee Instalments"
 *   No | Person | IsTaken | Amount | TakenMonth | KIST | GHATA | Sarkari | Status | PendingMonth
 *
 * "Committee Months"
 *   No | Month | GHATA | KIST
 *   One row per committee per month: GHATA (the boli/auction discount) is entered
 *   once for the whole committee, KIST = MonthlyAmount − (GHATA ÷ TotalMembers) is
 *   derived from it, and both values are then copied into every member's row in
 *   "Committee Instalments" for that committee (see saveCommitteeMonth_).
 */

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
      startMonth: String(row[7] || ''),
      status: String(row[8] || ''),
    }));
}

function addCommittee_(params) {
  const sheet = getCommitteesSheet_();
  sheet.appendRow([
    String(params.no || '').trim(), Number(params.totalMembers) || 0, Number(params.totalMonths) || 0,
    Number(params.monthlyAmount) || 0, Number(params.totalAmount) || 0, Number(params.cutPercent) || 0,
    Number(params.extraProfit) || 0, params.startMonth || '', params.status || 'Running',
  ]);
}

function readCommitteeInstalments_(committeeNo) {
  const sheet = getCommitteeInstalmentsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
  return values
    .map((row, index) => ({
      row: index + 2, no: String(row[0] || ''), person: String(row[1] || ''), isTaken: String(row[2] || ''),
      amount: Number(row[3]) || 0, takenMonth: String(row[4] || ''), kist: Number(row[5]) || 0,
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
  const values = [no, person, params.isTaken || 'No', Number(params.amount) || 0, params.takenMonth || '', Number(params.kist) || 0, Number(params.ghata) || 0, Number(params.sarkari) || 0, params.status || '', params.pendingMonth || ''];
  if (existing) {
    sheet.getRange(existing.row, 1, 1, 10).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
}

function getCommitteeMonthsSheet_() {
  const spreadsheet = getSpreadsheet();
  let sheet = spreadsheet.getSheetByName(COMMITTEE_MONTHS_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(COMMITTEE_MONTHS_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['No', 'Month', 'GHATA', 'KIST']);
  }
  return sheet;
}

function readCommitteeMonths_(committeeNo) {
  const sheet = getCommitteeMonthsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  return values
    .map((row, index) => ({ row: index + 2, no: String(row[0] || ''), month: String(row[1] || ''), ghata: Number(row[2]) || 0, kist: Number(row[3]) || 0 }))
    .filter((entry) => entry.month && (!committeeNo || entry.no === String(committeeNo)));
}

// Saves this month's GHATA (boli) for a committee, derives KIST from it, and
// copies both into every member's row in Committee Instalments for that committee.
function saveCommitteeMonth_(params) {
  const no = String(params.no || '').trim();
  const month = String(params.month || '').trim();
  if (!no || !month) throw new Error('Committee and month are required');
  const committee = readCommittees_().find((c) => c.no === no);
  if (!committee) throw new Error('Committee not found');

  const ghata = Number(params.ghata) || 0;
  const kist = committee.totalMembers ? Math.round(committee.monthlyAmount - (ghata / committee.totalMembers)) : committee.monthlyAmount;

  const monthsSheet = getCommitteeMonthsSheet_();
  const existing = readCommitteeMonths_(no).find((entry) => entry.month === month);
  if (existing) {
    monthsSheet.getRange(existing.row, 1, 1, 4).setValues([[no, month, ghata, kist]]);
  } else {
    monthsSheet.appendRow([no, month, ghata, kist]);
  }

  const instSheet = getCommitteeInstalmentsSheet_();
  readCommitteeInstalments_(no).forEach((member) => {
    instSheet.getRange(member.row, 6, 1, 2).setValues([[kist, ghata]]); // KIST (col 6), GHATA (col 7)
  });

  return { ok: true, ghata, kist };
}
