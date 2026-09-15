-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- Schema-only pass: hierarchical auth levels, dynamic groups, and projects,
-- laid on top of the existing people/transactions tables. No login/session
-- UI yet — see the TEMPORARY RLS note at the bottom of schema.sql, which
-- this migration extends to the new tables unchanged (still `using (true)`).
--
-- Every new column on people/transactions is nullable, so existing rows and
-- existing app.js inserts/upserts are unaffected.

-- ---------- Auth hierarchy ----------

create table if not exists auth_level (
  id bigserial primary key,
  name text unique not null,
  rank int not null,           -- lower-or-equal rank cascades down; ties allowed
  description text
);

-- No login/session code yet — auth_uid is where a future Supabase Auth
-- user (auth.users.id) gets mapped in without another table.
create table if not exists app_user (
  id bigserial primary key,
  username text unique not null,
  auth_level_id bigint not null references auth_level(id),
  auth_uid uuid unique
);

-- ---------- Groups ----------
-- Table is named "groups" (plural) because GROUP is a reserved SQL keyword.

create table if not exists groups (
  id bigserial primary key,
  name text unique not null,
  description text
);

-- ---------- Projects ----------

create table if not exists project (
  id bigserial primary key,
  name text unique not null,
  location text,
  status text,
  start_date date,
  end_date date
);

-- ---------- Extend existing tables ----------

-- Plain free-text for now. Designed to later be replaced by a `role` +
-- `person_role` mapping table (multiple roles per person) without a
-- breaking migration — this column just gets phased out at that point.
alter table people add column if not exists role text;

-- Mirrors the existing `person text references people(name)` style (a
-- human-readable FK, not a surrogate id) rather than project_id, so the
-- ledger stays as readable as it already is. Both null for ordinary
-- non-project khata entries.
alter table transactions add column if not exists project text references project(name);
alter table transactions add column if not exists paid_by_user bigint references app_user(id);

-- ---------- Junction tables ----------
-- These carry a validity window (valid_from/valid_to) instead of a plain
-- composite primary key: ending a membership/grant sets valid_to rather
-- than deleting the row, so history isn't lost when a person changes group
-- or a level's access is revoked. A partial unique index enforces at most
-- one currently-active row per pair.

create table if not exists person_group (
  id bigserial primary key,
  person text not null references people(name),
  group_id bigint not null references groups(id),
  valid_from date not null default current_date,
  valid_to date
);
create unique index if not exists uq_person_group_active on person_group(person, group_id) where valid_to is null;

-- Two junctions rather than one polymorphic table, so each side keeps a
-- normal foreign key instead of an untyped (entity_type, entity_id) pair.
create table if not exists auth_level_group (
  id bigserial primary key,
  auth_level_id bigint not null references auth_level(id),
  group_id bigint not null references groups(id),
  valid_from date not null default current_date,
  valid_to date
);
create unique index if not exists uq_auth_level_group_active on auth_level_group(auth_level_id, group_id) where valid_to is null;

create table if not exists auth_level_person (
  id bigserial primary key,
  auth_level_id bigint not null references auth_level(id),
  person text not null references people(name),
  valid_from date not null default current_date,
  valid_to date
);
create unique index if not exists uq_auth_level_person_active on auth_level_person(auth_level_id, person) where valid_to is null;

create table if not exists person_project (
  id bigserial primary key,
  person text not null references people(name),
  project_id bigint not null references project(id),
  role_on_project text,
  valid_from date not null default current_date,
  valid_to date
);
create unique index if not exists uq_person_project_active on person_project(person, project_id) where valid_to is null;

-- ---------- SQL helper functions ----------

-- The cascading-visibility primitive: every auth_level whose rank is at or
-- below the given level's rank (rank ties included).
create or replace function levels_at_or_below(p_auth_level_id bigint)
returns table(auth_level_id bigint) language sql stable as $$
  select id from auth_level
  where rank <= (select rank from auth_level where id = p_auth_level_id)
$$;

-- Groups reachable by a level or anything below it (currently-active grants only).
create or replace function groups_for_level(p_auth_level_id bigint)
returns table(group_id bigint, group_name text) language sql stable as $$
  select distinct g.id, g.name
  from auth_level_group alg
  join groups g on g.id = alg.group_id
  where alg.valid_to is null
    and alg.auth_level_id in (select auth_level_id from levels_at_or_below(p_auth_level_id))
$$;

-- People reachable by a level or anything below it — the union of direct
-- auth_level_person grants and group-based grants via person_group
-- (currently-active grants/memberships only).
create or replace function persons_for_level(p_auth_level_id bigint)
returns table(person text) language sql stable as $$
  with levels as (select auth_level_id from levels_at_or_below(p_auth_level_id))
  select distinct alp.person
  from auth_level_person alp
  where alp.valid_to is null
    and alp.auth_level_id in (select auth_level_id from levels)
  union
  select distinct pg.person
  from person_group pg
  join auth_level_group alg on alg.group_id = pg.group_id and alg.valid_to is null
  where pg.valid_to is null
    and alg.auth_level_id in (select auth_level_id from levels)
$$;

-- A person's full payment history across all projects.
create or replace function person_project_history(p_person text)
returns table(id text, date date, project text, amount numeric, type text, note text, paid_by_user bigint)
language sql stable as $$
  select id, date, project, amount, type, note, paid_by_user
  from transactions
  where person = p_person and project is not null
  order by date;
$$;

-- Net amount (credit - debit, same sign convention personSummary() in
-- app.js already uses) per project for one person.
create or replace function person_project_totals(p_person text)
returns table(project text, net_amount numeric) language sql stable as $$
  select project,
    coalesce(sum(amount) filter (where type = 'credit'), 0) - coalesce(sum(amount) filter (where type = 'debit'), 0) as net_amount
  from transactions
  where person = p_person and project is not null
  group by project;
$$;

-- Scalar net total across all of a person's project transactions.
create or replace function person_total_paid(p_person text)
returns numeric language sql stable as $$
  select coalesce(sum(amount) filter (where type = 'credit'), 0) - coalesce(sum(amount) filter (where type = 'debit'), 0)
  from transactions
  where person = p_person and project is not null;
$$;

-- Net amount per person for a given project.
create or replace function project_person_totals(p_project text)
returns table(person text, net_amount numeric) language sql stable as $$
  select person,
    coalesce(sum(amount) filter (where type = 'credit'), 0) - coalesce(sum(amount) filter (where type = 'debit'), 0) as net_amount
  from transactions
  where project = p_project
  group by person;
$$;

-- Scalar net total for a given project across everyone.
create or replace function project_total_cost(p_project text)
returns numeric language sql stable as $$
  select coalesce(sum(amount) filter (where type = 'credit'), 0) - coalesce(sum(amount) filter (where type = 'debit'), 0)
  from transactions
  where project = p_project;
$$;

-- ---------- Row Level Security ----------
-- TEMPORARY, same as the rest of schema.sql: no login screen yet, so these
-- new tables get the same permissive anon read/write policy. Revisit
-- together with the rest of the RLS section once a login screen exists.

alter table auth_level enable row level security;
alter table app_user enable row level security;
alter table groups enable row level security;
alter table person_group enable row level security;
alter table auth_level_group enable row level security;
alter table auth_level_person enable row level security;
alter table project enable row level security;
alter table person_project enable row level security;

drop policy if exists "anon read/write" on auth_level;
drop policy if exists "anon read/write" on app_user;
drop policy if exists "anon read/write" on groups;
drop policy if exists "anon read/write" on person_group;
drop policy if exists "anon read/write" on auth_level_group;
drop policy if exists "anon read/write" on auth_level_person;
drop policy if exists "anon read/write" on project;
drop policy if exists "anon read/write" on person_project;

create policy "anon read/write" on auth_level for all using (true) with check (true);
create policy "anon read/write" on app_user for all using (true) with check (true);
create policy "anon read/write" on groups for all using (true) with check (true);
create policy "anon read/write" on person_group for all using (true) with check (true);
create policy "anon read/write" on auth_level_group for all using (true) with check (true);
create policy "anon read/write" on auth_level_person for all using (true) with check (true);
create policy "anon read/write" on project for all using (true) with check (true);
create policy "anon read/write" on person_project for all using (true) with check (true);
