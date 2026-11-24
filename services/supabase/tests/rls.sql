-- Tests for the team backend's row-level security and functions (SW-04).
--
-- Run it against a database that has the migrations applied (the project, or a local stack with
-- `supabase start`). It makes its own accounts and teams, acts as each of them, and ends by
-- raising "ALL TESTS PASSED". The error undoes everything the script did, so nothing is left in
-- the database. A failed check raises "FAIL <label>" instead.
--
-- It runs as one request: paste it into the SQL editor, or send it with `psql -f`.

create schema t;
grant usage on schema t to anon, authenticated;

-- Act as a signed-in person, as nobody, or as the database owner again.
create function t.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function t.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
end $$;

create function t.as_admin() returns void language plpgsql as $$
begin
  reset role;
end $$;

create function t.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then
    raise exception 'FAIL %', label;
  end if;
end $$;

-- Runs a statement and checks it fails with the SQLSTATE (PT403 is HTTP 403), or, with null,
-- that it does not fail.
create function t.expect(stmt text, expected text, label text) returns void language plpgsql as $$
declare
  got text := null;
begin
  begin
    execute stmt;
  exception when others then
    got := sqlstate;
  end;
  if got is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, coalesce(expected, 'no error'), coalesce(got, 'no error');
  end if;
end $$;

grant execute on all functions in schema t to anon, authenticated;

do $$
declare
  ada uuid := '00000000-0000-4000-8000-0000000000a1';  -- the owner
  vic uuid := '00000000-0000-4000-8000-0000000000b1';  -- viewer
  mia uuid := '00000000-0000-4000-8000-0000000000c1';  -- member, no department
  dan uuid := '00000000-0000-4000-8000-0000000000d1';  -- manager of Sales
  sue uuid := '00000000-0000-4000-8000-0000000000e1';  -- member of Sales
  zed uuid := '00000000-0000-4000-8000-0000000000f1';  -- in another team only
  hal uuid := '00000000-0000-4000-8000-000000000011';  -- joins with an invite
  team uuid;
  other uuid;
  sales uuid;
  r jsonb;
  inv jsonb;
  item uuid;
  rev integer;
begin
  -- ---- accounts get a profile
  insert into auth.users (id, email, raw_user_meta_data, aud, role) values
    (ada, 'ada@example.com', '{"name": "Ada"}', 'authenticated', 'authenticated'),
    (vic, 'vic@example.com', '{"name": "Vic"}', 'authenticated', 'authenticated'),
    (mia, 'mia@example.com', '{"name": "Mia"}', 'authenticated', 'authenticated'),
    (dan, 'dan@example.com', '{"name": "Dan"}', 'authenticated', 'authenticated'),
    (sue, 'sue@example.com', '{"name": "Sue"}', 'authenticated', 'authenticated'),
    (zed, 'zed@example.com', '{"name": "Zed"}', 'authenticated', 'authenticated'),
    (hal, 'hal@example.com', '{"name": "Hal"}', 'authenticated', 'authenticated');
  perform t.check((select count(*) from public.profiles where id in (ada, vic, mia, dan, sue, zed, hal)) = 7, 'a profile is made for each account');
  perform t.check((select name from public.profiles where id = ada) = 'Ada', 'the profile takes the name from the sign-up data');

  -- ---- the first account is the owner, once
  perform t.as_anon();
  perform t.check((public.murmur_health() ->> 'setUp') = 'false', 'a new backend has no owner');
  perform t.expect('select public.claim_owner()', '42501', 'nobody can claim the owner');
  perform t.as_user(ada);
  perform public.claim_owner();
  perform t.as_user(mia);
  perform t.expect('select public.claim_owner()', 'PT409', 'a second owner is a conflict');
  perform t.as_anon();
  perform t.check((public.murmur_health() ->> 'setUp') = 'true', 'the backend has an owner after the first run');

  -- ---- teams: only the owner makes one; others see only theirs
  perform t.as_user(mia);
  perform t.expect($q$select public.create_team('Nope')$q$, 'PT403', 'a member cannot make a team');
  perform t.as_user(ada);
  team := (public.create_team('Acme') ->> 'id')::uuid;
  other := (public.create_team('Other') ->> 'id')::uuid;
  perform t.as_admin();
  insert into public.departments (team_id, name) values (team, 'Sales') returning id into sales;
  perform t.as_user(ada);
  perform public.add_member(team, 'vic@example.com', 'viewer');
  perform public.add_member(team, 'mia@example.com', 'member');
  perform public.add_member(team, 'dan@example.com', 'manager', sales);
  perform public.add_member(team, 'sue@example.com', 'member', sales);
  perform public.add_member(other, 'zed@example.com', 'member');
  perform t.expect($q$select public.add_member('$q$ || team || $q$', 'vic@example.com')$q$, 'PT409', 'adding a member twice is a conflict');
  perform t.expect($q$select public.add_member('$q$ || team || $q$', 'ghost@example.com')$q$, 'PT404', 'adding an unknown account is not found');
  perform t.as_user(mia);
  perform t.expect($q$select public.add_member('$q$ || team || $q$', 'zed@example.com')$q$, 'PT403', 'a member cannot add people');

  perform t.as_user(vic);
  r := public.my_teams();
  perform t.check(jsonb_array_length(r) = 1 and r -> 0 ->> 'myRole' = 'viewer' and r -> 0 ->> 'name' = 'Acme', 'my_teams lists the team with the role');
  perform t.check((select count(*) from public.teams) = 1, 'a member sees only their own teams');
  perform t.check((select count(*) from public.team_members) = 5, 'a member sees who is in their team');
  perform t.check((select count(*) from public.profiles) = 5, 'a member sees the profiles of their team and no others');
  perform t.as_user(zed);
  perform t.check((select count(*) from public.teams where id = team) = 0, 'another team cannot be read');
  perform t.expect($q$select public.team_vocabulary('$q$ || team || $q$')$q$, 'PT403', 'another team''s entries are forbidden');
  perform t.expect($q$insert into public.teams (name, created_by) values ('x', '$q$ || zed || $q$')$q$, '42501', 'a client cannot write a table');
  perform t.as_anon();
  perform t.expect('select * from public.profiles', '42501', 'nobody can read profiles');
  perform t.expect('select public.my_teams()', '42501', 'nobody can list teams');
  perform t.as_user(ada);
  perform t.expect('select code_hash from public.invites', '42501', 'an invite''s code hash is never readable');

  -- ---- invites
  inv := public.create_invite(team, 'member', false, 1, 7, null);
  perform t.as_anon();
  perform t.check((public.check_invite(inv ->> 'code') ->> 'teamName') = 'Acme', 'a good code names its team before an account is made');
  perform t.expect($q$select public.check_invite('inv_nothing')$q$, 'PT404', 'a bad code is not found');
  perform t.as_user(hal);
  r := public.redeem_invite(inv ->> 'code');
  perform t.check(r ->> 'status' = 'joined' and r ->> 'teamName' = 'Acme', 'an open invite joins at once');
  perform t.as_user(zed);
  perform t.expect($q$select public.redeem_invite('$q$ || (inv ->> 'code') || $q$')$q$, 'PT404', 'a used-up invite is not found');
  perform t.as_user(mia);
  perform t.expect($q$select public.create_invite('$q$ || team || $q$')$q$, 'PT403', 'a member cannot make an invite');
  perform t.as_user(ada);
  inv := public.create_invite(team, 'member', true, 5, 7, null);
  perform t.as_user(zed);
  r := public.redeem_invite(inv ->> 'code');
  perform t.check(r ->> 'status' = 'pending', 'an invite that needs approval makes a request');
  perform t.check((select count(*) from public.join_requests where user_id = zed) = 1, 'a person sees their own request');
  perform t.check((select count(*) from public.team_members where team_id = team and user_id = zed) = 0, 'a pending person is not a member');
  perform t.as_user(ada);
  perform t.check((select count(*) from public.invites where team_id = team) = 2, 'the owner reads the invites');

  -- ---- shared entries: who may approve
  perform t.as_user(ada);
  perform t.check((public.propose_item(team, 'dictionary', 'Kubernetes') ->> 'live') = 'true', 'the owner''s entry goes live');
  perform t.as_user(mia);
  perform t.check((public.propose_item(team, 'snippet', null, null, 'sig', 'Best, Mia') ->> 'live') = 'false', 'a member''s entry waits for review');
  perform t.expect($q$select public.propose_item('$q$ || team || $q$', 'dictionary', 'kubernetes')$q$, 'PT409', 'a duplicate in the same place is a conflict');
  perform t.expect($q$select public.propose_item('$q$ || team || $q$', 'dictionary', '   ')$q$, 'PT400', 'a blank term is invalid');
  perform t.expect($q$select public.propose_item('$q$ || team || $q$', 'snippet', null, null, 'x', 'Hi {{password}}')$q$, 'PT400', 'a variable the team does not allow is invalid');
  perform t.as_user(vic);
  perform t.expect($q$select public.propose_item('$q$ || team || $q$', 'dictionary', 'Viewer')$q$, 'PT403', 'a viewer cannot propose');
  -- A department's manager approves in their own department, so Dan's entry goes live there.
  perform t.as_user(dan);
  perform t.check((public.propose_item(team, 'dictionary', 'Quota') ->> 'live') = 'true', 'a manager''s entry in their department goes live');
  perform t.as_user(sue);
  perform t.check((public.propose_item(team, 'dictionary', 'Pipeline') ->> 'live') = 'false', 'a member''s entry in a department waits for their manager');
  r := public.team_vocabulary(team);
  perform t.check(exists (select 1 from jsonb_array_elements(r -> 'dictionary') e where e ->> 'term' = 'Quota'), 'Sue sees her department''s entry');
  perform t.as_user(mia);
  r := public.team_vocabulary(team);
  perform t.check(not exists (select 1 from jsonb_array_elements(r -> 'dictionary') e where e ->> 'term' = 'Quota'), 'Mia, in no department, does not see Sales entries');
  perform t.check(exists (select 1 from jsonb_array_elements(r -> 'dictionary') e where e ->> 'term' = 'Kubernetes'), 'everyone sees the team''s entries');
  rev := (r ->> 'revision')::integer;
  perform t.check(rev > 0, 'the revision is above zero once an entry is live');
  perform t.check((public.team_vocabulary(team, rev) ->> 'unchanged') = 'true', 'nothing new when the revision has not moved');

  -- Dan may review Sales, not the team: the entry Mia proposed is the team's.
  perform t.as_user(mia);
  select id into item from public.vocabulary_items where team_id = team and key = 'sig';
  perform t.as_user(dan);
  perform t.expect($q$select public.review_item('$q$ || team || $q$', '$q$ || item || $q$', true)$q$, 'PT403', 'a manager cannot review the whole team''s entries');
  select id into item from public.vocabulary_items where team_id = team and key = 'pipeline';
  perform t.as_admin();
  perform t.as_user(dan);
  perform t.check((public.review_item(team, item, true) ->> 'status') = 'active', 'a manager approves in their department');
  perform t.as_user(ada);
  r := public.review_item(team, (select id from public.vocabulary_items where team_id = team and key = 'sig'), false, 'Too personal');
  perform t.check(r ->> 'status' = 'rejected', 'the owner turns an entry down');
  perform t.as_user(mia);
  r := public.my_notices(team);
  perform t.check(jsonb_array_length(r) = 1 and r -> 0 ->> 'summary' = 'sig' and r -> 0 ->> 'note' = 'Too personal', 'the proposer is told, with the note');
  perform t.as_user(sue);
  perform t.check(jsonb_array_length(public.my_notices(team)) = 0, 'another person is told nothing');
  perform t.as_user(mia);
  perform public.mark_notices_seen(team);
  perform t.check(jsonb_array_length(public.my_notices(team)) = 0, 'a notice is told once');
  perform t.check((select count(*) from public.vocabulary_notices where user_id <> mia) = 0, 'notices are read by their own person only');

  -- ---- plan gates
  perform t.as_user(ada);
  perform public.set_team_plan(team, 'free');
  perform t.expect($q$select public.team_vocabulary('$q$ || team || $q$')$q$, 'PT403', 'Free has no shared entries');
  perform t.expect($q$select public.policy_layers('$q$ || team || $q$')$q$, 'PT403', 'Free has no policy');
  perform public.set_team_plan(team, 'team');
  perform t.check((public.team_vocabulary(team) ->> 'unchanged') = 'false', 'Team has shared entries');
  perform t.as_user(mia);
  perform t.expect($q$select public.set_team_plan('$q$ || team || $q$', 'free')$q$, 'PT403', 'only the owner changes the plan');
  perform t.as_user(ada);
  perform public.set_team_plan(team, 'enterprise');

  -- ---- policy
  perform public.set_policy_values(team, 'team', null, '{"features.scratchpad": false, "adminContact": "it@acme.test"}');
  perform public.set_policy_values(team, 'department', sales::text, '{"retention.audio.max": 7}');
  perform public.set_policy_values(team, 'member', sue::text, '{"features.scratchpad": true}');
  perform t.as_user(sue);
  r := public.policy_layers(team);
  perform t.check(r -> 'team' ->> 'adminContact' = 'it@acme.test' and (r -> 'department' ->> 'retention.audio.max') = '7' and (r -> 'member' ->> 'features.scratchpad') = 'true', 'a person gets the team, department and member layers');
  perform t.as_user(mia);
  r := public.policy_layers(team);
  perform t.check(r -> 'department' = '{}'::jsonb and r -> 'member' = '{}'::jsonb, 'a person with no department and no own layer gets only the team''s');
  perform t.check((select count(*) from public.policy_values where scope = 'member') = 0, 'a person does not read other people''s member layers');
  perform t.expect($q$select public.set_policy_values('$q$ || team || $q$', 'team', null, '{"x.y": 1}')$q$, 'PT403', 'a member cannot change policy');
  perform t.as_user(ada);
  perform t.expect($q$select public.set_policy_values('$q$ || team || $q$', 'team', null, '{"bad key": 1}')$q$, 'PT400', 'a bad key is invalid');
  perform t.expect($q$select public.set_policy_values('$q$ || team || $q$', 'member', '$q$ || zed || $q$', '{"a": 1}')$q$, 'PT404', 'a member layer is for a person in the team');
  perform public.set_policy_values(team, 'team', null, '{"adminContact": null}');
  perform t.check(not jsonb_exists(public.policy_layers(team) -> 'team', 'adminContact'), 'a null clears a value');
  perform t.as_user(mia);
  perform public.report_retention(team, 3, 5);
  perform t.expect($q$select public.report_retention('$q$ || team || $q$', -1, 0)$q$, 'PT400', 'a retention count is not negative');

  -- ---- usage
  perform public.send_usage(team, 'batch-0001', jsonb_build_array(
    jsonb_build_object('day', to_char(now(), 'YYYY-MM-DD'), 'metric', 'words', 'count', 120, 'bucket', 'mail'),
    jsonb_build_object('day', to_char(now(), 'YYYY-MM-DD'), 'metric', 'dictations', 'count', 6, 'bucket', 'mail')));
  r := public.send_usage(team, 'batch-0001', jsonb_build_array(
    jsonb_build_object('day', to_char(now(), 'YYYY-MM-DD'), 'metric', 'words', 'count', 120, 'bucket', 'mail')));
  perform t.check((r ->> 'duplicate') = 'true', 'a batch sent twice is counted once');
  perform t.check((select sum(count) from public.usage_daily where metric = 'words') = 120, 'the total is the first batch only');
  perform t.expect($q$select public.send_usage('$q$ || team || $q$', 'batch-0003', '[{"day": "yesterday", "metric": "nonsense", "count": -1}]')$q$, 'PT400', 'a bad batch is invalid');
  perform t.expect($q$select public.send_usage('$q$ || team || $q$', 'short', '[]')$q$, 'PT400', 'a bad batch id is invalid');
  perform t.expect($q$select public.send_usage('$q$ || team || $q$', 'batch-0004', '[{"day": "2020-01-01", "metric": "words", "count": 1}]')$q$, 'PT400', 'a day long ago is invalid');
  perform t.as_user(sue);
  perform public.send_usage(team, 'batch-0005', jsonb_build_array(
    jsonb_build_object('day', to_char(now(), 'YYYY-MM-DD'), 'metric', 'words', 'count', 50, 'bucket', 'sneaky-app-name')));
  perform t.check((select bucket from public.usage_daily where user_id = sue and metric = 'words') = 'other', 'an app group that is not on the list becomes other');
  perform t.check((select count(*) from public.usage_daily) = 1, 'a member reads their own counts only');
  perform t.as_user(dan);
  perform t.check((select count(*) from public.usage_daily) >= 1 and (select count(*) from public.usage_daily where user_id = mia) = 0, 'a manager reads their department''s counts and not other departments''');
  perform t.as_user(ada);
  perform t.check((select sum(count) from public.usage_daily where metric = 'words') = 170, 'the owner reads the team''s totals');
  perform t.as_user(vic);
  perform t.expect('select * from public.usage_batches', '42501', 'no client reads the batch ids');

  -- ---- audit: append only, one chain per team
  perform t.as_user(ada);
  perform t.check((public.verify_audit_chain(team) ->> 'ok') = 'true', 'the chain holds');
  perform t.check((select count(*) from public.audit_events where team_id = team and action = 'policy.retention_applied') = 1, 'the retention report is in the log');
  perform t.check((select detail ->> 'recordings' from public.audit_events where action = 'policy.retention_applied') = '3', 'the report holds counts');
  perform t.expect($q$update public.audit_events set action = 'x'$q$, null, 'an update of audit rows goes through without an error');
  perform t.check((select count(*) from public.audit_events where action = 'x') = 0, 'and changes nothing');
  perform t.expect('delete from public.audit_events', null, 'a delete of audit rows goes through without an error');
  perform t.check((select count(*) from public.audit_events) > 0, 'and removes nothing');
  perform t.as_user(mia);
  perform t.check((select count(*) from public.audit_events) = 0, 'a member reads no audit rows');
  perform t.expect($q$select public.verify_audit_chain('$q$ || team || $q$')$q$, 'PT403', 'a member cannot verify the log');
  perform t.as_admin();
  perform t.expect($q$update public.audit_events set action = 'x'$q$, 'P0001', 'even the database owner cannot change an audit row');
  perform t.expect('delete from public.audit_events', 'P0001', 'or remove one');
  -- A broken chain is found.
  alter table public.audit_events disable trigger audit_events_frozen;
  update public.audit_events set detail = '{"tampered": true}' where team_id = team and seq = 2;
  alter table public.audit_events enable trigger audit_events_frozen;
  perform t.as_user(ada);
  r := public.verify_audit_chain(team);
  perform t.check((r ->> 'ok') = 'false' and (r ->> 'brokenAt') = '2', 'a changed row is found at its place in the chain');
  perform t.check((public.verify_audit_chain(other) ->> 'ok') = 'true', 'another team''s chain is separate');

  -- ---- the rules the schema keeps for itself
  perform t.as_admin();
  perform t.check(
    not exists (
      select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
    ),
    'every table in public has row-level security');
  perform t.check(
    not exists (
      select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname in ('public', 'private') and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
    ),
    'every security definer function fixes its search_path');
  perform t.check(
    not exists (
      select 1 from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated')
        and g.privilege_type in ('INSERT', 'TRUNCATE')
    ),
    'no client can insert into or truncate a table');

  raise exception 'ALL TESTS PASSED';
end $$;
