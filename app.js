const STORAGE_KEY = 'khata-daily-entries';
const ENDPOINT_KEY = 'khata-daily-endpoint';
const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxtJtyY1DnAwUXSQyKFiOGiMHZDuHZufY56SCplgJoat-huT1CR0PF4YPPzS6cv0i9Ckw/exec';
let entries = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let showingAll = false;
let people = [];
let transactionType = 'credit';
let selectedPerson = null;
let personFilter = 'all';
let remoteTransactions = [];
let pendingVerification = [];
let committees = [];
let committeeInstalments = [];
let committeeMonths = [];
let selectedCommitteeNo = null;
let committeeSub = 'list';

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
// remaining after this one). The boli/auction discount actually entered that month
// can't be lower than this — it's the guaranteed minimum cut.
function sarkariGhataFor(committee, monthYYYYMM) {
  if (!committee) return '';
  const idx = monthIndexFor(committee, monthYYYYMM);
  if (idx === null) return '';
  const cut = (Number(committee.cutPercent) || 0) / 100;
  return Math.max(0, Math.round(committee.totalMembers * committee.monthlyAmount * cut * (committee.totalMonths - idx)));
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

function jsonpRequest(params, timeoutMs = 12000, endpointOverride) {
  const endpoint = endpointOverride || localStorage.getItem(ENDPOINT_KEY) || DEFAULT_ENDPOINT;
  if (!endpoint) return Promise.resolve(null);
  return new Promise((resolve) => {
    const callbackName = `khataCb${Date.now()}${Math.random().toString(36).slice(2)}`;
    const cleanup = () => { delete window[callbackName]; script.remove(); };
    const timer = setTimeout(() => { cleanup(); resolve(null); }, timeoutMs);
    window[callbackName] = (response) => { clearTimeout(timer); cleanup(); resolve(response); };
    const search = new URLSearchParams({ ...params, callback: callbackName });
    const script = document.createElement('script');
    script.src = `${endpoint}${endpoint.includes('?') ? '&' : '?'}${search.toString()}`;
    script.onerror = () => { clearTimeout(timer); cleanup(); resolve(null); };
    document.body.appendChild(script);
  });
}

function committeeRequest(params, timeoutMs = 12000) {
  return jsonpRequest(params, timeoutMs);
}

async function syncEntry(entry) {
  const response = await jsonpRequest({ action:'save', id:entry.id, date:entry.date, type:entry.type, person:entry.person, category:entry.category || '', amount:String(entry.amount), note:entry.note || '', createdAt:entry.createdAt });
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
  setSyncState(true);
}

function renderManagePeople(list) {
  $('managePeopleList').innerHTML = list.length ? list.map((entry) => `
    <div class="manage-person-row">
      <span>${escapeHtml(entry.name)}</span>
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
  $('addPersonButton').disabled = true;
  const response = await jsonpRequest({ action:'addPerson', name });
  $('addPersonButton').disabled = false;
  if (!response || !response.ok) { showToast('Could not add name'); return; }
  $('newPersonName').value = '';
  showToast(`${name} added`);
  await Promise.all([loadAllPeople(), loadPeople()]);
}

async function setPersonActive(name, active) {
  const response = await jsonpRequest({ action:'setActive', name, active:String(active) });
  if (!response || !response.ok) { showToast('Could not update'); return; }
  await Promise.all([loadAllPeople(), loadPeople()]);
}

function personSummary(name) {
  const list = allEntries().filter((entry) => entry.person === name).sort((a, b) => `${a.date}${a.createdAt}`.localeCompare(`${b.date}${b.createdAt}`));
  const credit = list.filter((entry) => entry.type === 'credit').reduce((sum, entry) => sum + entry.amount, 0);
  const debit = list.filter((entry) => entry.type === 'debit').reduce((sum, entry) => sum + entry.amount, 0);
  return { list, count: list.length, firstDate: list[0]?.date, lastDate: list[list.length - 1]?.date, credit, debit, net: credit - debit };
}

function switchView(view) {
  $('homeView').hidden = view !== 'home';
  $('peopleView').hidden = view !== 'people';
  $('verifyView').hidden = view !== 'verify';
  $('personDetailView').hidden = view !== 'personDetail';
  $('committeeView').hidden = view !== 'committee';
  document.querySelectorAll('.tab-button[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view || (view === 'personDetail' && button.dataset.view === 'people')));
  if (view === 'people') { renderPeopleDirectory(); loadTransactions().then(() => { if (!$('peopleView').hidden) renderPeopleDirectory(); }); }
  if (view === 'personDetail') renderPersonDetail();
  if (view === 'verify') loadUnverified();
  if (view === 'committee') loadCommittees();
}

function switchCommitteeSub(sub, preselectNo) {
  committeeSub = sub;
  ['list', 'add', 'instalments'].forEach((name) => { $(`committeeSub-${name}`).hidden = name !== sub; });
  document.querySelectorAll('.type-switch [data-csub]').forEach((button) => button.classList.toggle('active', button.dataset.csub === sub));
  if (sub === 'add') $('c_no').innerHTML = '<option value="">Pick a person</option>' + people.map((name) => `<option>${escapeHtml(name)}</option>`).join('');
  if (sub === 'instalments') populateCommitteeSelect(preselectNo || selectedCommitteeNo);
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
function personOf(no) { return String(no || '').replace(/\s*\(.*\)$/, ''); }

function renderCommittees() {
  $('committeeEmpty').hidden = committees.length > 0;
  $('committeeEmpty').querySelector('p').textContent = 'No committees yet';
  $('committeeList').innerHTML = committees.map((c) => `
    <div class="person-summary-row committee-row" data-no="${escapeHtml(c.no)}">
      <div class="person-avatar">${escapeHtml(personOf(c.no).charAt(0).toUpperCase())}</div>
      <div class="person-summary-main">
        <div class="person-summary-name">Committee #${escapeHtml(c.no)}</div>
        <div class="person-summary-meta">${c.totalMembers} members · ${c.totalMonths} months · ${currency(c.monthlyAmount)}/month${c.startMonth ? ` · ${escapeHtml(formatDate(c.startMonth))} → ${escapeHtml(formatDate(committeeEndDate(c)))}` : ''}</div>
      </div>
      <div class="person-summary-balance ${c.status === 'Closed' ? 'owing' : 'owed'}"><small>${escapeHtml(c.status || 'Running')}</small></div>
    </div>`).join('');
}

// The only month that's ever editable is the earliest one that hasn't been
// filled in yet — no free month picker, so already-entered/confirmed months
// can't be accidentally overwritten. Returns null once every month is filled.
function openMonth() {
  const unfilled = committeeMonths.filter((m) => !m.ghata && !m.boliDate).sort((a, b) => a.month.localeCompare(b.month));
  return unfilled.length ? unfilled[0].month : null;
}
function boliMonth() { return openMonth() || ''; }
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
  sel.innerHTML = committees.map((c) => `<option value="${escapeHtml(c.no)}">Committee #${escapeHtml(c.no)}</option>`).join('');
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
  const open = openMonth();
  $('monthHistoryEmpty').hidden = sorted.length > 0;
  $('saveMonthButton').hidden = !open;
  $('m_openEmpty').hidden = !!open || !sorted.length;
  $('m_currentMonthLabel').textContent = '';

  $('monthHistory').innerHTML = sorted.map((m) => {
    if (m.month !== open) {
      return `
      <tr class="${m.takenBy ? 'month-taken' : ''}">
        <td>${m.boliDate ? formatDate(m.boliDate) : '—'}</td>
        <td>${currency(m.sarkariGhata)}</td>
        <td>${m.ghata || m.boliDate ? currency(m.ghata) : '—'}</td>
        <td>${m.ghata || m.boliDate ? currency(m.kist) : '—'}</td>
        <td>${m.takenBy ? `Yes<br><small>${currency(m.amountReceived)}</small>` : 'No'}</td>
      </tr>`;
    }
    const monthIndex = monthIndexFor(committee, m.month);
    if (committee && monthIndex !== null) {
      $('m_currentMonthLabel').textContent = `Filling: ${formatMonth(m.month)} (month ${monthIndex} of ${committee.totalMonths})`;
    }
    const record = committeeInstalments[0];
    const takenSelected = record && record.isTaken === 'Yes' && record.takenMonth === m.month;
    const boliDate = boliDateFor(committee, m.month);
    return `
    <tr class="month-open">
      <td>${boliDate ? formatDate(boliDate) : '—'}</td>
      <td>${currency(m.sarkariGhata)}</td>
      <td><input id="m_ghata" type="number" min="0" value="${m.ghata || ''}"></td>
      <td id="m_kistCell">${currency(kistFor(committee, m.ghata))}</td>
      <td><select id="m_taken"><option ${!takenSelected ? 'selected' : ''}>No</option><option ${takenSelected ? 'selected' : ''}>Yes</option></select></td>
    </tr>`;
  }).join('');
  updateMonthPreview();
}

function renderCommitteeInfo() {
  const committee = committeeByNo(selectedCommitteeNo);
  $('m_committeeInfo').textContent = committee
    ? `Committee #${committee.no}: ${committee.totalMembers} members, ${currency(committee.monthlyAmount)}/month, total pot ${currency(committee.totalAmount)}, cut ${committee.cutPercent}%/month${committee.startMonth ? `, runs ${formatDate(committee.startMonth)} → ${formatDate(committeeEndDate(committee))}` : ''}.`
    : 'Pick a committee to see its details.';
}

// Live-updates the KIST cell and the Sarkari-floor hint as GHATA is typed into
// the open row. Never touches the GHATA/Taken inputs' own values — those are
// only ever set once, when the row is rendered.
function updateMonthPreview() {
  const month = openMonth();
  if (!month || !$('m_ghata')) { $('m_sarkariHint').textContent = ''; return; }
  const committee = committeeByNo(selectedCommitteeNo);
  const ghata = Number($('m_ghata').value) || 0;
  const kist = kistFor(committee, ghata);
  const minGhata = sarkariGhataFor(committee, month);
  $('m_kistCell').textContent = currency(kist);
  $('m_sarkariHint').textContent = minGhata !== ''
    ? `Sarkari minimum GHATA for this month: ${currency(minGhata)} — actual GHATA can't be entered lower than this.`
    : '';
}

async function saveCommitteeMonth() {
  const no = selectedCommitteeNo;
  const month = openMonth();
  if (!no || !month || !$('m_ghata')) { showToast('No open month to fill for this committee'); return; }
  const committee = committeeByNo(no);
  const ghata = Number($('m_ghata').value) || 0;
  const minGhata = sarkariGhataFor(committee, month);
  if (minGhata !== '' && ghata < minGhata) {
    showToast(`GHATA can't be less than the Sarkari minimum of ${currency(minGhata)}`);
    return;
  }
  const taken = $('m_taken').value;
  // This one does more sheet work server-side (updating the committee's whole
  // month timeline) than other calls, so it gets a longer timeout margin.
  const response = await committeeRequest({ action: 'saveCommitteeMonth', no, month, ghata, boliDate: boliDateFor(committee, month), taken }, 25000);
  if (!response || !response.ok) { showToast('Could not save — check the committee connection'); return; }
  showToast(taken === 'Yes' ? `Marked as taken this month — KIST ${currency(response.kist)}/member` : `KIST set to ${currency(response.kist)} for every member`);
  await Promise.all([loadCommitteeMonths(), loadCommitteeInstalments()]);
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
$('settingsTabButton').addEventListener('click', () => { $('endpoint').value = localStorage.getItem(ENDPOINT_KEY) || ''; $('settingsDialog').showModal(); loadAllPeople(); });
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
$('personAddEntryButton').addEventListener('click', () => {
  const person = selectedPerson;
  switchView('home');
  const card = document.querySelector(`.person-card[data-person="${CSS.escape(person)}"]`);
  if (card) { card.scrollIntoView({ behavior:'smooth', block:'center' }); card.querySelector('.person-amount').focus(); }
});
$('settingsForm').addEventListener('submit', (event) => { event.preventDefault(); localStorage.setItem(ENDPOINT_KEY, $('endpoint').value.trim()); $('settingsDialog').close(); showToast('Connection saved, checking...'); loadPeople(); });
document.querySelectorAll('.type-switch [data-csub]').forEach((button) => button.addEventListener('click', () => switchCommitteeSub(button.dataset.csub)));
$('committeeList').addEventListener('click', (event) => {
  const row = event.target.closest('.committee-row');
  if (!row) return;
  switchCommitteeSub('instalments', row.dataset.no);
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
  const no = `${person} (${formatDate(start)})`;
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
  switchCommitteeSub('list');
  loadCommittees();
});
$('instCommitteeSelect').addEventListener('change', (event) => {
  selectedCommitteeNo = event.target.value || null;
  renderCommitteeInfo();
  loadCommitteeInstalments();
  loadCommitteeMonths();
});
// The GHATA input is re-created on every render (it lives inside the History
// table's open row), so this has to be delegated from a stable ancestor.
$('monthHistory').addEventListener('input', (event) => { if (event.target.id === 'm_ghata') updateMonthPreview(); });
$('saveMonthButton').addEventListener('click', saveCommitteeMonth);
$('addPersonButton').addEventListener('click', addPerson);
$('newPersonName').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addPerson(); } });
$('managePeopleList').addEventListener('click', (event) => {
  const button = event.target.closest('.status-toggle');
  if (!button) return;
  setPersonActive(button.dataset.name, button.dataset.active !== 'true');
});
$('verifySubmitButton').addEventListener('click', submitVerification);
$('exportButton').addEventListener('click', () => { const blob = new Blob([JSON.stringify(entries, null, 2)], { type:'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `khata-daily-${today()}.json`; link.click(); URL.revokeObjectURL(link.href); });
render();
loadPeople();
loadTransactions();
loadUnverified();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
