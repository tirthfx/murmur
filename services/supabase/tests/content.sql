-- Tests for shared Skills and shared folders (migration 0008, NT-16, NT-17).
--
-- Run it like rls.sql: against a database with the migrations applied. It ends by raising
-- "ALL TESTS PASSED", which undoes everything it did.

begin;

create schema t;
grant usage on schema t to anon, authenticated;

create function t.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function t.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then
    raise exception 'FAIL %', label;
  end if;
end $$;

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
  ada uuid := '00000000-0000-4000-8000-0000000000a1';  -- the owner (and an admin everywhere)
  boss uuid := '00000000-0000-4000-8000-0000000000b1'; -- manager of Sales
  sam uuid := '00000000-0000-4000-8000-0000000000c1';  -- member of Sales
  ines uuid := '00000000-0000-4000-8000-0000000000d1'; -- member of Support
  vera uuid := '00000000-0000-4000-8000-0000000000e1'; -- viewer, no department
  team uuid;
  sales uuid;
  support uuid;
  r jsonb;
  skill uuid;
  folder uuid;
  item uuid;
  rev integer;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role) values
    (ada, 'ada@example.com', '{"name": "Ada"}', 'authenticated', 'authenticated'),
    (boss, 'boss@example.com', '{"name": "Boss"}', 'authenticated', 'authenticated'),
    (sam, 'sam@example.com', '{"name": "Sam"}', 'authenticated', 'authenticated'),
    (ines, 'ines@example.com', '{"name": "Ines"}', 'authenticated', 'authenticated'),
    (vera, 'vera@example.com', '{"name": "Vera"}', 'authenticated', 'authenticated');
  perform t.as_user(ada);
  perform public.claim_owner();
  team := (public.create_team('Acme') ->> 'id')::uuid;
  reset role;
  insert into public.departments (team_id, name) values (team, 'Sales') returning id into sales;
  insert into public.departments (team_id, name) values (team, 'Support') returning id into support;
  perform t.as_user(ada);
  perform public.add_member(team, 'boss@example.com', 'manager', sales);
  perform public.add_member(team, 'sam@example.com', 'member', sales);
  perform public.add_member(team, 'ines@example.com', 'member', support);
  perform public.add_member(team, 'vera@example.com', 'viewer');

  -- ---- Skills: an admin publishes for the team; every member reads it
  r := public.publish_skill(team, 'Call recap', 'Sums up a call', E'---\nname: Call recap\n---\nFive lines.');
  skill := (r -> 'skill' ->> 'id')::uuid;
  perform t.check((r -> 'skill' ->> 'version') = '1' and (r -> 'skill' ->> 'scope') = 'company', 'an admin publishes for the team');
  perform t.as_user(vera);
  perform t.check(jsonb_array_length(public.team_content(team) -> 'skills') = 1, 'a viewer reads a Skill');
  perform t.check((select count(*) from public.team_skills) = 1, 'and through the table');
  perform t.expect(format($q$select public.publish_skill('%s', 'Mine', '', 'x')$q$, team), 'PT403', 'a viewer cannot publish');
  perform t.as_user(sam);
  perform t.expect(format($q$select public.publish_skill('%s', 'Mine', '', 'x')$q$, team), 'PT403', 'a member cannot publish');
  perform t.expect(format($q$select public.update_skill('%s', '%s', 'Hijacked')$q$, team, skill), 'PT403', 'a member cannot change one');
  perform t.expect(format($q$select public.remove_skill('%s', '%s')$q$, team, skill), 'PT403', 'a member cannot remove one');

  -- ---- a manager publishes to their own department only
  perform t.as_user(boss);
  r := public.publish_skill(team, 'Pipeline review', '', 'Review the pipeline.', 'department');
  perform t.check((r -> 'skill' ->> 'departmentId') = sales::text, 'a manager publishes to their department');
  perform t.expect(format($q$select public.publish_skill('%s', 'Triage', '', 'x', 'department', '%s')$q$, team, support), 'PT403', 'not to another department');
  perform t.expect(format($q$select public.publish_skill('%s', 'For all', '', 'x')$q$, team), 'PT403', 'not to the whole team');
  perform t.as_user(sam);
  perform t.check(jsonb_array_length(public.team_content(team) -> 'skills') = 2, 'Sales sees both');
  perform t.as_user(ines);
  perform t.check(jsonb_array_length(public.team_content(team) -> 'skills') = 1, 'Support sees only the team one');
  perform t.check((select count(*) from public.team_skills) = 1, 'and the table agrees');

  -- ---- versions
  perform t.as_user(ada);
  perform t.check((public.update_skill(team, skill, null, 'Sums up a call') ->> 'changed') = 'false', 'the same text is not a new version');
  r := public.update_skill(team, skill, null, null, E'---\nname: Call recap\n---\nThree lines.');
  perform t.check((r ->> 'changed') = 'true' and (r -> 'skill' ->> 'version') = '2', 'a change is version 2');
  perform t.as_user(sam);
  perform t.check(jsonb_array_length(public.skill_versions(team, skill) -> 'versions') = 2, 'members see both versions');
  perform t.check((public.skill_versions(team, skill) -> 'versions' -> 1 ->> 'body') like '%Five lines%', 'the old text is kept');

  -- ---- bad input, duplicates, policy
  perform t.as_user(ada);
  perform t.expect(format($q$select public.publish_skill('%s', '', '', 'x')$q$, team), 'PT400', 'a Skill needs a name');
  perform t.expect(format($q$select public.publish_skill('%s', 'No prompt', '', '   ')$q$, team), 'PT400', 'and a prompt');
  perform t.expect(format($q$select public.publish_skill('%s', 'call RECAP', '', 'x')$q$, team), 'PT409', 'a duplicate name is a conflict');
  perform public.set_policy_values(team, 'team', null, '{"features.notetaker": false}');
  perform t.expect(format($q$select public.publish_skill('%s', 'After the policy', '', 'x')$q$, team), 'PT403', 'the policy can forbid a publish');
  perform public.set_policy_values(team, 'team', null, '{"features.notetaker": null}');

  -- ---- removal
  perform public.remove_skill(team, skill);
  perform t.as_user(sam);
  perform t.check(jsonb_array_length(public.team_content(team) -> 'skills') = 1, 'a removed Skill is gone for members');
  perform t.expect(format($q$select public.skill_versions('%s', '%s')$q$, team, skill), 'PT404', 'and its versions');

  -- ---- shared folders: two people share a folder
  r := public.create_folder(team, 'Q4 deal', 'shared', null, array[ines]);
  folder := (r -> 'folder' ->> 'id')::uuid;
  perform t.check((r -> 'folder' ->> 'canWrite') = 'true' and jsonb_array_length(r -> 'folder' -> 'members') = 2, 'a member makes a shared folder with a colleague');
  item := (public.share_folder_item(team, folder, 'Kickoff call', E'# Kickoff\n- Agreed on the date', 'meeting:42') ->> 'id')::uuid;
  perform t.as_user(ines);
  r := public.team_content(team);
  perform t.check(jsonb_array_length(r -> 'folders') = 1 and (r -> 'folders' -> 0 ->> 'canWrite') = 'true', 'the other person sees the folder');
  perform t.check((r::text) not like '%Agreed on the date%', 'the content answer holds titles, not texts');
  perform t.check((public.read_folder_item(team, folder, item) -> 'item' ->> 'body') like '%Agreed on the date%', 'a note is read one at a time');
  perform t.check((public.read_folder_item(team, folder, item) -> 'item' ->> 'sharedBy') = 'Sam', 'with who shared it');

  -- ---- who is not in it
  perform t.as_user(vera);
  perform t.check(jsonb_array_length(public.team_content(team) -> 'folders') = 0, 'a person outside the folder does not see it');
  perform t.check((select count(*) from public.shared_folders) = 0 and (select count(*) from public.folder_items) = 0, 'nor through the tables');
  perform t.expect(format($q$select public.read_folder_item('%s', '%s', '%s')$q$, team, folder, item), 'PT404', 'nor read a note');
  perform t.expect(format($q$select public.share_folder_item('%s', '%s', 'x', 'y')$q$, team, folder), 'PT404', 'nor add one');
  perform t.expect(format($q$select public.create_folder('%s', 'Mine', 'shared')$q$, team), 'PT403', 'a viewer cannot make a folder');
  perform t.as_user(ada);
  perform t.check(jsonb_array_length(public.team_content(team) -> 'folders') = 1, 'an admin sees every folder');

  -- ---- a read-only member and a viewer in a folder
  perform t.as_user(sam);
  perform public.set_folder_member(team, folder, ines, false);
  perform public.set_folder_member(team, folder, vera, true);
  perform t.as_user(ines);
  perform t.expect(format($q$select public.share_folder_item('%s', '%s', 'x', 'y')$q$, team, folder), 'PT403', 'a read-only member cannot add');
  perform t.as_user(vera);
  perform t.check((public.team_content(team) -> 'folders' -> 0 ->> 'canWrite') = 'false', 'a viewer in a folder reads it');
  perform t.expect(format($q$select public.share_folder_item('%s', '%s', 'x', 'y')$q$, team, folder), 'PT403', 'and adds nothing');

  -- ---- department and company folders
  perform t.as_user(sam);
  perform t.expect(format($q$select public.create_folder('%s', 'Sales notes', 'department')$q$, team), 'PT403', 'a member cannot make a department folder');
  perform t.as_user(boss);
  r := public.create_folder(team, 'Sales notes', 'department');
  perform t.check((r -> 'folder' ->> 'departmentId') = sales::text, 'a manager makes their department''s folder');
  perform t.expect(format($q$select public.create_folder('%s', 'Support notes', 'department', '%s')$q$, team, support), 'PT403', 'not another department''s');
  perform t.expect(format($q$select public.create_folder('%s', 'All hands', 'company')$q$, team), 'PT403', 'and no company folder');
  perform t.as_user(ada);
  perform public.create_folder(team, 'All hands', 'company');
  perform t.as_user(ines);
  perform t.check((select count(*) from jsonb_array_elements(public.team_content(team) -> 'folders') f where f ->> 'name' in ('All hands', 'Sales notes')) = 1, 'Support sees the company folder, not Sales''');
  perform t.as_user(sam);
  perform t.check((select count(*) from jsonb_array_elements(public.team_content(team) -> 'folders') f where f ->> 'name' in ('All hands', 'Sales notes')) = 2, 'Sales sees both');

  -- ---- removal rules
  perform t.as_user(ines);
  perform t.expect(format($q$select public.remove_folder_item('%s', '%s', '%s')$q$, team, folder, item), 'PT403', 'another member cannot remove a note');
  perform t.as_user(sam);
  perform public.remove_folder_item(team, folder, item);
  perform t.as_user(ines);
  perform public.remove_folder_member(team, folder, ines);
  perform t.check(jsonb_array_length(public.team_content(team) -> 'folders') = 1, 'a person may leave a folder');
  perform t.expect(format($q$select public.remove_folder('%s', '%s')$q$, team, folder), 'PT404', 'and then cannot see it to remove it');
  perform t.as_user(sam);
  perform public.share_folder_item(team, folder, 'Another', 'text');
  perform public.remove_folder(team, folder);
  reset role;
  perform t.check((select count(*) from public.folder_items where folder_id = folder) = 0, 'removing a folder removes the copies');

  -- ---- input and keeping in step
  perform t.as_user(sam);
  perform t.expect(format($q$select public.create_folder('%s', '', 'shared')$q$, team), 'PT400', 'a folder needs a name');
  perform t.expect(format($q$select public.create_folder('%s', 'Odd', 'secret')$q$, team), 'PT400', 'and a known kind');
  perform t.expect(format($q$select public.create_folder('%s', 'Out', 'shared', null, array['%s'::uuid])$q$, team, '00000000-0000-4000-8000-0000000000ff'), 'PT400', 'people must be in the team');
  r := public.create_folder(team, 'Big', 'shared');
  perform t.expect(format($q$select public.share_folder_item('%s', '%s', 'Big', repeat('x', 60001))$q$, team, (r -> 'folder' ->> 'id')::uuid), 'PT400', 'a note is at most 60 KB');
  rev := (public.team_content(team) ->> 'revision')::integer;
  perform t.check((public.team_content(team, rev) ->> 'unchanged') = 'true', 'nothing new when the revision has not moved');
  perform public.share_folder_item(team, (r -> 'folder' ->> 'id')::uuid, 'Small', 'text');
  perform t.check((public.team_content(team, rev) ->> 'unchanged') = 'false', 'a change moves it');

  -- ---- plan, team and audit
  perform t.as_user(ada);
  perform public.set_team_plan(team, 'free');
  perform t.as_user(sam);
  perform t.expect(format($q$select public.team_content('%s')$q$, team), 'PT403', 'Free has no shared Skills or folders');
  perform t.as_user(ada);
  perform public.set_team_plan(team, 'enterprise');
  perform t.check((public.verify_audit_chain(team) ->> 'ok') = 'true', 'the audit chain holds');
  perform t.check((select count(*) from public.audit_events where action in ('skill.published', 'folder.created', 'folder.item_shared')) >= 3, 'the changes are in the log');
  perform t.check((select count(*) from public.audit_events where detail::text like '%Agreed on the date%' or detail::text like '%Five lines%' or detail::text like '%Kickoff%') = 0, 'with no prompt or note text');

  raise exception 'ALL TESTS PASSED';
end $$;
