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
 *
 * "<Mon>-<YY>" e.g. "Jun-26", "Jul-26", "Aug-26" (one sheet per CALENDAR month,
 *   cutting across every committee — the rollup view, not a source of truth)
 *   Sr No | Committee No | Installment No | Total Month | Monthly A | GHATA |
 *   Sarkari | Extra Profit | Total Invst | Is Taken | Taken Month | Pending Month | Status
 *   Fully rebuilt from Committees + Committee Instalments + the committee's
 *   own month sheet every time refreshCalendarMonthSheet_ runs (after every
 *   saveCommitteeMonth_, or on demand) — never hand-edited. Installment No is
 *   that committee's own cycle position for this month (unrelated to any
 *   other committee's row in the same sheet). Total Invst flips sign once a
 *   committee has been taken by that point in time: negative = still owed
 *   back to the owner, positive = still invested with the pot.
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
  refreshPersonNetSheet_(personOf_(committee.no));
}

// Corrects a committee's Start date after the fact (e.g. the real boli day
// turns out to differ from what was first entered) — only the day-of-month
// actually matters for anything derived from it (boliDateFor on the client,
// sarkariGhataFor_'s month-position math is year+month only and is
// unaffected), so this is safe to change without touching installment
// numbers or pending-month counts.
function updateCommitteeStartMonth_(no, startMonth) {
  const sheet = getCommitteesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('No committees yet');
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const rowIndex = ids.findIndex((r) => String(r[0] || '') === no);
  if (rowIndex === -1) throw new Error('Committee not found: ' + no);
  sheet.getRange(rowIndex + 2, 8).setValue(asText_(startMonth));
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
  refreshPersonNetSheet_(person);
}

// Corrects a mis-recorded "person" on an existing instalment row (matched by
// "no" alone, since each committee has exactly one instalment row today) —
// for fixing data saved before the member-vs-organizer distinction existed,
// without risking a duplicate row the way re-calling saveCommitteeInstalment_
// with a different person would (it only matches existing rows by person).
function renameInstalmentPerson_(no, newPerson) {
  const sheet = getCommitteeInstalmentsSheet_();
  const existing = readCommitteeInstalments_(no)[0];
  if (!existing) throw new Error('No instalment row found for ' + no);
  sheet.getRange(existing.row, 2).setValue(newPerson);
  const committee = readCommittees_().find((c) => c.no === no);
  if (committee) applyTakenHighlight_(committee);
  refreshPersonNetSheet_(newPerson);
}

// ---------- Per-committee "Kameti - <person>" sheet ----------

// A committee's "no" is "Person (start date)", optionally with a " #2" style
// suffix appended for duplicates — strip everything from the opening
// parenthesis onward when only the person's name is wanted (e.g. as the row
// in Committee Instalments). Anchoring the parenthesis to the end of the
// string would miss that " #2" suffix and leave it stuck to the name.
function personOf_(no) {
  return String(no || '').replace(/\s*\(.*/, '');
}

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
    sheet.appendRow(['Month', 'Boli date', 'Sarkari GHATA', 'Actual GHATA', 'KIST/member', 'Taken by', 'Amount received', 'Verified']);
  } else if (!String(sheet.getRange(1, 8).getValue() || '').trim()) {
    // Backfills the header on sheets created before the Verified column
    // existed — same pattern as getTransactionsSheet()'s own Verified column
    // in Code.gs. The column itself was already safe to read/write (fixed
    // index, not by header name); this only fixes the blank label in H1.
    sheet.getRange(1, 8).setValue('Verified');
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
// Pending months here is INCLUSIVE of the current one being bid on — the
// guaranteed floor discount covers every kist not yet collected, this
// month's included, not just the ones strictly after it. (Verified against
// real Sarkari GHATA figures: cut is a flat 1%, and matching them required
// counting this month too, not totalMonths - idx.)
function sarkariGhataFor_(committee, monthYYYYMM) {
  const idx = monthIndexFor_(committee, monthYYYYMM);
  if (idx === null) return 0;
  const cut = (Number(committee.cutPercent) || 0) / 100;
  const pendingInclusive = committee.totalMonths - idx + 1;
  return Math.max(0, Math.round(committee.totalMembers * committee.monthlyAmount * cut * pendingInclusive));
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
    sheet.appendRow([asText_(month), '', sarkariGhataFor_(committee, month), '', '', '', '', '']);
  }
}

// All months across every committee in one call (tagged with which committee
// each row belongs to) — used by the Analysis tab so it doesn't need one
// round-trip per committee just to build its month-wise report.
function readAllCommitteeMonths_() {
  const months = [];
  readCommittees_().forEach((committee) => {
    readCommitteeMonths_(committee.no).forEach((row) => {
      months.push(Object.assign({ no: committee.no, person: personOf_(committee.no) }, row));
    });
  });
  return months;
}

function readCommitteeMonths_(committeeNo) {
  const sheet = getCommitteeSheetByNo_(committeeNo);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
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
      verified: String(row[7] || '').trim().toLowerCase() === 'yes',
    }))
    .filter((entry) => entry.month);
}

// Marks whichever row's month matches a member's TakenMonth with that member's
// name + the amount they received (total collected = KIST × members), and
// highlights the row — kept in sync whenever a month or a member's taken
// month changes.
// Batched into two range calls total (regardless of how many months the
// committee has) instead of a few per row — looping with individual
// getRange().setValues() calls per row was slow enough (each is a network
// round-trip) to blow past the app's JSONP timeout on longer committees, so
// the save would finish but the success toast would never arrive in time.
function applyTakenHighlight_(committee) {
  const sheet = getCommitteeSheetByNo_(committee.no);
  const rows = readCommitteeMonths_(committee.no);
  if (!rows.length) return;
  const members = readCommitteeInstalments_(committee.no);
  const takenValues = [];
  const backgrounds = [];
  rows.forEach((r) => {
    const taker = members.find((m) => m.takenMonth === r.month);
    if (taker) {
      // The pot minus GHATA, not rounded-KIST × members — that loses a few
      // rupees to rounding (each member's KIST is rounded individually, but
      // the total pot handed to the taker isn't built up from those roundings).
      const received = r.boliDate ? (committee.totalAmount - r.ghata) : 0;
      // "Taken by" is always Renu here — Yes is enough, no need to name her.
      takenValues.push(['Yes', received]);
      backgrounds.push(Array(7).fill('#d9ead3'));
    } else {
      takenValues.push(['', '']);
      backgrounds.push(Array(7).fill(null));
    }
  });
  const firstRow = rows[0].row;
  sheet.getRange(firstRow, 6, rows.length, 2).setValues(takenValues);
  sheet.getRange(firstRow, 1, rows.length, 7).setBackgrounds(backgrounds);
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
  // Sarkari GHATA is recomputed fresh every save (not just left at whatever it
  // was pre-filled with when the row was first created) so it always reflects
  // the committee's current cut%/start date, even if those were fixed later.
  const sarkariGhata = sarkariGhataFor_(committee, month);
  // Any save through the normal Fill flow re-opens this month for Verify —
  // only verifyCommitteeMonths_ (params.verified) is allowed to leave it set.
  const verifiedFlag = params.verified ? 'Yes' : '';
  if (existing) {
    sheet.getRange(existing.row, 2, 1, 4).setValues([[boliDate, sarkariGhata, ghata, kist]]);
    sheet.getRange(existing.row, 8).setValue(verifiedFlag);
  } else {
    sheet.appendRow([asText_(month), boliDate, sarkariGhata, ghata, kist, '', '', verifiedFlag]);
  }

  const instSheet = getCommitteeInstalmentsSheet_();
  readCommitteeInstalments_(no).forEach((member) => {
    instSheet.getRange(member.row, 6, 1, 2).setValues([[kist, ghata]]); // KIST (col 6), GHATA (col 7)
  });

  // Sync this committee's taken status. Marking "Yes" this month always wins;
  // marking "No" only clears a taken record if it was for THIS same month
  // (i.e. un-marking it) — it never silently erases a taken record for a
  // different month just because a later month was saved with "No".
  // "person" here is whoever actually WITHDRAWS this slot's pot — e.g. for a
  // committee Vijay runs but Renu holds a slot in, that's Renu, not Vijay —
  // so it's passed explicitly (params.member) rather than assumed from the
  // committee's own name, which only says who the committee is run by/with.
  const person = String(params.member || '').trim() || personOf_(no);
  const existingRecord = readCommitteeInstalments_(no).find((m) => m.person.toLowerCase() === person.toLowerCase());
  const alreadyTakenElsewhere = existingRecord && existingRecord.isTaken === 'Yes' && existingRecord.takenMonth && existingRecord.takenMonth !== month;
  const idx = monthIndexFor_(committee, month);
  const pendingMonth = idx !== null ? Math.max(0, committee.totalMonths - idx) : '';

  if (params.taken === 'Yes') {
    const cut = (Number(committee.cutPercent) || 0) / 100;
    // Same inclusive-of-this-month count as sarkariGhataFor_ — kept algebraically
    // consistent (this is that total divided across totalMembers).
    const sarkari = idx !== null ? Math.round(committee.monthlyAmount - committee.monthlyAmount * cut * (committee.totalMonths - idx + 1)) : 0;
    saveCommitteeInstalment_({ no, person, isTaken: 'Yes', takenMonth: month, amount: committee.totalAmount - ghata, kist, ghata, sarkari, status: 'Taken', pendingMonth });
  } else if (!alreadyTakenElsewhere) {
    saveCommitteeInstalment_({ no, person, isTaken: 'No', takenMonth: '', amount: 0, kist, ghata, sarkari: 0, status: '', pendingMonth });
  }

  applyTakenHighlight_(committee);
  refreshCalendarMonthSheet_(month);

  return { ok: true, ghata, kist };
}

// ---------- Fill / Verify ----------
//
// A month saved through the normal Fill flow sits "unverified" (see the
// Verified column cleared in saveCommitteeMonth_ above) until reviewed here —
// mirrors the ledger's Detail Transaction verify flow. Only verifyCommitteeMonths_
// is allowed to set it back to Yes.
function readAllUnverifiedCommitteeMonths_() {
  const rows = [];
  readCommittees_().forEach((committee) => {
    readCommitteeMonths_(committee.no).forEach((m) => {
      if ((m.boliDate || m.ghata) && !m.verified) rows.push(Object.assign({ no: committee.no }, m));
    });
  });
  return rows;
}

// Applies each correction (if any) via the normal save path, then marks that
// month Verified — same "correct, then confirm" shape as verifyTransactions
// in Code.gs.
function verifyCommitteeMonths_(updates) {
  return updates.map((u) => {
    const no = String(u.no || '').trim();
    const month = String(u.month || '').trim();
    if (!no || !month) return { no, month, ok: false };
    try {
      saveCommitteeMonth_({ no, month, ghata: u.ghata, boliDate: u.boliDate, taken: u.taken, member: u.member, verified: true });
      return { no, month, ok: true };
    } catch (error) {
      return { no, month, ok: false };
    }
  });
}

// ---------- Calendar-month rollup ("Jun-26", "Jul-26", "Aug-26", ...) ----------
//
// Cuts across every committee to show one row per committee for a given
// calendar month — this is a read-only snapshot rebuilt from Committees +
// Committee Instalments + the per-committee month sheets, never edited by
// hand, so it's safe to fully recompute on every refresh rather than track
// incremental edits.
//
// Total Invst sign convention (per committee, as of this calendar month):
//   already taken by this month  -> -(months still owed * MonthlyAmount)
//                                    (money owed back TO the committee owner)
//   not yet taken by this month  -> +(months paid so far * MonthlyAmount)
//                                    (still an investment held WITH the pot)
// "Installment No" is this committee's OWN cycle position (e.g. its 7th
// kist), independent of any other committee's position in the same
// calendar-month sheet — never derive it from another row.
function calendarMonthLabel_(yyyymm) {
  if (!/^\d{4}-\d{2}$/.test(yyyymm || '')) return '';
  const [y, m] = yyyymm.split('-').map(Number);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${monthNames[m - 1]}-${String(y).slice(2)}`;
}

function getCalendarMonthSheet_(yyyymm) {
  const spreadsheet = getSpreadsheet();
  const name = calendarMonthLabel_(yyyymm);
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Sr No', 'Committee No', 'Installment No', 'Total Month', 'Monthly A', 'GHATA', 'Sarkari', 'Extra Profit', 'Total Invst', 'Is Taken', 'Taken Month', 'Pending Month', 'Status', 'Boli Date', 'Filled']);
  }
  return sheet;
}

function refreshCalendarMonthSheet_(yyyymm) {
  if (!/^\d{4}-\d{2}$/.test(yyyymm || '')) return;
  const sheet = getCalendarMonthSheet_(yyyymm);
  const rows = [];

  readCommittees_().forEach((committee) => {
    const idx = monthIndexFor_(committee, yyyymm);
    if (idx === null || idx < 1 || idx > committee.totalMonths) return; // not running this month

    const monthRow = readCommitteeMonths_(committee.no).find((m) => m.month === yyyymm);
    const ghata = monthRow ? monthRow.ghata : 0;
    const filled = Boolean(monthRow && (monthRow.boliDate || monthRow.ghata));

    const instalment = readCommitteeInstalments_(committee.no)[0];
    const takenIdx = instalment && instalment.isTaken === 'Yes' && instalment.takenMonth
      ? monthIndexFor_(committee, instalment.takenMonth) : null;
    const takenByThisMonth = takenIdx !== null && takenIdx <= idx;

    const pendingMonth = committee.totalMonths - idx;
    const cut = (Number(committee.cutPercent) || 0) / 100;
    // Sarkari's own pending count includes this month (see sarkariGhataFor_) —
    // "pendingMonth" above stays exclusive, that's a separate displayed figure.
    const sarkari = Math.round(committee.monthlyAmount - committee.monthlyAmount * cut * (pendingMonth + 1));
    const extraProfit = committee.totalMonths ? (ghata - sarkari) / committee.totalMonths : 0;
    const totalInvst = takenByThisMonth ? -(pendingMonth * committee.monthlyAmount) : committee.monthlyAmount * idx;

    rows.push([
      rows.length + 1, committee.no, idx, committee.totalMonths, committee.monthlyAmount,
      ghata, sarkari, extraProfit, totalInvst,
      takenByThisMonth ? 'Yes' : 'No',
      asText_(takenByThisMonth && instalment ? instalment.takenMonth : ''),
      pendingMonth,
      takenByThisMonth ? 'Taken' : '',
      asText_(monthRow ? monthRow.boliDate : ''),
      filled ? 'Yes' : 'No',
    ]);
  });

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 15).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, 15).setValues(rows);
}

function readCalendarMonth_(yyyymm) {
  refreshCalendarMonthSheet_(yyyymm);
  const sheet = getCalendarMonthSheet_(yyyymm);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
  return values.map((row) => ({
    srNo: row[0], no: String(row[1] || ''), installmentNo: row[2], totalMonth: row[3], monthlyAmount: row[4],
    ghata: row[5], sarkari: row[6], extraProfit: row[7], totalInvst: row[8], isTaken: String(row[9] || ''),
    takenMonth: toYearMonthString_(row[10]), pendingMonth: row[11], status: String(row[12] || ''),
    boliDate: toDateString_(row[13]), filled: String(row[14] || '') === 'Yes',
  }));
}

// ---------- Per-person net position ("Net - <person>") ----------
//
// A person's CURRENT net across every committee THEY run (not just one
// month) — same Total Invst sign convention as the calendar-month rollup,
// but anchored to today rather than a saved calendar month. Rebuilt
// whenever a committee is added or an instalment/month is saved for them.
function currentYearMonth_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
}

function personNetSheetName_(person) {
  const clean = String(person || '').replace(/[:\\\/\?\*\[\]]/g, ' ').trim().slice(0, 80);
  return `Net - ${clean || 'Unnamed'}`;
}

function getPersonNetSheet_(person) {
  const spreadsheet = getSpreadsheet();
  const name = personNetSheetName_(person);
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Committee No', 'Total Month', 'Monthly Amount', 'Is Taken', 'Pending Month', 'Net Invst']);
  }
  return sheet;
}

function refreshPersonNetSheet_(person) {
  if (!person) return;
  const sheet = getPersonNetSheet_(person);
  const today = currentYearMonth_();
  const rows = [];
  let total = 0;

  readCommittees_()
    .filter((c) => personOf_(c.no).toLowerCase() === person.toLowerCase())
    .forEach((committee) => {
      const idx = monthIndexFor_(committee, today);
      const clampedIdx = idx === null ? 0 : Math.max(0, Math.min(committee.totalMonths, idx));
      const instalment = readCommitteeInstalments_(committee.no)[0];
      const taken = Boolean(instalment && instalment.isTaken === 'Yes');
      const pendingMonth = taken ? (Number(instalment.pendingMonth) || 0) : (committee.totalMonths - clampedIdx);
      const netInvst = taken ? -(pendingMonth * committee.monthlyAmount) : committee.monthlyAmount * clampedIdx;
      total += netInvst;
      rows.push([committee.no, committee.totalMonths, committee.monthlyAmount, taken ? 'Yes' : 'No', pendingMonth, netInvst]);
    });

  const lastRow = sheet.getLastRow();
  const clearRows = Math.max(0, lastRow - 1);
  if (clearRows) sheet.getRange(2, 1, clearRows, 6).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  sheet.getRange(rows.length + 3, 1).setValue(`Net with ${person}`);
  sheet.getRange(rows.length + 3, 6).setValue(total);
}

function readPersonNet_(person) {
  refreshPersonNetSheet_(person);
  const sheet = getPersonNetSheet_(person);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { rows: [], total: 0 };
  const values = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  const rows = values
    .filter((row) => String(row[0] || '').trim())
    .map((row) => ({
      no: String(row[0]), totalMonth: row[1], monthlyAmount: row[2],
      isTaken: String(row[3] || ''), pendingMonth: row[4], netInvst: row[5],
    }));
  const total = rows.reduce((sum, r) => sum + (Number(r.netInvst) || 0), 0);
  return { rows, total };
}
