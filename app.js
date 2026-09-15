const STORAGE_KEY = 'khata-daily-entries';
let entries = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let showingAll = false;
let people = [];
let transactionType = 'credit';
let personEntryType = 'credit';
let selectedPerson = null;
let personFilter = 'all';
let remoteTransactions = [];
let pendingVerification = [];
let committees = [];
let committeeInstalments = [];
let committeeMonths = [];
let selectedCommitteeNo = null;
let committeeSub = 'month';
let accessSub = 'groups';
let groups = [];
let authLevels = [];
let selectedGroupId = null;
let selectedLevelId = null;
let manageSub = 'list';
let analysisData = { committees: [], instalments: [], months: [] };
let analysisReport = 'month';
let monthViewMonth = null;
let monthViewRows = [];
let pendingCommitteeVerification = [];
let allCommitteeInstalments = [];

function currentYYYYMM() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function formatMonth(yyyyMm) {
  if (!yyyyMm) return '';
  const [y, m] = yyyyMm.split('-').map(Number);
  if (!y || !m) return yyyyMm;
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
}
// Only accepts YYYY-MM (or the first 7 chars of a YYYY-MM-DD date); older
// free-text values (e.g. "Jun-26" from before Start date became a date picker)
// return null rather than NaN, so the UI can show "—" instead of a broken number.
function isYYYYMM(value) { return /^\d{4}-\d{2}$/.test(value || ''); }
function monthsBetween(fromYYYYMM, toYYYYMM) {
  const [fy, fm] = fromYYYYMM.split('-').map(Number);
  const [ty, tm] = toYYYYMM.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}
// A committee's Start date (input type=date) is a full YYYY-MM-DD — only its
// year+month decide which row of the timeline a given month falls on.
function committeeStartYearMonth(committee) { return (committee && committee.startMonth || '').slice(0, 7); }
// 1-based position of targetYYYYMM within the committee's timeline (start month = 1).
function monthIndexFor(committee, targetYYYYMM) {
  const start = committeeStartYearMonth(committee);
  if (!isYYYYMM(start) || !isYYYYMM(targetYYYYMM)) return null;
  return monthsBetween(start, targetYYYYMM) + 1;
}
// Adds `months` calendar months to a YYYY-MM-DD date string, keeping the same day of month.
function addMonthsToDate(dateStr, months) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function committeeByNo(no) { return committees.find((c) => c.no === no); }
function committeeEndDate(committee) {
  if (!committee || !committee.startMonth || !committee.totalMonths) return '';
  return addMonthsToDate(committee.startMonth, committee.totalMonths - 1);
}
// The floor GHATA for a given month: TotalMembers × MonthlyAmount × Cut% × (months
// remaining, THIS one included). The boli/auction discount actually entered that
// month can't be lower than this — it's the guaranteed minimum cut. Mirrors
// sarkariGhataFor_ in CommitteBackend.gs — keep both in sync.
function sarkariGhataFor(committee, monthYYYYMM) {
  if (!committee) return '';
  const idx = monthIndexFor(committee, monthYYYYMM);
  if (idx === null) return '';
  const cut = (Number(committee.cutPercent) || 0) / 100;
  const pendingInclusive = committee.totalMonths - idx + 1;
  return Math.max(0, Math.round(committee.totalMembers * committee.monthlyAmount * cut * pendingInclusive));
}
// KIST for a member this month = MonthlyAmount − (GHATA ÷ TotalMembers), the boli discount split evenly.
function kistFor(committee, ghata) {
  if (!committee) return 0;
  if (!committee.totalMembers) return committee.monthlyAmount;
  return Math.round(committee.monthlyAmount - (Number(ghata) || 0) / committee.totalMembers);
}

function allEntries() {
  const map = new Map();
  remoteTransactions.forEach((entry) => map.set(entry.id, entry));
  entries.forEach((entry) => map.set(entry.id, entry));
  return [...map.values()];
}

const $ = (id) => document.getElementById(id);
const currency = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
// A short "₹5.50L" form for wide tables (e.g. the Analysis person-wise
// report) where full rupee figures push the table into horizontal scroll.
const currencyLakhs = (value) => `${value < 0 ? '-' : ''}₹${(Math.abs(value) / 100000).toFixed(2)}L`;
const today = () => new Date().toISOString().slice(0, 10);

function render() {
  const combined = allEntries();
  const visible = showingAll ? combined : combined.filter((entry) => entry.date === today());
  $('activityTitle').textContent = showingAll ? 'All entries' : 'Today';
  $('clearFilter').textContent = showingAll ? 'Today only' : 'View all';
  $('transactionList').innerHTML = visible.slice().sort((a, b) => `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`)).map((entry) => `
    <div class="transaction ${entry.type}">
      <div class="transaction-mark">${entry.type === 'credit' ? '↓' : '↑'}</div>
      <div class="transaction-main"><div class="transaction-person">${escapeHtml(entry.person)}</div><div class="transaction-note">${escapeHtml([entry.category, entry.note].filter(Boolean).join(' · ') || formatDate(entry.date))}</div></div>
      <div class="transaction-amount">${entry.type === 'credit' ? '+' : '-'}${currency(entry.amount)}</div>
    </div>`).join('');
  $('emptyState').hidden = visible.length > 0;
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char])); }
function formatDate(value) { return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); }
function showToast(message) { const toast = $('toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2600); }
function setSyncState(online) { $('syncStatus').classList.toggle('online', online); $('syncStatus').innerHTML = `<i></i> ${online ? 'Connected' : 'Local'}`; }

// Talks to Supabase via apiRequest() (see supabase-client.js), which takes
// the exact same { action, ...params } shape the old Google Apps Script
// JSONP endpoint did and returns the same-shaped { ok, ... } payload — so
// every call site below is unchanged from the Sheets-backed version.
function jsonpRequest(params) {
  return apiRequest(params);
}

function committeeRequest(params) {
  return apiRequest(params);
}

async function syncEntry(entry) {
  const response = await jsonpRequest({ action:'save', id:entry.id, date:entry.date, type:entry.type, person:entry.person, category:entry.category || '', amount:String(entry.amount), note:entry.note || '', createdAt:entry.createdAt, project:entry.project || undefined, paidByUser:entry.paidByUser || undefined });
  const ok = Boolean(response && response.ok);
  setSyncState(ok);
  return ok;
}

function renderPeople() {
  $('peopleList').innerHTML = people.length ? people.map((person) => `
    <div class="person-card" data-person="${escapeHtml(person)}">
      <div class="person-card-top">
        <span>${escapeHtml(person)}</span>
        <input class="person-amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Amount">
      </div>
      <div class="person-card-fields">
        <input class="person-date" type="date" value="${today()}" required>
        <input class="person-purpose" type="text" placeholder="Purpose (optional)">
      </div>
    </div>`).join('') : '<div class="people-placeholder">Add names from Settings → Manage names.</div>';
  $('peopleStatus').textContent = people.length ? `${people.length} people` : 'No names found';
}

async function loadTransactions() {
  const response = await jsonpRequest({ action:'transactions' });
  if (!response || !response.ok) return false;
  remoteTransactions = response.transactions || [];
  render();
  return true;
}

async function loadPeople() {
  const response = await jsonpRequest({});
  if (!response) {
    $('peopleStatus').textContent = 'Check Apps Script access';
    showToast('Redeploy Apps Script as Anyone, then refresh');
    setSyncState(false);
    return;
  }
  people = response.people || [];
  renderPeople();
  renderPeopleDirectory();
  setSyncState(true);
}

function renderManagePeople(list) {
  $('managePeopleList').innerHTML = list.length ? list.map((entry) => `
    <div class="manage-person-row">
      <span>${escapeHtml(entry.name)}${entry.mobile ? `<small class="dialog-copy"> · ${escapeHtml(entry.mobile)}</small>` : ''}</span>
      <button type="button" class="status-toggle${entry.active ? ' active' : ''}" data-name="${escapeHtml(entry.name)}" data-active="${entry.active}">${entry.active ? 'Active' : 'Inactive'}</button>
    </div>`).join('') : '<small class="dialog-copy">No names yet — add one above.</small>';
}

async function loadAllPeople() {
  $('managePeopleList').innerHTML = '<small class="dialog-copy">Loading...</small>';
  const response = await jsonpRequest({ action:'allPeople' });
  if (!response) { $('managePeopleList').innerHTML = '<small class="dialog-copy">Could not load — check Apps Script access.</small>'; return; }
  renderManagePeople(response.people || []);
}

async function addPerson() {
  const name = $('newPersonName').value.trim();
  if (!name) return;
  const mobile = $('newPersonMobile').value.trim();
  $('addPersonButton').disabled = true;
  const response = await jsonpRequest({ action:'addPerson', name, mobile });
  $('addPersonButton').disabled = false;
  if (!response || !response.ok) { showToast('Could not add name'); return; }
  $('newPersonName').value = '';
  $('newPersonMobile').value = '';
  showToast(`${name} added`);
  await Promise.all([loadAllPeople(), loadPeople()]);
}

async function setPersonActive(name, active) {
  const response = await jsonpRequest({ action:'setActive', name, active:String(active) });
  if (!response || !response.ok) { showToast('Could not update'); return; }
  await Promise.all([loadAllPeople(), loadPeople()]);
}

// Loads committee data (committees + every instalment row + every
// committee's month history) to fold each person's committee net position
// into their overall People-tab balance. Needs the full month history (not
// just committees + instalments) because currentNetInvst is anchored to each
// committee's last actually-filled kist, not just today's calendar date.
async function loadCommitteeNetData() {
  const response = await committeeRequest({ action: 'committeeAnalysis' });
  if (!response || !response.ok) return;
  committees = response.committees || [];
  allCommitteeInstalments = response.instalments || [];
  analysisData = { committees: response.committees || [], instalments: response.instalments || [], months: response.months || [] };
}

// A person's current committee net (see currentNetInvst) summed across every
// committee they run — same sign convention as the People/personDetail
// balance: positive = they owe you, negative = you owe them. Matched
// case-insensitively, same as the Analysis person-wise report, and across
// every committee regardless of status (a "Closed" committee isn't
// necessarily fully settled to zero).
function committeeNetForPerson(name) {
  const key = String(name || '').toLowerCase();
  if (!key) return 0;
  const instalmentsByNo = new Map(allCommitteeInstalments.map((i) => [i.no, i]));
  return committees
    .filter((c) => personOf(c.no).toLowerCase() === key)
    .reduce((sum, c) => sum + currentNetInvst(c, instalmentsByNo.get(c.no)), 0);
}

// The overall balance shown for a person is the ledger balance (credit/debit
// entries) PLUS whatever they currently owe/are owed across their
// committees — e.g. once a lumpsum settling a committee due is recorded as a
// ledger credit/debit, it nets against that committee amount here rather
// than the two living as separate, disconnected numbers.
function personSummary(name) {
  const list = allEntries().filter((entry) => entry.person === name).sort((a, b) => `${a.date}${a.createdAt}`.localeCompare(`${b.date}${b.createdAt}`));
  const credit = list.filter((entry) => entry.type === 'credit').reduce((sum, entry) => sum + entry.amount, 0);
  const debit = list.filter((entry) => entry.type === 'debit').reduce((sum, entry) => sum + entry.amount, 0);
  const ledgerNet = credit - debit;
  const committeeNet = committeeNetForPerson(name);
  return { list, count: list.length, firstDate: list[0]?.date, lastDate: list[list.length - 1]?.date, credit, debit, ledgerNet, committeeNet, net: ledgerNet + committeeNet };
}

function switchView(view) {
  $('peopleView').hidden = view !== 'people';
  $('verifyView').hidden = view !== 'verify';
  $('personDetailView').hidden = view !== 'personDetail';
  $('committeeView').hidden = view !== 'committee';
  $('accessView').hidden = view !== 'access';
  $('projectPayView').hidden = view !== 'projectPay';
  document.querySelectorAll('.tab-button[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view || (view === 'personDetail' && button.dataset.view === 'people')));
  if (view === 'people') {
    renderPeopleDirectory();
    Promise.all([loadTransactions(), loadCommitteeNetData()]).then(() => { if (!$('peopleView').hidden) renderPeopleDirectory(); });
  }
  if (view === 'personDetail') {
    renderPersonDetail();
    loadCommitteeNetData().then(() => { if (!$('personDetailView').hidden) renderPersonDetail(); });
  }
  if (view === 'verify') loadUnverified();
  if (view === 'committee') { loadCommittees(); switchCommitteeSub(committeeSub); loadCommitteeUnverifiedBadge(); }
  if (view === 'access') switchAccessSub(accessSub);
}

// Top-level Committee flow: Fill (month) -> Verify -> View (analysis), with
// the committee-management screens (List/Add new/Instalments) tucked under
// one Manage tab so they're out of the way on a phone day to day.
function switchCommitteeSub(sub, preselectManageSub) {
  committeeSub = sub;
  ['month', 'verify', 'manage', 'analysis'].forEach((name) => { $(`committeeSub-${name}`).hidden = name !== sub; });
  document.querySelectorAll('#committeeView > .type-switch [data-csub]').forEach((button) => button.classList.toggle('active', button.dataset.csub === sub));
  if (sub === 'month') {
    if (!$('mv_month').value) $('mv_month').value = currentYYYYMM();
    loadMonthView($('mv_month').value);
  }
  if (sub === 'verify') loadCommitteeUnverified();
  if (sub === 'analysis') loadCommitteeAnalysis();
  if (sub === 'manage') switchManageSub(preselectManageSub || manageSub);
}

function switchManageSub(sub, preselectNo) {
  manageSub = sub;
  ['list', 'add', 'instalments'].forEach((name) => { $(`manageSub-${name}`).hidden = name !== sub; });
  document.querySelectorAll('#committeeSub-manage [data-msub]').forEach((button) => button.classList.toggle('active', button.dataset.msub === sub));
  if (sub === 'add') {
    $('c_no').innerHTML = '<option value="">Pick a person</option>' + people.map((name) => `<option>${escapeHtml(name)}</option>`).join('');
    $('c_existingHint').textContent = '';
  }
  if (sub === 'instalments') populateCommitteeSelect(preselectNo || selectedCommitteeNo);
}

// Month-first entry: pick a calendar month, see every committee whose own
// cycle has a kist due that month (regardless of which committee it is),
// and fill in GHATA/taken right there — mirrors the committee-first
// "Instalments" tab's save flow but grouped by month instead of by committee.
async function loadMonthView(month) {
  monthViewMonth = month;
  if (!committees.length) await loadCommittees();
  if (!isYYYYMM(month)) { monthViewRows = []; renderMonthView(); return; }
  // Rebuilds the whole calendar-month sheet server-side (reads every committee's
  // own month sheet + instalment row), so it's slower than the simpler calls —
  // needs the same longer timeout margin as saveCommitteeMonth.
  const response = await committeeRequest({ action: 'calendarMonth', month }, 25000);
  monthViewRows = (response && response.rows) || [];
  renderMonthView();
}

function renderMonthView() {
  const sorted = [...monthViewRows].sort((a, b) => a.no.localeCompare(b.no));
  $('monthViewEmpty').hidden = sorted.length > 0;
  const unfilled = sorted.filter((r) => !r.filled).length;
  $('mv_summary').textContent = sorted.length
    ? `${sorted.length} committee${sorted.length > 1 ? 's' : ''} running · ${unfilled} need${unfilled === 1 ? 's' : ''} this month's entry`
    : '';
  $('monthViewBody').innerHTML = sorted.map((r) => {
    const committee = committeeByNo(r.no);
    const boliDate = r.boliDate || (committee ? boliDateFor(committee, monthViewMonth) : '');
    if (r.filled) {
      return `
      <tr class="${r.isTaken === 'Yes' ? 'month-taken' : ''}">
        <td>${escapeHtml(committeeLabel(r.no))}</td>
        <td>${r.installmentNo}/${r.totalMonth}</td>
        <td>${boliDate ? formatDate(boliDate) : '—'}</td>
        <td>${currency(r.sarkari)}</td>
        <td>${currency(r.ghata)}</td>
        <td>${currency(committee ? kistFor(committee, r.ghata) : 0)}</td>
        <td>${r.isTaken === 'Yes' ? 'Yes' : 'No'}</td>
      </tr>`;
    }
    return `
    <tr class="month-open" data-no="${escapeHtml(r.no)}">
      <td>${escapeHtml(committeeLabel(r.no))}</td>
      <td>${r.installmentNo}/${r.totalMonth}</td>
      <td>${boliDate ? formatDate(boliDate) : '—'}</td>
      <td>${currency(r.sarkari)}</td>
      <td><input class="mv-ghata-input" type="number" min="0" value=""></td>
      <td class="mv-kist-cell">${currency(committee ? kistFor(committee, 0) : 0)}</td>
      <td><select class="mv-taken-select"><option selected>No</option><option>Yes</option></select></td>
    </tr>`;
  }).join('');
  $('saveMonthViewButton').hidden = !unfilled;
}

async function saveMonthView() {
  const month = monthViewMonth;
  const rows = [...document.querySelectorAll('#monthViewBody tr[data-no]')]
    .filter((row) => row.querySelector('.mv-ghata-input').value.trim() !== '');
  if (!rows.length) { showToast('Enter GHATA for at least one committee first'); return; }

  for (const row of rows) {
    const no = row.dataset.no;
    const committee = committeeByNo(no);
    const ghata = Number(row.querySelector('.mv-ghata-input').value) || 0;
    const minGhata = sarkariGhataFor(committee, month);
    if (minGhata !== '' && ghata < minGhata) {
      showToast(`#${no}: GHATA can't be less than the Sarkari minimum of ${currency(minGhata)}`);
      return;
    }
  }

  let saved = 0;
  for (const row of rows) {
    const no = row.dataset.no;
    const committee = committeeByNo(no);
    const ghata = Number(row.querySelector('.mv-ghata-input').value) || 0;
    const taken = row.querySelector('.mv-taken-select').value;
    // "member" is who actually withdraws this slot's pot — currently always
    // Renu (every committee here is one of her slots in someone else's
    // kameti); make this a real per-slot field if other people's own slots
    // get tracked here too.
    const response = await committeeRequest({ action: 'saveCommitteeMonth', no, month, ghata, boliDate: boliDateFor(committee, month), taken, member: 'Renu' }, 25000);
    if (response && response.ok) saved++;
  }
  showToast(saved === rows.length
    ? `${saved} committee${saved > 1 ? 's' : ''} saved for ${formatMonth(month)}`
    : `Saved ${saved} of ${rows.length} — check the connection and try the rest again`);
  await loadMonthView(month);
  loadCommitteeUnverifiedBadge();
}

// Lightweight badge-only refresh — used whenever the Committee tab opens or
// something is saved, without paying for the full Verify list render unless
// the user actually goes to that tab.
async function loadCommitteeUnverifiedBadge() {
  const response = await committeeRequest({ action: 'unverifiedCommitteeMonths' }, 15000);
  pendingCommitteeVerification = (response && response.months) || [];
  updateCommitteeVerifyBadge();
}

function updateCommitteeVerifyBadge() {
  const badge = $('committeeVerifyBadge');
  badge.textContent = pendingCommitteeVerification.length;
  badge.hidden = pendingCommitteeVerification.length === 0;
}

async function loadCommitteeUnverified() {
  const response = await committeeRequest({ action: 'unverifiedCommitteeMonths' }, 15000);
  if (!response || !response.ok) { $('committeeVerifyCount').textContent = 'Could not load'; return; }
  pendingCommitteeVerification = response.months || [];
  updateCommitteeVerifyBadge();
  renderCommitteeVerifyList();
}

// Mirrors the ledger's Verify screen: each row is editable (GHATA/Taken) so a
// mistake made while filling can be caught here before it's confirmed, not
// just rubber-stamped.
function renderCommitteeVerifyList() {
  const sorted = [...pendingCommitteeVerification].sort((a, b) => `${b.month}${a.no}`.localeCompare(`${a.month}${b.no}`));
  $('committeeVerifyCount').textContent = sorted.length ? `${sorted.length} pending` : 'All caught up';
  $('committeeVerifyEmpty').hidden = sorted.length > 0;
  $('committeeVerifySubmitButton').hidden = sorted.length === 0;
  $('committeeVerifyList').innerHTML = sorted.map((m, index) => `
    <tr class="cv-row" data-index="${index}">
      <td><input type="checkbox" class="verify-include" checked></td>
      <td>${escapeHtml(committeeLabel(m.no))}</td>
      <td>${escapeHtml(formatMonth(m.month))}</td>
      <td><input class="cv-ghata-input" type="number" min="0" value="${m.ghata || ''}"></td>
      <td><select class="cv-taken-select"><option ${m.takenBy ? '' : 'selected'}>No</option><option ${m.takenBy ? 'selected' : ''}>Yes</option></select></td>
    </tr>`).join('');
}

async function submitCommitteeVerification() {
  const updates = [];
  document.querySelectorAll('#committeeVerifyList .cv-row').forEach((row) => {
    if (!row.querySelector('.verify-include').checked) return;
    const m = pendingCommitteeVerification[Number(row.dataset.index)];
    updates.push({
      no: m.no, month: m.month,
      ghata: Number(row.querySelector('.cv-ghata-input').value) || 0,
      taken: row.querySelector('.cv-taken-select').value,
      boliDate: m.boliDate || boliDateFor(committeeByNo(m.no), m.month),
      member: 'Renu',
    });
  });
  if (!updates.length) { showToast('Select at least one month'); return; }
  $('committeeVerifySubmitButton').disabled = true;
  const response = await committeeRequest({ action: 'verifyCommitteeMonths', updates: JSON.stringify(updates) }, 25000);
  $('committeeVerifySubmitButton').disabled = false;
  if (!response || !response.ok) { showToast('Could not verify — check connection'); return; }
  showToast(`${updates.length} month(s) verified`);
  await loadCommitteeUnverified();
}

function switchAnalysisReport(report) {
  analysisReport = report;
  ['month', 'person'].forEach((name) => { $(`analysisReport-${name}`).hidden = name !== report; });
  document.querySelectorAll('.type-switch [data-areport]').forEach((button) => button.classList.toggle('active', button.dataset.areport === report));
}

async function loadCommitteeAnalysis() {
  const response = await committeeRequest({ action: 'committeeAnalysis' });
  if (!response || !response.ok) { showToast('Could not load analysis — check the committee connection'); return; }
  committees = response.committees || [];
  analysisData = { committees: response.committees || [], instalments: response.instalments || [], months: response.months || [] };
  renderAnalysisMonth();
  renderAnalysisPerson();
}

// Committee identifiers embed their start date (e.g. "Vijay (1 Apr 2025)")
// to stay unique across a person's several committees, but next to an actual
// Boli Date column that reads as a second, unrelated date and confuses more
// than it helps. Show a plain per-person ordinal instead, ranked by start
// date so it stays stable — everywhere a date column already carries the
// real date for that row (Fill, Verify, Analysis), not in Manage where the
// full identifier is the whole point.
function committeeLabel(no) {
  const person = personOf(no);
  const siblings = committees
    .filter((c) => personOf(c.no).toLowerCase() === person.toLowerCase())
    .slice()
    .sort((a, b) => (a.startMonth || '').localeCompare(b.startMonth || '') || a.no.localeCompare(b.no));
  const ordinal = siblings.findIndex((c) => c.no === no) + 1;
  return ordinal > 0 ? `${person} #${ordinal}` : person;
}

// One row per committee per month across every committee, grouped by calendar
// month so it reads like "what happened this month across all committees" —
// only months that actually have a saved boli/GHATA are shown.
function renderAnalysisMonth() {
  const committeesByNo = new Map(analysisData.committees.map((c) => [c.no, c]));
  const instalmentsByNo = new Map(analysisData.instalments.map((i) => [i.no, i]));
  const filled = analysisData.months.filter((m) => m.boliDate || m.ghata);
  const grouped = new Map();
  filled.forEach((m) => { if (!grouped.has(m.month)) grouped.set(m.month, []); grouped.get(m.month).push(m); });
  const monthsSorted = [...grouped.keys()].sort().reverse();
  $('analysisMonthEmpty').hidden = monthsSorted.length > 0;
  $('analysisMonthList').innerHTML = monthsSorted.map((month) => {
    const rows = grouped.get(month).slice().sort((a, b) => a.no.localeCompare(b.no));
    // Net position across every committee AS OF this month — same Total Invst
    // formula/sign convention as the calendar-month rollup sheet (positive =
    // still invested with the pot, i.e. money to come; negative = future
    // instalments still owed), summed over every committee filled this month.
    const monthNetInvst = rows.reduce((sum, r) => {
      const committee = committeesByNo.get(r.no);
      if (!committee) return sum;
      const idx = monthIndexFor(committee, month);
      if (idx === null) return sum;
      const instalment = instalmentsByNo.get(r.no);
      const takenByThisMonth = Boolean(instalment && instalment.isTaken === 'Yes' && instalment.takenMonth && instalment.takenMonth <= month);
      const pendingMonth = committee.totalMonths - idx;
      const invst = takenByThisMonth ? -(pendingMonth * committee.monthlyAmount) : committee.monthlyAmount * idx;
      return sum + invst;
    }, 0);
    return `
    <div class="analysis-month-group">
      <h3 class="analysis-month-title">${escapeHtml(formatMonth(month))} <span class="${monthNetInvst > 0 ? 'invst-owed' : monthNetInvst < 0 ? 'invst-owing' : ''}">${monthNetInvst >= 0 ? '+' : ''}${currencyLakhs(monthNetInvst)}</span></h3>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Committee</th><th>Boli date</th><th>GHATA</th><th>KIST</th><th>Pot amount</th><th>Taken</th></tr></thead>
          <tbody>
            ${rows.map((r) => {
              const committee = committeesByNo.get(r.no);
              const potAmount = committee ? committee.totalAmount - r.ghata : null;
              return `
              <tr class="${r.takenBy ? 'month-taken' : ''}">
                <td>${escapeHtml(committeeLabel(r.no))}</td>
                <td>${r.boliDate ? formatDate(r.boliDate) : '—'}</td>
                <td>${currency(r.ghata)}</td>
                <td>${currency(r.kist)}</td>
                <td>${potAmount !== null ? currency(potAmount) : '—'}</td>
                <td>${r.takenBy ? 'Yes' : 'No'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

// The kist actually reached so far for a committee — the latest month that's
// been filled in (GHATA entered via Fill/Verify), NOT whatever the calendar
// date says is "due". A committee's kist for the current calendar month isn't
// real until it's actually been filled — until then, the last filled month
// (e.g. August, while September is still outstanding) is the true position.
// Returns null if nothing has been filled yet.
function lastFilledKistNo(committee) {
  const filledMonths = analysisData.months
    .filter((m) => m.no === committee.no && (m.boliDate || m.ghata))
    .map((m) => m.month);
  if (!filledMonths.length) return null;
  const lastMonth = filledMonths.reduce((max, m) => (m > max ? m : max), filledMonths[0]);
  const idx = monthIndexFor(committee, lastMonth);
  return idx === null ? null : Math.max(1, Math.min(committee.totalMonths, idx));
}

// A committee's current net position, as of the last kist actually filled in
// (not today's calendar date — a month that's calendar-due but not yet paid
// isn't real money yet). Same sign convention as the backend's calendar-month
// rollup and "Net - <person>" sheet: already taken = negative (owed back to
// the owner), not yet taken = positive (still invested with the pot).
function currentNetInvst(committee, instalment) {
  const clampedIdx = lastFilledKistNo(committee) || 0;
  const taken = Boolean(instalment && instalment.isTaken === 'Yes');
  // Pending months counts down from the last actually-filled kist, same as
  // the calendar-month rollup — never frozen at whatever it was when the
  // committee was first marked taken. Mirrors refreshPersonNetSheet_.
  const pendingMonth = committee.totalMonths - clampedIdx;
  return taken ? -(pendingMonth * committee.monthlyAmount) : committee.monthlyAmount * clampedIdx;
}

// All committees grouped by the person who runs them — so someone running
// several committees (e.g. Vijay with 5) sees every one of them under a
// single group instead of hunting through the flat committee list.
function renderAnalysisPerson() {
  const instalmentsByNo = new Map(analysisData.instalments.map((i) => [i.no, i]));
  // Grouped case-insensitively (a stray "vijay" vs "Vijay" typo shouldn't
  // split one person into two groups) — the display name is whichever
  // casing the People list itself uses, falling back to the first seen.
  const groups = new Map();
  analysisData.committees.filter((c) => c.status !== 'Closed').forEach((c) => {
    const person = personOf(c.no);
    const key = person.toLowerCase();
    if (!groups.has(key)) groups.set(key, { display: person, committees: [] });
    groups.get(key).committees.push(c);
  });
  people.forEach((name) => { const group = groups.get(name.toLowerCase()); if (group) group.display = name; });
  const keysSorted = [...groups.keys()].sort((a, b) => groups.get(a).display.localeCompare(groups.get(b).display));
  $('analysisPersonEmpty').hidden = keysSorted.length > 0;
  $('analysisPersonList').innerHTML = keysSorted.map((key) => {
    const { display: person, committees } = groups.get(key);
    const list = committees.slice().sort((a, b) => (a.startMonth || '').localeCompare(b.startMonth || ''));
    const totalPot = list.reduce((sum, c) => sum + (c.totalAmount || 0), 0);
    const takenCount = list.filter((c) => { const inst = instalmentsByNo.get(c.no); return inst && inst.isTaken === 'Yes'; }).length;
    const netWithPerson = list.reduce((sum, c) => sum + currentNetInvst(c, instalmentsByNo.get(c.no)), 0);
    const netState = netWithPerson > 0 ? 'owed' : netWithPerson < 0 ? 'owing' : 'settled';
    const netLabel = netState === 'owed' ? `${escapeHtml(person)} owes you` : netState === 'owing' ? `You owe ${escapeHtml(person)}` : 'Settled';
    // Every committee in `list` is already filtered to non-Closed above, so
    // one badge for the whole group covers all of its rows — no need to
    // repeat a "Running" cell on every single one.
    const groupStatus = list[0]?.status || 'Running';
    return `
    <div class="analysis-person-group">
      <div class="person-summary-row">
        <div class="person-avatar">${escapeHtml(person.charAt(0).toUpperCase())}</div>
        <div class="person-summary-main">
          <div class="person-summary-name">${escapeHtml(person)}</div>
          <div class="person-summary-meta">${list.length} committee${list.length > 1 ? 's' : ''} · ${currency(totalPot)} total · ${takenCount} taken</div>
        </div>
        <div class="person-summary-balance ${netState}">
          <span class="status-pill">${escapeHtml(groupStatus)}</span>
          <strong>${currency(Math.abs(netWithPerson))}</strong>
          <small>${netLabel}</small>
        </div>
      </div>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Committee</th><th>Kist #</th><th>Total pot (L)</th><th>Start</th><th>Taken</th><th>Total Invst (L)</th></tr></thead>
          <tbody>
            ${list.map((c) => {
              const inst = instalmentsByNo.get(c.no);
              const taken = inst && inst.isTaken === 'Yes';
              // Same figure and sign convention as the "Total Invst" column on
              // the calendar-month rollup sheets, but anchored to the last
              // actually-filled kist rather than a saved calendar month —
              // negative (still owed back to the owner) shown in red, positive
              // (still invested with the pot) in green, via the same
              // owed/owing classes as the balance pill.
              const invst = currentNetInvst(c, inst);
              // Kist actually reached so far — not whatever the calendar date
              // says is due (a month isn't real until it's been filled in via
              // Fill/Verify). totalMonths doubles as the member count (one
              // payout per member per month), so this already covers a
              // separate Members column.
              const kistNo = lastFilledKistNo(c);
              return `
              <tr>
                <td>${escapeHtml(committeeLabel(c.no))}</td>
                <td>${kistNo !== null ? `${kistNo}/${c.totalMonths}` : '—'}</td>
                <td>${currencyLakhs(c.totalAmount)}</td>
                <td>${c.startMonth ? formatDate(c.startMonth) : '—'}</td>
                <td>${taken ? `Yes (${escapeHtml(formatMonth(inst.takenMonth))})` : 'No'}</td>
                <td class="${invst > 0 ? 'invst-owed' : invst < 0 ? 'invst-owing' : ''}">${currencyLakhs(invst)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

// Shows any committees the selected person already has, so a second one for
// the same person (a new round, say) is a visible, deliberate choice rather
// than something that could look like an accidental duplicate.
function showExistingCommitteesHint() {
  const person = $('c_no').value;
  const existing = committees.filter((c) => personOf(c.no) === person);
  $('c_existingHint').textContent = existing.length
    ? `${person} already has: ${existing.map((c) => c.no).join(', ')}. Saving will add another, separate committee.`
    : '';
}

async function loadCommittees() {
  $('committeeList').innerHTML = '';
  const response = await committeeRequest({ action: 'committees' });
  if (!response || !response.ok) { $('committeeEmpty').hidden = false; $('committeeEmpty').querySelector('p').textContent = 'Could not load'; return; }
  committees = response.committees || [];
  renderCommittees();
  if (committeeSub === 'instalments') populateCommitteeSelect(selectedCommitteeNo);
}

// A committee's "no" is "Person (start date)" so the same person can run more than
// one committee — strip the date back off when only the person's name is wanted.
// Mirrors personOf_ in CommitteBackend.gs — strip from the opening
// parenthesis onward (not anchored to the string's end) so a de-duped
// " #2"-style suffix after the date doesn't get stuck to the person's name.
function personOf(no) { return String(no || '').replace(/\s*\(.*/, ''); }

// The bracketed date in a committee's stored "no" (e.g. "Vijay (1 Jan
// 2026)") is frozen at creation time — if the Start date is ever corrected
// afterward, that bracket silently drifts from the live boli date shown
// right below it in the meta line. Rebuild it from the committee's current
// startMonth instead of trusting the stored "no" string, so it can't go
// stale; only the " #2"-style de-dupe suffix (if any) is kept from "no".
function committeeDisplayName(c) {
  const suffix = (c.no.match(/#\d+$/) || [''])[0];
  const dateLabel = c.startMonth ? formatDate(c.startMonth) : '';
  return `${personOf(c.no)}${dateLabel ? ` (${dateLabel})` : ''}${suffix ? ` ${suffix}` : ''}`;
}

function renderCommittees() {
  $('committeeEmpty').hidden = committees.length > 0;
  $('committeeEmpty').querySelector('p').textContent = 'No committees yet';
  $('committeeList').innerHTML = committees.map((c) => `
    <div class="person-summary-row committee-row" data-no="${escapeHtml(c.no)}">
      <div class="person-avatar">${escapeHtml(personOf(c.no).charAt(0).toUpperCase())}</div>
      <div class="person-summary-main">
        <div class="person-summary-name">Committee #${escapeHtml(committeeDisplayName(c))}</div>
        <div class="person-summary-meta">${c.totalMembers} members · ${c.totalMonths} months · ${currency(c.monthlyAmount)}/month${c.startMonth ? ` · ${escapeHtml(formatDate(c.startMonth))} → ${escapeHtml(formatDate(committeeEndDate(c)))}` : ''}</div>
      </div>
      <div class="person-summary-balance ${c.status === 'Closed' ? 'owing' : 'owed'}"><small>${escapeHtml(c.status || 'Running')}</small></div>
    </div>`).join('');
}

// Every unfilled month up to and including the current calendar month is
// editable at once (not just the single earliest one) — needed to backfill
// several months of an existing committee's history in one sitting. Months
// beyond today stay locked, since that GHATA hasn't happened yet.
function editableMonths() {
  const today = currentYYYYMM();
  return committeeMonths.filter((m) => !(m.ghata || m.boliDate) && m.month <= today).map((m) => m.month).sort();
}
// The exact Boli date is inferred from the committee's start date's day-of-month
// applied to whichever month is picked — the day only needs to be set once, on
// the committee itself, not re-entered every month. Clamped for short months
// (e.g. a day-31 start date falls back to the 28th/29th/30th in February etc.).
function boliDateFor(committee, monthYYYYMM) {
  if (!monthYYYYMM) return '';
  const [y, m] = monthYYYYMM.split('-').map(Number);
  if (!y || !m) return '';
  const day = committee && committee.startMonth ? Number(committee.startMonth.slice(8, 10)) || 1 : 1;
  const lastDayOfMonth = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, lastDayOfMonth)).padStart(2, '0')}`;
}

function populateCommitteeSelect(preselectNo) {
  const sel = $('instCommitteeSelect');
  sel.innerHTML = committees.map((c) => `<option value="${escapeHtml(c.no)}">Committee #${escapeHtml(committeeDisplayName(c))}</option>`).join('');
  if (preselectNo) sel.value = preselectNo;
  selectedCommitteeNo = sel.value || null;
  renderCommitteeInfo();
  loadCommitteeInstalments();
  loadCommitteeMonths();
}

async function loadCommitteeInstalments() {
  if (!selectedCommitteeNo) { committeeInstalments = []; renderCommitteeInstalments(); return; }
  const response = await committeeRequest({ action: 'committeeInstalments', no: selectedCommitteeNo });
  committeeInstalments = (response && response.instalments) || [];
  renderCommitteeInstalments();
}

async function loadCommitteeMonths() {
  if (!selectedCommitteeNo) { committeeMonths = []; renderMonthHistory(); return; }
  const response = await committeeRequest({ action: 'committeeMonths', no: selectedCommitteeNo });
  committeeMonths = (response && response.months) || [];
  renderMonthHistory();
}

// The table IS the entry form: every saved month is a plain read-only row, and
// the single earliest unfilled month renders its Actual GHATA and Taken cells
// as inputs instead — that's the only thing "Save this month" ever writes to.
function renderMonthHistory() {
  const committee = committeeByNo(selectedCommitteeNo);
  const sorted = [...committeeMonths].sort((a, b) => a.month.localeCompare(b.month));
  const editable = editableMonths();
  $('monthHistoryEmpty').hidden = sorted.length > 0;
  $('m_openEmpty').hidden = editable.length > 0 || !sorted.length;
  $('m_currentMonthLabel').textContent = editable.length
    ? `${editable.length} month${editable.length > 1 ? 's' : ''} need GHATA entries: ${editable.map(formatMonth).join(', ')}`
    : '';

  // Sarkari GHATA and Boli date are pure functions of the committee's own
  // numbers (cut%, start date) and don't depend on anything being saved yet —
  // compute them fresh client-side for every row instead of trusting
  // whatever the sheet happened to have (which for never-touched future rows
  // is just whatever the committee looked like the moment it was created).
  // Every unfilled month up to the current calendar month is editable at
  // once, not just one at a time, so an existing committee's backlog of
  // months can be entered in one sitting.
  $('monthHistory').innerHTML = sorted.map((m) => {
    const sarkariGhata = sarkariGhataFor(committee, m.month);
    const boliDate = m.boliDate || boliDateFor(committee, m.month);
    const filled = m.ghata || m.boliDate;
    // The pot amount (total collected = whole pot minus GHATA) is shown for
    // every filled month regardless of who took it — "Taken: No" just means
    // someone other than this committee's own person took it that month, not
    // that no one did, so the amount is still worth seeing either way.
    const potAmount = filled ? committee.totalAmount - m.ghata : null;
    if (!editable.includes(m.month)) {
      return `
      <tr class="${m.takenBy ? 'month-taken' : ''}">
        <td>${boliDate ? formatDate(boliDate) : '—'}</td>
        <td>${currency(sarkariGhata)}</td>
        <td>${filled ? currency(m.ghata) : '—'}</td>
        <td>${filled ? currency(m.kist) : '—'}</td>
        <td>${potAmount !== null ? currency(potAmount) : '—'}</td>
        <td>${m.takenBy ? 'Yes' : 'No'}</td>
      </tr>`;
    }
    const record = committeeInstalments[0];
    const takenSelected = record && record.isTaken === 'Yes' && record.takenMonth === m.month;
    return `
    <tr class="month-open" data-month="${m.month}">
      <td>${boliDate ? formatDate(boliDate) : '—'}</td>
      <td>${currency(sarkariGhata)}</td>
      <td><input class="ghata-input" type="number" min="0" value="${m.ghata || ''}"></td>
      <td class="kist-cell">${currency(kistFor(committee, m.ghata))}</td>
      <td class="pot-cell">${currency(committee.totalAmount - (Number(m.ghata) || 0))}</td>
      <td><select class="taken-select"><option ${!takenSelected ? 'selected' : ''}>No</option><option ${takenSelected ? 'selected' : ''}>Yes</option></select></td>
    </tr>`;
  }).join('');
  $('saveMonthsButton').hidden = !editable.length;
}

function renderCommitteeInfo() {
  const committee = committeeByNo(selectedCommitteeNo);
  $('m_committeeInfo').textContent = committee ? `Committee #${committeeDisplayName(committee)}` : 'Pick a committee to see its details.';
  $('m_committeeFacts').hidden = !committee;
  if (!committee) return;
  $('cf_members').textContent = committee.totalMembers;
  $('cf_monthly').textContent = currency(committee.monthlyAmount);
  $('cf_total').textContent = currency(committee.totalAmount);
  $('cf_cut').textContent = `${committee.cutPercent}%`;
  $('cf_start').textContent = committee.startMonth ? formatDate(committee.startMonth) : '—';
  $('cf_end').textContent = committee.startMonth ? formatDate(committeeEndDate(committee)) : '—';
}

// One shared button saves every filled-in open row together, and the table
// only refreshes once at the end — saving each row separately used to reload
// the whole table after every click, wiping out whatever was still typed
// (but not yet saved) in the other open rows.
async function saveCommitteeMonths() {
  const no = selectedCommitteeNo;
  const committee = committeeByNo(no);
  const rows = [...document.querySelectorAll('#monthHistory tr[data-month]')]
    .filter((row) => row.querySelector('.ghata-input').value.trim() !== '');
  if (!rows.length) { showToast('Enter GHATA for at least one month first'); return; }

  for (const row of rows) {
    const month = row.dataset.month;
    const ghata = Number(row.querySelector('.ghata-input').value) || 0;
    const minGhata = sarkariGhataFor(committee, month);
    if (minGhata !== '' && ghata < minGhata) {
      showToast(`${formatMonth(month)}: GHATA can't be less than the Sarkari minimum of ${currency(minGhata)}`);
      return;
    }
  }

  let saved = 0;
  for (const row of rows) {
    const month = row.dataset.month;
    const ghata = Number(row.querySelector('.ghata-input').value) || 0;
    const taken = row.querySelector('.taken-select').value;
    // This one does more sheet work server-side (updating the committee's whole
    // month timeline) than other calls, so it gets a longer timeout margin.
    // "member" (who actually withdraws this slot's pot) is always Renu for now — see the
    // matching comment in saveMonthView.
    const response = await committeeRequest({ action: 'saveCommitteeMonth', no, month, ghata, boliDate: boliDateFor(committee, month), taken, member: 'Renu' }, 25000);
    if (response && response.ok) saved++;
  }
  showToast(saved === rows.length
    ? `${saved} month${saved > 1 ? 's' : ''} saved`
    : `Saved ${saved} of ${rows.length} months — check the connection and try the rest again`);
  await Promise.all([loadCommitteeMonths(), loadCommitteeInstalments()]);
  loadCommitteeUnverifiedBadge();
}

// The committee has exactly one instalment row — its own person's — tracking
// whether (and which month) they took the pot.
function renderCommitteeInstalments() {
  renderMonthHistory();
}

function renderVerifyList() {
  $('verifyCount').textContent = pendingVerification.length ? `${pendingVerification.length} pending` : 'All caught up';
  $('verifyEmpty').hidden = pendingVerification.length > 0;
  $('verifySubmitButton').hidden = pendingVerification.length === 0;
  $('verifyList').innerHTML = pendingVerification.map((entry, index) => `
    <div class="verify-card" data-index="${index}">
      <label class="verify-check"><input type="checkbox" class="verify-include" checked></label>
      <div class="verify-fields">
        <div class="verify-row">
          <input class="verify-date" type="date" value="${entry.date}">
          <select class="verify-type">
            <option value="credit" ${entry.type === 'credit' ? 'selected' : ''}>Credit</option>
            <option value="debit" ${entry.type === 'debit' ? 'selected' : ''}>Debit</option>
          </select>
        </div>
        <div class="verify-row">
          <input class="verify-person" type="text" value="${escapeHtml(entry.person)}">
          <input class="verify-amount" type="number" min="0.01" step="0.01" value="${entry.amount}">
        </div>
        <input class="verify-note" type="text" placeholder="Note" value="${escapeHtml(entry.note)}">
      </div>
    </div>`).join('');
}

function updateVerifyBadge() {
  const badge = $('verifyBadge');
  badge.textContent = pendingVerification.length;
  badge.hidden = pendingVerification.length === 0;
}

async function loadUnverified() {
  const response = await jsonpRequest({ action: 'unverified' });
  if (!response || !response.ok) { $('verifyCount').textContent = 'Could not load'; return; }
  pendingVerification = response.transactions || [];
  updateVerifyBadge();
  if (!$('verifyView').hidden) renderVerifyList();
}

async function submitVerification() {
  const updates = [];
  document.querySelectorAll('.verify-card').forEach((card) => {
    if (!card.querySelector('.verify-include').checked) return;
    const entry = pendingVerification[Number(card.dataset.index)];
    updates.push({
      id: entry.id,
      date: card.querySelector('.verify-date').value || entry.date,
      type: card.querySelector('.verify-type').value,
      person: card.querySelector('.verify-person').value.trim() || entry.person,
      category: entry.category,
      amount: Number(card.querySelector('.verify-amount').value) || entry.amount,
      note: card.querySelector('.verify-note').value.trim(),
    });
  });
  if (!updates.length) { showToast('Select at least one transaction'); return; }
  $('verifySubmitButton').disabled = true;
  const response = await jsonpRequest({ action: 'verify', updates: JSON.stringify(updates) });
  $('verifySubmitButton').disabled = false;
  if (!response || !response.ok) { showToast('Could not verify — check connection'); return; }
  showToast(`${updates.length} transaction(s) verified`);
  await Promise.all([loadUnverified(), loadTransactions()]);
}

function renderPeopleDirectory() {
  const term = $('peopleSearch').value.trim().toLowerCase();
  const names = people.filter((name) => name.toLowerCase().includes(term));
  $('peopleDirectoryEmpty').hidden = names.length > 0;
  $('peopleDirectory').innerHTML = names.map((name) => {
    const summary = personSummary(name);
    const state = summary.net > 0 ? 'owed' : summary.net < 0 ? 'owing' : 'settled';
    const label = state === 'owed' ? 'They owe you' : state === 'owing' ? 'You owe them' : 'Settled';
    return `
    <div class="person-summary-row" data-person="${escapeHtml(name)}">
      <div class="person-avatar">${escapeHtml(name.charAt(0).toUpperCase())}</div>
      <div class="person-summary-main">
        <div class="person-summary-name">${escapeHtml(name)}</div>
        <div class="person-summary-meta">${summary.count} entries${summary.lastDate ? ` · last on ${formatDate(summary.lastDate)}` : ''}</div>
      </div>
      <div class="person-summary-balance ${state}">
        <strong>${currency(Math.abs(summary.net))}</strong>
        <small>${label}</small>
      </div>
    </div>`;
  }).join('');
}

function renderPersonDetail() {
  const name = selectedPerson;
  const summary = personSummary(name);
  const state = summary.net > 0 ? 'owed' : summary.net < 0 ? 'owing' : 'settled';
  const label = state === 'owed' ? 'They owe you' : state === 'owing' ? 'You owe them' : 'Settled';
  $('personDetailName').textContent = name;
  $('personDetailMeta').textContent = `${summary.count} entries${summary.firstDate ? ` · since ${formatDate(summary.firstDate)}` : ''}`;
  $('personBalanceCard').className = `person-balance-card ${state}`;
  $('personBalanceLabel').textContent = label;
  $('personBalanceAmount').textContent = currency(Math.abs(summary.net));
  const total = summary.credit + summary.debit;
  $('personBalanceFill').style.width = `${total > 0 ? (summary.credit / total) * 100 : 50}%`;
  $('personCreditTotal').textContent = currency(summary.credit);
  $('personDebitTotal').textContent = currency(summary.debit);
  // The credit/debit split above is ledger-only, so it won't add up to the
  // combined balance once a committee due is folded in — spell that out
  // rather than leaving the numbers looking inconsistent.
  const committeeNote = $('personCommitteeNote');
  committeeNote.hidden = summary.committeeNet === 0;
  if (summary.committeeNet !== 0) {
    const committeeState = summary.committeeNet > 0 ? `${name} owes you` : `You owe ${name}`;
    committeeNote.textContent = `Includes ${currency(Math.abs(summary.committeeNet))} from committees (${committeeState}) — record a lumpsum payment as a normal credit/debit entry here to settle it.`;
  }

  let runningBalance = 0;
  const withBalance = summary.list.map((entry) => {
    runningBalance += entry.type === 'credit' ? entry.amount : -entry.amount;
    return { ...entry, balanceAfter: runningBalance };
  });
  const visible = withBalance.filter((entry) => personFilter === 'all' || entry.type === personFilter).slice().reverse();
  $('personTransactionEmpty').hidden = visible.length > 0;
  $('personTransactionList').innerHTML = visible.map((entry) => `
    <div class="transaction ${entry.type}">
      <div class="transaction-mark">${entry.type === 'credit' ? '↓' : '↑'}</div>
      <div class="transaction-main"><div class="transaction-person">${escapeHtml(entry.note || 'No purpose noted')}</div><div class="transaction-note">${formatDate(entry.date)} · Bal ${currency(entry.balanceAfter)}</div></div>
      <div class="transaction-amount">${entry.type === 'credit' ? '+' : '-'}${currency(entry.amount)}</div>
    </div>`).join('');
}

function setTransactionType(type) {
  transactionType = type;
  $('creditButton').classList.toggle('active', type === 'credit');
  $('debitButton').classList.toggle('active', type === 'debit');
}

$('creditButton').addEventListener('click', () => setTransactionType('credit'));
$('debitButton').addEventListener('click', () => setTransactionType('debit'));

$('entryForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const cards = [...document.querySelectorAll('.person-card')].filter((card) => Number(card.querySelector('.person-amount').value) > 0);
  if (!cards.length) { showToast('Enter an amount for at least one person'); return; }
  const newEntries = cards.map((card) => ({
    id:crypto.randomUUID(),
    type:transactionType,
    category:'',
    person:card.dataset.person,
    amount:Number(card.querySelector('.person-amount').value),
    date:card.querySelector('.person-date').value || today(),
    note:card.querySelector('.person-purpose').value.trim(),
    createdAt:new Date().toISOString(),
  }));
  entries.push(...newEntries); localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); render(); setTransactionType('credit'); renderPeople();
  const results = await Promise.all(newEntries.map(syncEntry)); showToast(results.every(Boolean) ? 'Saved and synced to Google Sheet' : 'Saved on this phone');
});
$('clearFilter').addEventListener('click', () => { showingAll = !showingAll; render(); });

document.querySelectorAll('.tab-button[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
$('settingsTabButton').addEventListener('click', () => { $('settingsDialog').showModal(); loadAllPeople(); });
$('peopleSearch').addEventListener('input', renderPeopleDirectory);
$('peopleDirectory').addEventListener('click', (event) => {
  const row = event.target.closest('.person-summary-row');
  if (!row) return;
  selectedPerson = row.dataset.person;
  personFilter = 'all';
  document.querySelectorAll('#personDetailView .filter-switch .type-option').forEach((btn) => btn.classList.toggle('active', btn.dataset.filter === 'all'));
  switchView('personDetail');
});
$('personBackButton').addEventListener('click', () => switchView('people'));
document.querySelectorAll('#personDetailView .filter-switch .type-option').forEach((button) => button.addEventListener('click', () => {
  personFilter = button.dataset.filter;
  document.querySelectorAll('#personDetailView .filter-switch .type-option').forEach((btn) => btn.classList.toggle('active', btn === button));
  renderPersonDetail();
}));
function setPersonEntryType(type) {
  personEntryType = type;
  $('personEntryCreditButton').classList.toggle('active', type === 'credit');
  $('personEntryDebitButton').classList.toggle('active', type === 'debit');
}
$('personEntryCloseButton').addEventListener('click', () => $('personEntryDialog').close());
$('personEntryCreditButton').addEventListener('click', () => setPersonEntryType('credit'));
$('personEntryDebitButton').addEventListener('click', () => setPersonEntryType('debit'));

$('personAddEntryButton').addEventListener('click', () => {
  $('personEntryFor').textContent = `FOR ${selectedPerson.toUpperCase()}`;
  setPersonEntryType('credit');
  $('personEntryAmount').value = '';
  $('personEntryDate').value = today();
  $('personEntryPurpose').value = '';
  $('personEntryDialog').showModal();
  $('personEntryAmount').focus();
});

$('personEntrySaveButton').addEventListener('click', async () => {
  const amount = Number($('personEntryAmount').value);
  if (!amount || amount <= 0) { showToast('Enter an amount'); return; }
  const entry = {
    id:crypto.randomUUID(),
    type:personEntryType,
    category:'',
    person:selectedPerson,
    amount,
    date:$('personEntryDate').value || today(),
    note:$('personEntryPurpose').value.trim(),
    createdAt:new Date().toISOString(),
  };
  entries.push(entry); localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  render(); renderPeople(); renderPersonDetail(); renderPeopleDirectory();
  $('personEntryDialog').close();
  const ok = await syncEntry(entry);
  showToast(ok ? 'Saved and synced to Google Sheet' : 'Saved on this phone');
});
$('settingsForm').addEventListener('submit', (event) => { event.preventDefault(); $('settingsDialog').close(); });
document.querySelectorAll('#committeeView > .type-switch [data-csub]').forEach((button) => button.addEventListener('click', () => switchCommitteeSub(button.dataset.csub)));
document.querySelectorAll('#committeeSub-manage [data-msub]').forEach((button) => button.addEventListener('click', () => switchManageSub(button.dataset.msub)));
document.querySelectorAll('.type-switch [data-areport]').forEach((button) => button.addEventListener('click', () => switchAnalysisReport(button.dataset.areport)));
$('committeeList').addEventListener('click', (event) => {
  const row = event.target.closest('.committee-row');
  if (!row) return;
  switchCommitteeSub('manage');
  switchManageSub('instalments', row.dataset.no);
});
// A committee pays out to one member per month, so months = members; the monthly
// instalment is the total pot (entered in lakhs) split evenly across members.
function committeeTotalsFromForm() {
  const totalMembers = Number($('c_members').value) || 0;
  const totalAmount = (Number($('c_totalLakhs').value) || 0) * 100000;
  const monthlyAmount = totalMembers ? Math.round(totalAmount / totalMembers) : 0;
  return { totalMembers, totalAmount, monthlyAmount };
}
function updateCommitteePreview() {
  const { totalMembers, totalAmount, monthlyAmount } = committeeTotalsFromForm();
  const start = $('c_start').value;
  const end = start && totalMembers ? addMonthsToDate(start, totalMembers - 1) : '';
  const parts = [];
  if (totalMembers && totalAmount) parts.push(`${totalMembers} months · ${currency(monthlyAmount)}/month · Total ${currency(totalAmount)}`);
  if (end) parts.push(`Runs ${formatDate(start)} → ${formatDate(end)}`);
  $('c_preview').textContent = parts.length ? parts.join(' · ') : 'Months and the monthly instalment are worked out automatically from the total amount, member count, and start date.';
}
$('c_no').addEventListener('change', showExistingCommitteesHint);
$('c_members').addEventListener('input', updateCommitteePreview);
$('c_totalLakhs').addEventListener('input', updateCommitteePreview);
$('c_start').addEventListener('input', updateCommitteePreview);

$('committeeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const person = $('c_no').value.trim();
  if (!person) { showToast('Pick a committee person'); return; }
  const start = $('c_start').value;
  if (!start) { showToast('Pick a start date'); return; }
  // The start date is folded into the identifier so the same person can run more
  // than one committee (e.g. two different rounds) without them colliding —
  // this also makes them easy to tell apart in the committee list and dropdown.
  // If that's somehow still not unique (e.g. two committees for the same person
  // starting the same day), keep appending a counter rather than silently
  // colliding two committees into the same rows/sheet.
  let no = `${person} (${formatDate(start)})`;
  let suffix = 2;
  while (committees.some((c) => c.no === no)) { no = `${person} (${formatDate(start)}) #${suffix++}`; }
  const { totalMembers, totalAmount, monthlyAmount } = committeeTotalsFromForm();
  const response = await committeeRequest({
    action: 'addCommittee', no,
    totalMembers, totalMonths: totalMembers,
    monthlyAmount, totalAmount,
    cutPercent: $('c_cut').value,
    startMonth: $('c_start').value, status: $('c_status').value,
  });
  if (!response || !response.ok) { showToast('Could not save — check the committee connection'); return; }
  showToast('Committee saved');
  event.target.reset();
  updateCommitteePreview();
  switchManageSub('list');
  loadCommittees();
});
$('instCommitteeSelect').addEventListener('change', (event) => {
  selectedCommitteeNo = event.target.value || null;
  renderCommitteeInfo();
  loadCommitteeInstalments();
  loadCommitteeMonths();
});
// Rows are re-created on every render (they live inside the History table's
// open rows), so this has to be delegated from a stable ancestor.
$('monthHistory').addEventListener('input', (event) => {
  if (!event.target.classList.contains('ghata-input')) return;
  const committee = committeeByNo(selectedCommitteeNo);
  const ghata = Number(event.target.value) || 0;
  const row = event.target.closest('tr');
  row.querySelector('.kist-cell').textContent = currency(kistFor(committee, ghata));
  row.querySelector('.pot-cell').textContent = currency(committee.totalAmount - ghata);
});
$('saveMonthsButton').addEventListener('click', saveCommitteeMonths);
$('mv_month').addEventListener('change', () => loadMonthView($('mv_month').value));
// Rows are re-created on every render, so this has to be delegated from a stable ancestor.
$('monthViewBody').addEventListener('input', (event) => {
  if (!event.target.classList.contains('mv-ghata-input')) return;
  const row = event.target.closest('tr');
  const committee = committeeByNo(row.dataset.no);
  const ghata = Number(event.target.value) || 0;
  row.querySelector('.mv-kist-cell').textContent = currency(kistFor(committee, ghata));
});
$('saveMonthViewButton').addEventListener('click', saveMonthView);
$('committeeVerifySubmitButton').addEventListener('click', submitCommitteeVerification);
$('addPersonButton').addEventListener('click', addPerson);
$('newPersonName').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addPerson(); } });
$('newPersonMobile').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addPerson(); } });
$('managePeopleList').addEventListener('click', (event) => {
  const button = event.target.closest('.status-toggle');
  if (!button) return;
  setPersonActive(button.dataset.name, button.dataset.active !== 'true');
});
$('verifySubmitButton').addEventListener('click', submitVerification);
$('exportButton').addEventListener('click', () => { const blob = new Blob([JSON.stringify(entries, null, 2)], { type:'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `khata-daily-${today()}.json`; link.click(); URL.revokeObjectURL(link.href); });

// ---------- Access: Groups / Levels / Team / Projects (management only, no login yet) ----------

function switchAccessSub(sub) {
  accessSub = sub;
  ['groups', 'levels', 'team', 'projects'].forEach((name) => { $(`accessSub-${name}`).hidden = name !== sub; });
  document.querySelectorAll('#accessView > .type-switch [data-asub]').forEach((button) => button.classList.toggle('active', button.dataset.asub === sub));
  if (sub === 'groups') loadGroups();
  if (sub === 'levels') loadAuthLevels();
  if (sub === 'team') { loadAuthLevels(); loadAppUsers(); }
  if (sub === 'projects') loadProjects();
}

async function loadGroups() {
  const response = await jsonpRequest({ action: 'listGroups' });
  if (!response || !response.ok) { showToast('Could not load groups'); return; }
  groups = response.groups || [];
  const keepSelection = groups.some((g) => String(g.id) === String(selectedGroupId));
  $('ag_groupSelect').innerHTML = groups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)} (${g.memberCount})</option>`).join('') || '<option value="">No groups yet</option>';
  if (groups.length) { $('ag_groupSelect').value = keepSelection ? selectedGroupId : groups[0].id; loadGroupMembers(); }
  else { selectedGroupId = null; $('ag_membersList').innerHTML = '<small class="dialog-copy">No groups yet — add one below.</small>'; }
}

async function loadGroupMembers() {
  selectedGroupId = $('ag_groupSelect').value;
  if (!selectedGroupId) return;
  const response = await jsonpRequest({ action: 'groupMembers', groupId: selectedGroupId });
  if (!response || !response.ok) { showToast('Could not load members'); return; }
  const members = response.members || [];
  $('ag_membersList').innerHTML = members.length ? members.map((m) => `
    <div class="manage-person-row">
      <span>${escapeHtml(m.person)}</span>
      <button type="button" class="text-button" data-remove-member="${m.id}">Remove</button>
    </div>`).join('') : '<small class="dialog-copy">No members yet.</small>';
  const memberNames = new Set(members.map((m) => m.person));
  const available = people.filter((name) => !memberNames.has(name));
  $('ag_addPersonSelect').innerHTML = available.length ? available.map((name) => `<option>${escapeHtml(name)}</option>`).join('') : '<option value="">No one left to add</option>';
}

$('ag_groupSelect').addEventListener('change', loadGroupMembers);
$('ag_addMemberButton').addEventListener('click', async () => {
  const person = $('ag_addPersonSelect').value;
  if (!person || !selectedGroupId) return;
  const response = await jsonpRequest({ action: 'addGroupMember', groupId: selectedGroupId, person });
  if (!response || !response.ok) { showToast('Could not add member'); return; }
  await loadGroups();
});
$('ag_membersList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-remove-member]');
  if (!button) return;
  const response = await jsonpRequest({ action: 'removeGroupMember', id: button.dataset.removeMember });
  if (!response || !response.ok) { showToast('Could not remove member'); return; }
  await loadGroups();
});
$('ag_addGroupButton').addEventListener('click', async () => {
  const name = $('ag_newGroupName').value.trim();
  if (!name) return;
  const response = await jsonpRequest({ action: 'addGroup', name, description: $('ag_newGroupDesc').value.trim() });
  if (!response || !response.ok) { showToast('Could not add group'); return; }
  $('ag_newGroupName').value = ''; $('ag_newGroupDesc').value = '';
  showToast(`${name} added`);
  await loadGroups();
});

async function loadAuthLevels() {
  const response = await jsonpRequest({ action: 'listAuthLevels' });
  if (!response || !response.ok) { showToast('Could not load levels'); return; }
  authLevels = response.levels || [];
  const options = authLevels.map((l) => `<option value="${l.id}">${escapeHtml(l.name)} (rank ${l.rank})</option>`).join('');
  const keepSelection = authLevels.some((l) => String(l.id) === String(selectedLevelId));
  $('al_levelSelect').innerHTML = options || '<option value="">No levels yet</option>';
  $('at_newUserLevel').innerHTML = options || '<option value="">Add a level first</option>';
  if (authLevels.length) { $('al_levelSelect').value = keepSelection ? selectedLevelId : authLevels[0].id; loadLevelDetails(); }
  else { selectedLevelId = null; $('al_groupsList').innerHTML = '<small class="dialog-copy">No levels yet — add one below.</small>'; $('al_personsList').innerHTML = ''; }
}

async function loadLevelDetails() {
  selectedLevelId = $('al_levelSelect').value;
  if (!selectedLevelId) return;
  const [groupsRes, personsRes] = await Promise.all([
    jsonpRequest({ action: 'levelGroups', levelId: selectedLevelId }),
    jsonpRequest({ action: 'levelPersons', levelId: selectedLevelId }),
  ]);
  const grantedGroups = (groupsRes && groupsRes.ok) ? groupsRes.groups : [];
  const grantedPersons = (personsRes && personsRes.ok) ? personsRes.persons : [];
  $('al_groupsList').innerHTML = grantedGroups.length ? grantedGroups.map((g) => `
    <div class="manage-person-row">
      <span>${escapeHtml(g.groupName)}</span>
      <button type="button" class="text-button" data-revoke-group="${g.id}">Revoke</button>
    </div>`).join('') : '<small class="dialog-copy">No groups granted yet.</small>';
  $('al_personsList').innerHTML = grantedPersons.length ? grantedPersons.map((p) => `
    <div class="manage-person-row">
      <span>${escapeHtml(p.person)}</span>
      <button type="button" class="text-button" data-revoke-person="${p.id}">Revoke</button>
    </div>`).join('') : '<small class="dialog-copy">No people granted directly yet.</small>';
  const grantedGroupIds = new Set(grantedGroups.map((g) => String(g.groupId)));
  const availableGroups = groups.filter((g) => !grantedGroupIds.has(String(g.id)));
  $('al_addGroupSelect').innerHTML = availableGroups.length ? availableGroups.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('') : '<option value="">No groups left to grant</option>';
  const grantedPersonNames = new Set(grantedPersons.map((p) => p.person));
  const availablePersons = people.filter((name) => !grantedPersonNames.has(name));
  $('al_addPersonSelect').innerHTML = availablePersons.length ? availablePersons.map((name) => `<option>${escapeHtml(name)}</option>`).join('') : '<option value="">No one left to add</option>';
}

$('al_levelSelect').addEventListener('change', loadLevelDetails);
$('al_grantGroupButton').addEventListener('click', async () => {
  const groupId = $('al_addGroupSelect').value;
  if (!groupId || !selectedLevelId) return;
  const response = await jsonpRequest({ action: 'grantLevelGroup', levelId: selectedLevelId, groupId });
  if (!response || !response.ok) { showToast('Could not grant group'); return; }
  await loadLevelDetails();
});
$('al_grantPersonButton').addEventListener('click', async () => {
  const person = $('al_addPersonSelect').value;
  if (!person || !selectedLevelId) return;
  const response = await jsonpRequest({ action: 'grantLevelPerson', levelId: selectedLevelId, person });
  if (!response || !response.ok) { showToast('Could not grant person'); return; }
  await loadLevelDetails();
});
$('al_groupsList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-revoke-group]');
  if (!button) return;
  const response = await jsonpRequest({ action: 'revokeLevelGroup', id: button.dataset.revokeGroup });
  if (!response || !response.ok) { showToast('Could not revoke'); return; }
  await loadLevelDetails();
});
$('al_personsList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-revoke-person]');
  if (!button) return;
  const response = await jsonpRequest({ action: 'revokeLevelPerson', id: button.dataset.revokePerson });
  if (!response || !response.ok) { showToast('Could not revoke'); return; }
  await loadLevelDetails();
});
$('al_addLevelButton').addEventListener('click', async () => {
  const name = $('al_newLevelName').value.trim();
  const rank = $('al_newLevelRank').value;
  if (!name || rank === '') { showToast('Enter a name and rank'); return; }
  const response = await jsonpRequest({ action: 'addAuthLevel', name, rank, description: $('al_newLevelDesc').value.trim() });
  if (!response || !response.ok) { showToast('Could not add level'); return; }
  $('al_newLevelName').value = ''; $('al_newLevelRank').value = ''; $('al_newLevelDesc').value = '';
  showToast(`${name} added`);
  await loadAuthLevels();
});

async function loadAppUsers() {
  const response = await jsonpRequest({ action: 'listAppUsers' });
  if (!response || !response.ok) { showToast('Could not load team'); return; }
  const users = response.users || [];
  $('at_userList').innerHTML = users.length ? users.map((u) => `
    <div class="manage-person-row">
      <span>${escapeHtml(u.username)}</span>
      <small class="dialog-copy">${escapeHtml(u.levelName || 'No level')}</small>
    </div>`).join('') : '<small class="dialog-copy">No team members yet.</small>';
}

$('at_addUserButton').addEventListener('click', async () => {
  const username = $('at_newUsername').value.trim();
  const levelId = $('at_newUserLevel').value;
  if (!username || !levelId) { showToast('Enter a username and pick a level'); return; }
  const response = await jsonpRequest({ action: 'addAppUser', username, levelId });
  if (!response || !response.ok) { showToast('Could not add team member'); return; }
  $('at_newUsername').value = '';
  showToast(`${username} added`);
  await loadAppUsers();
});

let selectedPayProjectId = null;

async function loadProjects() {
  const response = await jsonpRequest({ action: 'listProjects' });
  if (!response || !response.ok) { showToast('Could not load projects'); return; }
  const projects = response.projects || [];
  $('ap_projectList').innerHTML = projects.length ? projects.map((p) => `
    <div class="manage-person-row" data-project-id="${p.id}" data-project-name="${escapeHtml(p.name)}" role="button" tabindex="0">
      <span>${escapeHtml(p.name)}</span>
      <small class="dialog-copy">${escapeHtml([p.location, p.status].filter(Boolean).join(' · ')) || 'Tap to pay a group'}</small>
    </div>`).join('') : '<small class="dialog-copy">No projects yet.</small>';
  const keepSelection = projects.some((p) => String(p.id) === String(selectedPayProjectId));
  $('ap_projectSelect').innerHTML = projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('') || '<option value="">No projects yet</option>';
  if (projects.length) { $('ap_projectSelect').value = keepSelection ? selectedPayProjectId : projects[0].id; loadLinkedGroups(); }
  else { selectedPayProjectId = null; $('ap_linkedGroupsList').innerHTML = '<small class="dialog-copy">No projects yet — add one below.</small>'; }
}

async function loadLinkedGroups() {
  selectedPayProjectId = $('ap_projectSelect').value;
  if (!selectedPayProjectId) return;
  const [linkedRes, allRes] = await Promise.all([
    jsonpRequest({ action: 'projectGroups', projectId: selectedPayProjectId }),
    jsonpRequest({ action: 'listGroups' }),
  ]);
  const linked = (linkedRes && linkedRes.ok) ? linkedRes.groups : [];
  const allGroups = (allRes && allRes.ok) ? allRes.groups : [];
  $('ap_linkedGroupsList').innerHTML = linked.length ? linked.map((g) => `
    <div class="manage-person-row">
      <span>${escapeHtml(g.groupName)}</span>
      <button type="button" class="text-button" data-unlink-group="${g.id}">Unlink</button>
    </div>`).join('') : '<small class="dialog-copy">No groups linked yet.</small>';
  const linkedIds = new Set(linked.map((g) => String(g.groupId)));
  const available = allGroups.filter((g) => !linkedIds.has(String(g.id)));
  $('ap_addGroupSelect').innerHTML = available.length ? available.map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('') : '<option value="">No groups left to link</option>';
}

$('ap_projectSelect').addEventListener('change', loadLinkedGroups);
$('ap_linkGroupButton').addEventListener('click', async () => {
  const groupId = $('ap_addGroupSelect').value;
  if (!groupId || !selectedPayProjectId) return;
  const response = await jsonpRequest({ action: 'linkGroupProject', projectId: selectedPayProjectId, groupId });
  if (!response || !response.ok) { showToast('Could not link group'); return; }
  await loadLinkedGroups();
});
$('ap_linkedGroupsList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-unlink-group]');
  if (!button) return;
  const response = await jsonpRequest({ action: 'unlinkGroupProject', id: button.dataset.unlinkGroup });
  if (!response || !response.ok) { showToast('Could not unlink group'); return; }
  await loadLinkedGroups();
});

$('ap_projectList').addEventListener('click', (event) => {
  const row = event.target.closest('[data-project-id]');
  if (!row) return;
  openProjectPay(row.dataset.projectId, row.dataset.projectName);
});

$('ap_addProjectButton').addEventListener('click', async () => {
  const name = $('ap_newProjectName').value.trim();
  if (!name) return;
  const response = await jsonpRequest({
    action: 'addProject', name,
    location: $('ap_newProjectLocation').value.trim(),
    status: $('ap_newProjectStatus').value.trim(),
    startDate: $('ap_newProjectStart').value,
  });
  if (!response || !response.ok) { showToast('Could not add project'); return; }
  $('ap_newProjectName').value = ''; $('ap_newProjectLocation').value = ''; $('ap_newProjectStatus').value = ''; $('ap_newProjectStart').value = '';
  showToast(`${name} added`);
  await loadProjects();
});

document.querySelectorAll('#accessView > .type-switch [data-asub]').forEach((button) => button.addEventListener('click', () => switchAccessSub(button.dataset.asub)));

// ---------- Project Pay: pay a group for a project, with a distributor float ----------

async function openProjectPay(projectId, projectName) {
  $('projectPayName').textContent = projectName;
  $('pp_date').value = today();
  $('pp_membersList').innerHTML = '<div class="people-placeholder">Pick a group to see its people.</div>';
  $('pp_membersStatus').textContent = '';
  switchView('projectPay');
  const [groupsRes, usersRes] = await Promise.all([
    jsonpRequest({ action: 'projectGroups', projectId }),
    jsonpRequest({ action: 'listAppUsers' }),
  ]);
  const groupList = (groupsRes && groupsRes.ok) ? groupsRes.groups : [];
  const users = (usersRes && usersRes.ok) ? usersRes.users : [];
  $('pp_groupSelect').innerHTML = groupList.length
    ? '<option value="">Pick a group</option>' + groupList.map((g) => `<option value="${g.groupId}">${escapeHtml(g.groupName)}</option>`).join('')
    : '<option value="">No groups linked — link one from Access → Projects</option>';
  $('pp_distributorSelect').innerHTML = '<option value="">Pick who\'s paying</option>' + users.map((u) => `<option value="${u.id}" data-username="${escapeHtml(u.username)}">${escapeHtml(u.username)} (${escapeHtml(u.levelName || 'no level')})</option>`).join('');
}

async function loadProjectPayMembers() {
  const groupId = $('pp_groupSelect').value;
  if (!groupId) { $('pp_membersList').innerHTML = '<div class="people-placeholder">Pick a group to see its people.</div>'; $('pp_membersStatus').textContent = ''; return; }
  const response = await jsonpRequest({ action: 'groupMembers', groupId });
  const members = (response && response.ok) ? response.members : [];
  $('pp_membersStatus').textContent = `${members.length} people`;
  $('pp_membersList').innerHTML = members.length ? members.map((m) => `
    <div class="person-card" data-person="${escapeHtml(m.person)}">
      <div class="person-card-top">
        <span>${escapeHtml(m.person)}</span>
        <input class="person-amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Amount">
      </div>
      <div class="person-card-fields">
        <input class="person-purpose" type="text" placeholder="Note (optional)">
      </div>
    </div>`).join('') : '<div class="people-placeholder">No one in this group yet — add members from Access → Groups.</div>';
}

$('pp_groupSelect').addEventListener('change', loadProjectPayMembers);
$('projectPayBackButton').addEventListener('click', () => switchView('access'));

$('pp_saveButton').addEventListener('click', async () => {
  const projectName = $('projectPayName').textContent;
  const distributorOption = $('pp_distributorSelect').selectedOptions[0];
  const distributorId = $('pp_distributorSelect').value;
  const distributorUsername = distributorOption ? distributorOption.dataset.username : '';
  const date = $('pp_date').value || today();
  const cards = [...document.querySelectorAll('#pp_membersList .person-card')].filter((card) => Number(card.querySelector('.person-amount').value) > 0);
  if (!distributorId) { showToast('Pick who is paying'); return; }
  if (!cards.length) { showToast('Enter an amount for at least one person'); return; }

  const newEntries = [];
  cards.forEach((card) => {
    const memberName = card.dataset.person;
    const amount = Number(card.querySelector('.person-amount').value);
    const note = card.querySelector('.person-purpose').value.trim();
    const createdAt = new Date().toISOString();
    newEntries.push({
      id: crypto.randomUUID(), type: 'credit', category: '', person: memberName, amount, date,
      note: note || `Wages via ${distributorUsername}`, createdAt, project: projectName, paidByUser: distributorId,
    });
    newEntries.push({
      id: crypto.randomUUID(), type: 'debit', category: '', person: distributorUsername, amount, date,
      note: `Paid to ${memberName}`, createdAt, project: projectName, paidByUser: distributorId,
    });
  });

  entries.push(...newEntries); localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  render(); renderPeople(); renderPeopleDirectory();
  const results = await Promise.all(newEntries.map(syncEntry));
  showToast(results.every(Boolean) ? `Paid ${cards.length} people` : 'Saved on this phone');
  switchView('access');
});

render();
switchView('people');
loadPeople();
loadUnverified();
// iOS home-screen PWAs can sit backgrounded for days without ever checking
// for a new sw.js on their own, so a shipped fix silently never reaches the
// phone until someone thinks to force-quit it. Explicitly re-check whenever
// the app comes back to the foreground, and once a new service worker takes
// over, reload so the newly-fetched index.html/app.js actually run instead
// of the old ones staying alive in memory.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((registration) => {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') registration.update(); });
    window.addEventListener('focus', () => registration.update());
  });
  let refreshingForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshingForUpdate) return;
    refreshingForUpdate = true;
    window.location.reload();
  });
}
