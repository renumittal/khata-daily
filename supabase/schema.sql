-- Mittal Khata Book — Supabase (Postgres) schema
-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- Replaces the Google Sheets tabs 1:1, with two differences that fix the
-- problems Sheets had:
--   1. "Committee Months" / "Committee Instalments" writes happen inside one
--      DB transaction (save_committee_month below) instead of several
--      separate Sheets API calls — a crash mid-save can no longer leave
--      the month row and the instalment row out of sync.
--   2. The old "Kameti - <person>" per-committee sheets, the "<Mon>-<YY>"
--      calendar rollups, and the "Net - <person>" sheets were all hand-synced
--      denormalized copies of the same underlying data (necessary in Sheets,
--      which can't join). Here they're just queries against the real tables
--      (see the calendar_month() and person_net() functions at the bottom) —
--      nothing to keep in sync, nothing that can drift.

create table if not exists people (
  name text primary key,
  active boolean not null default true,
  mobile text default ''
);

create table if not exists transactions (
  id text primary key,                 -- the client-generated Entry ID
  date date not null,
  type text not null,
  person text not null references people(name),
  category text default '',
  amount numeric not null,
  note text default '',
  created_at timestamptz not null default now(),
  verified boolean not null default false
);

create table if not exists committees (
  no text primary key,                 -- e.g. "Renu (2026-06-05)"
  total_members int not null default 0,
  total_months int not null default 0,
  monthly_amount numeric not null default 0,
  total_amount numeric not null default 0,
  cut_percent numeric not null default 0,
  extra_profit numeric not null default 0,
  start_month date,                    -- the boli day; only year+month is used for math
  status text default 'Running'
);

create table if not exists committee_instalments (
  no text not null references committees(no) on delete cascade,
  person text not null,
  is_taken text default 'No',
  amount numeric default 0,
  taken_month text default '',         -- YYYY-MM
  kist numeric default 0,
  ghata numeric default 0,
  sarkari numeric default 0,
  status text default '',
  pending_month text default '',
  primary key (no, person)
);

create table if not exists committee_months (
  no text not null references committees(no) on delete cascade,
  month text not null,                 -- YYYY-MM
  boli_date date,
  sarkari_ghata numeric default 0,
  ghata numeric default 0,
  kist numeric default 0,
  taken_by text default '',
  amount_received numeric default 0,
  verified boolean not null default false,
  primary key (no, month)
);

create index if not exists idx_transactions_person on transactions(person);
create index if not exists idx_transactions_verified on transactions(verified) where not verified;
create index if not exists idx_committee_months_month on committee_months(month);
create index if not exists idx_committee_instalments_person on committee_instalments(person);

-- ---------- Business-logic helpers (ported from CommitteBackend.gs) ----------

create or replace function month_index(start_month date, target_yyyymm text)
returns int language sql immutable as $$
  select (extract(year from (target_yyyymm || '-01')::date)::int - extract(year from start_month)::int) * 12
       + (extract(month from (target_yyyymm || '-01')::date)::int - extract(month from start_month)::int) + 1
$$;

create or replace function sarkari_ghata(
  total_members int, monthly_amount numeric, cut_percent numeric,
  total_months int, start_month date, target_yyyymm text
) returns numeric language sql immutable as $$
  select greatest(0, round(
    total_members * monthly_amount * (cut_percent / 100.0)
    * (total_months - month_index(start_month, target_yyyymm) + 1)
  ))
$$;

-- Pre-fills one row per month of a committee's whole duration, with Sarkari
-- GHATA already computed — was ensureCommitteeMonthRows_ in CommitteBackend.gs.
-- Called once right after a committee is created.
create or replace function ensure_committee_months(p_no text)
returns void language plpgsql as $$
declare
  c committees%rowtype;
  i int;
  v_month text;
begin
  select * into c from committees where committees.no = p_no;
  if not found or c.start_month is null or c.total_months is null then return; end if;
  for i in 1..c.total_months loop
    v_month := to_char(c.start_month + ((i - 1) || ' months')::interval, 'YYYY-MM');
    insert into committee_months (no, month, sarkari_ghata)
    values (p_no, v_month, sarkari_ghata(c.total_members, c.monthly_amount, c.cut_percent, c.total_months, c.start_month, v_month))
    on conflict (no, month) do nothing;
  end loop;
end;
$$;

-- Atomically saves one month's GHATA/boli for a committee, derives KIST,
-- and mirrors both into that committee's instalment row — the single
-- multi-step write that used to be 3-4 separate Sheets calls.
create or replace function save_committee_month(
  p_no text, p_month text, p_ghata numeric, p_boli_date date,
  p_taken text, p_member text, p_verified boolean default false
) returns table(ghata numeric, kist numeric) language plpgsql as $$
declare
  c committees%rowtype;
  v_kist numeric;
  v_sarkari numeric;
  v_person text;
  v_idx int;
  v_pending_month int;
  v_existing_taken_month text;
begin
  select * into c from committees where committees.no = p_no;
  if not found then raise exception 'Committee not found: %', p_no; end if;

  v_kist := case when c.total_members > 0
    then round(c.monthly_amount - (p_ghata / c.total_members))
    else c.monthly_amount end;
  v_sarkari := sarkari_ghata(c.total_members, c.monthly_amount, c.cut_percent, c.total_months, c.start_month, p_month);
  v_idx := month_index(c.start_month, p_month);
  v_pending_month := greatest(0, c.total_months - v_idx);
  v_person := coalesce(nullif(trim(p_member), ''), split_part(p_no, ' (', 1));

  insert into committee_months (no, month, boli_date, sarkari_ghata, ghata, kist, verified)
  values (p_no, p_month, p_boli_date, v_sarkari, p_ghata, v_kist, p_verified)
  on conflict (no, month) do update
    set boli_date = excluded.boli_date, sarkari_ghata = excluded.sarkari_ghata,
        ghata = excluded.ghata, kist = excluded.kist, verified = excluded.verified;

  update committee_instalments set kist = v_kist, ghata = p_ghata where committee_instalments.no = p_no;

  select taken_month into v_existing_taken_month
  from committee_instalments where committee_instalments.no = p_no and is_taken = 'Yes';

  if p_taken = 'Yes' then
    insert into committee_instalments (no, person, is_taken, amount, taken_month, kist, ghata, sarkari, status, pending_month)
    values (p_no, v_person, 'Yes', c.total_amount - p_ghata, p_month, v_kist, p_ghata,
            round(c.monthly_amount - c.monthly_amount * (c.cut_percent / 100.0) * (c.total_months - v_idx + 1)),
            'Taken', v_pending_month::text)
    on conflict (no, person) do update
      set is_taken = 'Yes', amount = excluded.amount, taken_month = excluded.taken_month,
          kist = excluded.kist, ghata = excluded.ghata, sarkari = excluded.sarkari,
          status = 'Taken', pending_month = excluded.pending_month;
  elsif v_existing_taken_month is distinct from p_month then
    -- only clears a taken record if it was for THIS month (un-marking it)
    insert into committee_instalments (no, person, is_taken, amount, taken_month, kist, ghata, sarkari, status, pending_month)
    values (p_no, v_person, 'No', 0, '', v_kist, p_ghata, 0, '', v_pending_month::text)
    on conflict (no, person) do update
      set is_taken = 'No', amount = 0, taken_month = '', kist = excluded.kist,
          ghata = excluded.ghata, sarkari = 0, status = '', pending_month = excluded.pending_month;
  end if;

  return query select p_ghata, v_kist;
end;
$$;

-- ---------- Read-side rollups (replace the old rollup sheets) ----------

-- One row per committee for a given calendar month — was "<Mon>-<YY>" sheet.
create or replace function calendar_month(p_yyyymm text)
returns table(
  no text, installment_no int, total_months int, monthly_amount numeric,
  ghata numeric, sarkari numeric, extra_profit numeric, total_invst numeric,
  is_taken text, taken_month text, pending_month int, status text,
  boli_date date, filled boolean
) language sql stable as $$
  select
    c.no, mi.idx, c.total_months, c.monthly_amount,
    coalesce(cm.ghata, 0),
    round(c.monthly_amount - c.monthly_amount * (c.cut_percent / 100.0) * ((c.total_months - mi.idx) + 1)) as sarkari,
    case when c.total_months > 0
      then (coalesce(cm.ghata, 0) - round(c.monthly_amount - c.monthly_amount * (c.cut_percent / 100.0) * ((c.total_months - mi.idx) + 1))) / c.total_months
      else 0 end as extra_profit,
    case when ci.is_taken = 'Yes' and ci.taken_month <> '' and month_index(c.start_month, ci.taken_month) <= mi.idx
      then -((c.total_months - mi.idx) * c.monthly_amount)
      else c.monthly_amount * mi.idx end as total_invst,
    case when ci.is_taken = 'Yes' and ci.taken_month <> '' and month_index(c.start_month, ci.taken_month) <= mi.idx
      then 'Yes' else 'No' end as is_taken,
    case when ci.is_taken = 'Yes' and ci.taken_month <> '' and month_index(c.start_month, ci.taken_month) <= mi.idx
      then ci.taken_month else '' end as taken_month,
    c.total_months - mi.idx as pending_month,
    case when ci.is_taken = 'Yes' and ci.taken_month <> '' and month_index(c.start_month, ci.taken_month) <= mi.idx
      then 'Taken' else '' end as status,
    cm.boli_date,
    coalesce(cm.boli_date is not null or cm.ghata > 0, false) as filled
  from committees c
  cross join lateral (select month_index(c.start_month, p_yyyymm) as idx) mi
  left join committee_months cm on cm.no = c.no and cm.month = p_yyyymm
  left join committee_instalments ci on ci.no = c.no
  where mi.idx between 1 and c.total_months;
$$;

-- A person's current net position across every committee they run — was
-- "Net - <person>" sheet. Anchored to the last month actually filled in,
-- not today's date (mirrors lastFilledKistIdx_ in the old backend).
create or replace function person_net(p_person text)
returns table(no text, total_months int, monthly_amount numeric, is_taken text, pending_month int, net_invst numeric)
language sql stable as $$
  with last_filled as (
    select cm.no, max(cm.month) as last_month
    from committee_months cm
    where cm.boli_date is not null or cm.ghata > 0
    group by cm.no
  )
  select
    c.no, c.total_months, c.monthly_amount,
    coalesce(ci.is_taken, 'No'),
    c.total_months - least(c.total_months, greatest(0, coalesce(month_index(c.start_month, lf.last_month), 0))) as pending_month,
    case when ci.is_taken = 'Yes'
      then -((c.total_months - least(c.total_months, greatest(0, coalesce(month_index(c.start_month, lf.last_month), 0)))) * c.monthly_amount)
      else c.monthly_amount * least(c.total_months, greatest(0, coalesce(month_index(c.start_month, lf.last_month), 0))) end as net_invst
  from committees c
  left join last_filled lf on lf.no = c.no
  left join committee_instalments ci on ci.no = c.no
  where split_part(c.no, ' (', 1) ilike p_person;
$$;

-- ---------- Row Level Security ----------
-- TEMPORARY: no login screen yet, so these policies allow the plain anon key
-- to read/write everything — same trust level the old GAS web app had
-- ("Anyone" with the link could hit /exec). Once a login screen is added,
-- swap `using (true)` below for `using (auth.role() = 'authenticated')` (and
-- the same in `with check`) so only a signed-in session can touch data.
alter table people enable row level security;
alter table transactions enable row level security;
alter table committees enable row level security;
alter table committee_instalments enable row level security;
alter table committee_months enable row level security;

drop policy if exists "anon read/write" on people;
drop policy if exists "anon read/write" on transactions;
drop policy if exists "anon read/write" on committees;
drop policy if exists "anon read/write" on committee_instalments;
drop policy if exists "anon read/write" on committee_months;

create policy "anon read/write" on people for all using (true) with check (true);
create policy "anon read/write" on transactions for all using (true) with check (true);
create policy "anon read/write" on committees for all using (true) with check (true);
create policy "anon read/write" on committee_instalments for all using (true) with check (true);
create policy "anon read/write" on committee_months for all using (true) with check (true);
