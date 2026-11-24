-- ONLY for a throwaway test project. Never apply this to a project that holds real data.
--
-- The contract suite (apps/desktop/src/main/team/supabase-contract.test.ts) needs a backend with
-- no owner at the start of every test. This makes a function that empties the team tables and
-- removes every account, callable with the service key and by nobody else. It exists only on a
-- project that ran this file on purpose: the function refuses to run unless the marker table
-- below is there, and the marker is made here and nowhere else.
--
-- Apply it with the SQL editor or `psql -f` to the test project, after the migrations.

create table if not exists public.murmur_test_project (marker boolean primary key default true check (marker));
alter table public.murmur_test_project enable row level security;
insert into public.murmur_test_project (marker) values (true) on conflict do nothing;

create or replace function public.murmur_test_reset() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.murmur_test_project) then
    raise exception 'This is not a test project.';
  end if;
  -- The audit log refuses deletes on purpose; a test project may start again from nothing.
  truncate table public.audit_events, public.teams restart identity cascade;
  -- The API's roles refuse a delete with no WHERE (pg_safeupdate); this one is on purpose.
  delete from auth.users where true;
  return jsonb_build_object('reset', true);
end;
$$;

revoke execute on function public.murmur_test_reset() from public, anon, authenticated;
grant execute on function public.murmur_test_reset() to service_role;
