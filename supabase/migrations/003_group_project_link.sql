-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- Links groups to projects (many-to-many) so Project Pay's group picker can
-- show only the groups actually assigned to that project, instead of every
-- group in the system. Same validity-window pattern as the other junction
-- tables from 002_access_control.sql — closing a link sets valid_to rather
-- than deleting the row.

create table if not exists group_project (
  id bigserial primary key,
  group_id bigint not null references groups(id),
  project_id bigint not null references project(id),
  valid_from date not null default current_date,
  valid_to date
);
create unique index if not exists uq_group_project_active on group_project(group_id, project_id) where valid_to is null;

alter table group_project enable row level security;
drop policy if exists "anon read/write" on group_project;
create policy "anon read/write" on group_project for all using (true) with check (true);
