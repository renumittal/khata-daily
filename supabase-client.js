// Talks to Supabase (Postgres) instead of the old Google Apps Script /exec
// endpoint. Exposes one function, apiRequest(params), that takes the exact
// same { action, ...params } shape the app already sends everywhere and
// returns a promise resolving to the same-shaped { ok, ... } payload the old
// jsonpRequest did — so nothing else in app.js has to change.
const SUPABASE_URL = 'https://ihumcgtfhpvizfxguuja.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TievwBoXYugLfpG3zZuiEw_onxb40Dt';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function toDateOrNull(value) {
  const v = String(value || '').trim();
  return v ? v : null;
}

function committeeRowToClient(c) {
  return {
    no: c.no, totalMembers: c.total_members, totalMonths: c.total_months,
    monthlyAmount: Number(c.monthly_amount), totalAmount: Number(c.total_amount),
    cutPercent: Number(c.cut_percent), extraProfit: Number(c.extra_profit),
    startMonth: c.start_month || '', status: c.status || '',
  };
}
function instalmentRowToClient(i) {
  return {
    no: i.no, person: i.person, isTaken: i.is_taken, amount: Number(i.amount),
    takenMonth: i.taken_month || '', kist: Number(i.kist), ghata: Number(i.ghata),
    sarkari: Number(i.sarkari), status: i.status || '', pendingMonth: i.pending_month || '',
  };
}
function monthRowToClient(m) {
  return {
    no: m.no, month: m.month, boliDate: m.boli_date || '', sarkariGhata: Number(m.sarkari_ghata),
    ghata: Number(m.ghata), kist: Number(m.kist), takenBy: m.taken_by || '',
    amountReceived: Number(m.amount_received), verified: Boolean(m.verified),
  };
}
function transactionRowToClient(t) {
  return {
    date: t.date, type: t.type, person: t.person, category: t.category || '',
    amount: Number(t.amount), note: t.note || '', id: t.id, createdAt: t.created_at,
    verified: Boolean(t.verified),
  };
}

async function apiRequest(params) {
  const action = params.action;
  try {
    if (action === 'save') {
      const { error } = await db.from('transactions').upsert({
        id: params.id, date: params.date, type: params.type, person: params.person,
        category: params.category || '', amount: Number(params.amount), note: params.note || '',
        created_at: params.createdAt,
      });
      if (error) throw error;
      return { ok: true };
    }

    if (action === 'transactions' || action === 'unverified') {
      let query = db.from('transactions').select('*');
      if (action === 'unverified') query = query.eq('verified', false);
      const { data, error } = await query;
      if (error) throw error;
      return { ok: true, transactions: data.map(transactionRowToClient) };
    }

    if (action === 'verify') {
      const updates = JSON.parse(params.updates || '[]');
      const results = [];
      for (const u of updates) {
        const { error } = await db.from('transactions').update({
          date: u.date, type: u.type, person: u.person, category: u.category || '',
          amount: Number(u.amount), note: u.note || '', verified: true,
        }).eq('id', u.id);
        results.push({ id: u.id, ok: !error });
      }
      return { ok: true, results };
    }

    if (action === 'allPeople' || !action) {
      const { data, error } = await db.from('people').select('name, active, mobile').order('name');
      if (error) throw error;
      if (!action) return { ok: true, people: [...new Set(data.filter((p) => p.active).map((p) => p.name))].sort() };
      return { ok: true, people: data.map((p) => ({ name: p.name, active: p.active, mobile: p.mobile || '' })) };
    }

    if (action === 'addPerson') {
      const { error } = await db.from('people').upsert({ name: params.name, active: true, mobile: params.mobile || '' });
      if (error) throw error;
      return { ok: true };
    }

    if (action === 'setActive') {
      const { error } = await db.from('people').update({ active: params.active !== 'false' }).eq('name', params.name);
      if (error) throw error;
      return { ok: true };
    }

    if (action === 'committees') {
      const { data, error } = await db.from('committees').select('*').order('no');
      if (error) throw error;
      return { ok: true, committees: data.map(committeeRowToClient) };
    }

    if (action === 'addCommittee') {
      const { error } = await db.from('committees').insert({
        no: params.no, total_members: Number(params.totalMembers) || 0, total_months: Number(params.totalMonths) || 0,
        monthly_amount: Number(params.monthlyAmount) || 0, total_amount: Number(params.totalAmount) || 0,
        cut_percent: Number(params.cutPercent) || 0, extra_profit: Number(params.extraProfit) || 0,
        start_month: toDateOrNull(params.startMonth), status: params.status || 'Running',
      });
      if (error) throw error;
      const { error: rpcError } = await db.rpc('ensure_committee_months', { p_no: params.no });
      if (rpcError) throw rpcError;
      return { ok: true };
    }

    if (action === 'committeeInstalments') {
      let query = db.from('committee_instalments').select('*');
      if (params.no) query = query.eq('no', params.no);
      const { data, error } = await query;
      if (error) throw error;
      return { ok: true, instalments: data.map(instalmentRowToClient) };
    }

    if (action === 'committeeMonths') {
      let query = db.from('committee_months').select('*').order('month');
      if (params.no) query = query.eq('no', params.no);
      const { data, error } = await query;
      if (error) throw error;
      return { ok: true, months: data.map(monthRowToClient) };
    }

    if (action === 'committeeAnalysis') {
      const [committees, instalments, months] = await Promise.all([
        db.from('committees').select('*'),
        db.from('committee_instalments').select('*'),
        db.from('committee_months').select('*'),
      ]);
      if (committees.error) throw committees.error;
      if (instalments.error) throw instalments.error;
      if (months.error) throw months.error;
      return {
        ok: true,
        committees: committees.data.map(committeeRowToClient),
        instalments: instalments.data.map(instalmentRowToClient),
        months: months.data.map(monthRowToClient),
      };
    }

    if (action === 'saveCommitteeMonth') {
      const { data, error } = await db.rpc('save_committee_month', {
        p_no: params.no, p_month: params.month, p_ghata: Number(params.ghata) || 0,
        p_boli_date: toDateOrNull(params.boliDate), p_taken: params.taken || 'No',
        p_member: params.member || '', p_verified: Boolean(params.verified),
      });
      if (error) throw error;
      const row = data && data[0];
      return { ok: true, ghata: row ? Number(row.ghata) : 0, kist: row ? Number(row.kist) : 0 };
    }

    if (action === 'calendarMonth') {
      const { data, error } = await db.rpc('calendar_month', { p_yyyymm: params.month });
      if (error) throw error;
      return {
        ok: true,
        rows: data.map((r) => ({
          no: r.no, installmentNo: r.installment_no, totalMonth: r.total_months,
          monthlyAmount: Number(r.monthly_amount), ghata: Number(r.ghata), sarkari: Number(r.sarkari),
          extraProfit: Number(r.extra_profit), totalInvst: Number(r.total_invst), isTaken: r.is_taken,
          takenMonth: r.taken_month || '', pendingMonth: r.pending_month, status: r.status || '',
          boliDate: r.boli_date || '', filled: Boolean(r.filled),
        })),
      };
    }

    if (action === 'unverifiedCommitteeMonths') {
      const { data, error } = await db.from('committee_months').select('*').eq('verified', false);
      if (error) throw error;
      const filtered = data.filter((m) => m.boli_date || Number(m.ghata) > 0);
      return { ok: true, months: filtered.map(monthRowToClient) };
    }

    if (action === 'verifyCommitteeMonths') {
      const updates = JSON.parse(params.updates || '[]');
      const results = [];
      for (const u of updates) {
        const { error } = await db.rpc('save_committee_month', {
          p_no: u.no, p_month: u.month, p_ghata: Number(u.ghata) || 0,
          p_boli_date: toDateOrNull(u.boliDate), p_taken: u.taken || 'No',
          p_member: u.member || '', p_verified: true,
        });
        results.push({ no: u.no, month: u.month, ok: !error });
      }
      return { ok: true, results };
    }

    return { ok: false, error: `Unknown action: ${action}` };
  } catch (error) {
    console.error('Supabase request failed', action, error);
    return { ok: false, error: String((error && error.message) || error) };
  }
}
