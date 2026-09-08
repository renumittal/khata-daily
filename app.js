const STORAGE_KEY = 'khata-daily-entries';
const ENDPOINT_KEY = 'khata-daily-endpoint';
const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxil_1IMTjAO_F34foGWWUA0XQh_7lBrGH_iR-DiyydEGXsvdjfzm1LDwRHRQFRcVTrkw/exec';
let entries = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
let showingAll = false;
let people = [];
let transactionType = 'credit';

const $ = (id) => document.getElementById(id);
const currency = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value);
const today = () => new Date().toISOString().slice(0, 10);

function render() {
  const visible = showingAll ? entries : entries.filter((entry) => entry.date === today());
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

function syncEntry(entry) {
  const endpoint = localStorage.getItem(ENDPOINT_KEY);
  if (!endpoint) return Promise.resolve(false);
  return new Promise((resolve) => {
    const callbackName = `khataSave${Date.now()}${Math.random().toString(36).slice(2)}`;
    const cleanup = () => { delete window[callbackName]; script.remove(); };
    const timer = setTimeout(() => { cleanup(); setSyncState(false); resolve(false); }, 12000);
    window[callbackName] = (response) => {
      clearTimeout(timer); cleanup();
      const ok = Boolean(response && response.ok);
      setSyncState(ok);
      resolve(ok);
    };
    const params = new URLSearchParams({ action:'save', callback:callbackName, id:entry.id, date:entry.date, type:entry.type, person:entry.person, category:entry.category || '', amount:String(entry.amount), note:entry.note || '', createdAt:entry.createdAt });
    const script = document.createElement('script');
    script.src = `${endpoint}${endpoint.includes('?') ? '&' : '?'}${params.toString()}`;
    script.onerror = () => { clearTimeout(timer); cleanup(); setSyncState(false); resolve(false); };
    document.body.appendChild(script);
  });
}

function renderPeople() {
  $('peopleList').innerHTML = people.length ? people.map((person) => `
    <label class="person-row"><span>${escapeHtml(person)}</span><input class="person-amount" data-person="${escapeHtml(person)}" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Amount"></label>`).join('') : '<div class="people-placeholder">Add names in Sheet1 column A.</div>';
  $('peopleStatus').textContent = people.length ? `${people.length} people` : 'No names found';
}

function loadPeople() {
  const endpoint = localStorage.getItem(ENDPOINT_KEY) || DEFAULT_ENDPOINT;
  if (!endpoint) return;
  const callbackName = `khataPeople${Date.now()}`;
  window[callbackName] = (response) => {
    people = response.people || [];
    renderPeople();
    setSyncState(true);
    delete window[callbackName];
    script.remove();
  };
  const script = document.createElement('script');
  script.src = `${endpoint}${endpoint.includes('?') ? '&' : '?'}callback=${callbackName}`;
  script.onerror = () => { $('peopleStatus').textContent = 'Check Apps Script access'; showToast('Redeploy Apps Script as Anyone, then refresh'); setSyncState(false); delete window[callbackName]; script.remove(); };
  document.body.appendChild(script);
}

function setTransactionType(type) {
  transactionType = type;
  $('creditButton').classList.toggle('active', type === 'credit');
  $('debitButton').classList.toggle('active', type === 'debit');
}

$('creditButton').addEventListener('click', () => setTransactionType('credit'));
$('debitButton').addEventListener('click', () => setTransactionType('debit'));

$('date').value = today();
$('entryForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const amounts = [...document.querySelectorAll('.person-amount')].filter((input) => Number(input.value) > 0);
  if (!amounts.length) { showToast('Enter an amount for at least one person'); return; }
  const common = { type:transactionType, category:$('category').value, date:$('date').value, note:$('note').value.trim(), createdAt:new Date().toISOString() };
  const newEntries = amounts.map((input) => ({ ...common, id:crypto.randomUUID(), person:input.dataset.person, amount:Number(input.value) }));
  entries.push(...newEntries); localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); render(); event.target.reset(); $('date').value = today(); setTransactionType('credit'); renderPeople();
  const results = await Promise.all(newEntries.map(syncEntry)); showToast(results.every(Boolean) ? 'Saved and synced to Google Sheet' : 'Saved on this phone');
});
$('clearFilter').addEventListener('click', () => { showingAll = !showingAll; render(); });
$('settingsButton').addEventListener('click', () => { $('endpoint').value = localStorage.getItem(ENDPOINT_KEY) || ''; $('settingsDialog').showModal(); });
$('settingsForm').addEventListener('submit', (event) => { event.preventDefault(); localStorage.setItem(ENDPOINT_KEY, $('endpoint').value.trim()); $('settingsDialog').close(); showToast('Connection saved, checking...'); loadPeople(); });
$('exportButton').addEventListener('click', () => { const blob = new Blob([JSON.stringify(entries, null, 2)], { type:'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `khata-daily-${today()}.json`; link.click(); URL.revokeObjectURL(link.href); });
if (!localStorage.getItem(ENDPOINT_KEY)) localStorage.setItem(ENDPOINT_KEY, DEFAULT_ENDPOINT);
render();
loadPeople();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
