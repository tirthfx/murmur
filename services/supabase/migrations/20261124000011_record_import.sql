-- 0011 the first event of a team's log after it was moved here (SW-01 phase 4).
--
-- The local server's audit chain is hashed another way and cannot be carried over and still
-- verify, so it is archived as it is. This writes one event into the team's new chain, naming how
-- long the old log was and its last hash, so the two can be tied together. Only the service key
-- (the migration tool) may call it.

create function public.record_import(p_team uuid, p_detail jsonb) returns void
language sql
security definer
set search_path = ''
as $$
  select private.audit(p_team, null, 'migration.imported', 'team', p_team::text, coalesce(p_detail, '{}'::jsonb));
$$;
revoke execute on function public.record_import(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_import(uuid, jsonb) to service_role;
