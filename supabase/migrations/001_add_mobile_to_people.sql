-- Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
alter table people add column if not exists mobile text default '';
