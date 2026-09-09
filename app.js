const STORAGE_KEY = 'khata-daily-entries';
const ENDPOINT_KEY = 'khata-daily-endpoint';
const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwoSVEQ7aqWTrrPN3Bz1tvfJG05LweLtw8X8QcawHJbnUuBwGTFL3ybKTj4eEECUvC5tw/exec';
let entries = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let showingAll = false;
let people = [];
let transactionType = 'credit';
let selectedPerson = null;
let personFilter = 'all';
let remoteTransactions = [];

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
  const credit = visible.filter((entry) => entry.type === 'credit').reduce((sum, entry) => sum + entry.amount, 0);
  const debit = visible.filter((entry) => entry.type === 'debit').reduce((sum, entry) => sum + entry.amount, 0);
  $('creditTotal').textContent = currency(credit);
  $('debitTotal').textContent = currency(debit);
  $('netTotal').textContent = currency(credit - debit);
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

function jsonpRequest(params, timeoutMs = 12000) {
  const endpoint = localStorage.getItem(ENDPOINT_KEY) || DEFAULT_ENDPOINT;
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
  $('personDetailView').hidden = view !== 'personDetail';
  document.querySelectorAll('.tab-button[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view || (view === 'personDetail' && button.dataset.view === 'people')));
  if (view === 'people') { renderPeopleDirectory(); loadTransactions().then(() => { if (!$('peopleView').hidden) renderPeopleDirectory(); }); }
  if (view === 'personDetail') renderPersonDetail();
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
$('addPersonButton').addEventListener('click', addPerson);
$('newPersonName').addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addPerson(); } });
$('managePeopleList').addEventListener('click', (event) => {
  const button = event.target.closest('.status-toggle');
  if (!button) return;
  setPersonActive(button.dataset.name, button.dataset.active !== 'true');
});
$('exportButton').addEventListener('click', () => { const blob = new Blob([JSON.stringify(entries, null, 2)], { type:'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `khata-daily-${today()}.json`; link.click(); URL.revokeObjectURL(link.href); });
render();
loadPeople();
loadTransactions();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
