-- 0003 shared vocabulary, policy, usage counts and the functions around them (SW-02, SW-04).
--
-- Same rules as 0001: row-level security on every table, reads through select policies, writes
-- only through `security definer` functions that check `auth.uid()`. The rules that the local
-- server has in TypeScript (who may approve, what a batch may hold) are written here again, and
-- the contract suite runs the same scenarios against both.

-- A department-scoped action ("a manager may review their own department") counts only when the
-- department is given and is the caller's own. Without a department it is a team-wide question,
-- and the answer for such a role is no. (0001 let a missing department through.)
create or replace function private.can(p_action text, p_team uuid, p_department uuid default null) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.role_permissions rp
    where rp.action = p_action
      and (
        (rp.scope = 'server' and rp.role = 'owner' and private.is_server_owner())
        or (
          rp.scope = 'team'
          and (
            (rp.role = private.role_in_team(p_team)
              and (
                not rp.department_scoped
                or (p_department is not null and p_department = private.department_of(p_team))
              ))
            or (rp.role = 'admin' and private.is_server_owner())
          )
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- Tables

-- Team settings, one JSON value each (governance mode, default scope, snippet variables).
create table public.team_settings (
  team_id uuid not null references public.teams (id) on delete cascade,
  key     text not null,
  value   jsonb not null,
  primary key (team_id, key)
);
alter table public.team_settings enable row level security;

-- Goes up whenever shared content changes, so a client can ask "anything new since?".
create table public.team_revisions (
  team_id         uuid primary key references public.teams (id) on delete cascade,
  revision        integer not null default 0,
  policy_revision integer not null default 0
);
alter table public.team_revisions enable row level security;

create table public.vocabulary_items (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  kind          text not null check (kind in ('dictionary', 'snippet')),
  scope         text not null check (scope in ('company', 'department')),
  department_id uuid references public.departments (id) on delete cascade,
  key           text not null,
  payload       jsonb not null,
  status        text not null check (status in ('active', 'pending', 'rejected', 'deleted')),
  locked        boolean not null default false,
  proposed_by   uuid references public.profiles (id) on delete set null,
  approved_by   uuid references public.profiles (id) on delete set null,
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((scope = 'company') = (department_id is null))
);
create index vocabulary_items_team on public.vocabulary_items (team_id, kind, status);
-- One live entry per term (or trigger) in a place.
create unique index vocabulary_items_unique on public.vocabulary_items
  (team_id, kind, scope, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
  where status in ('active', 'pending');
alter table public.vocabulary_items enable row level security;

-- Who changed an entry, when, and what it was: the way back for a rollback.
create table public.vocabulary_versions (
  id         bigint generated always as identity primary key,
  item_id    uuid not null references public.vocabulary_items (id) on delete cascade,
  version    integer not null,
  action     text not null,
  payload    jsonb not null,
  status     text not null,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index vocabulary_versions_item on public.vocabulary_versions (item_id, version);
alter table public.vocabulary_versions enable row level security;

-- Told to a proposer at their next sign-in when their proposal was rejected.
create table public.vocabulary_notices (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  item_id    uuid not null,
  kind       text not null,
  summary    text not null,
  note       text not null default '',
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index vocabulary_notices_user on public.vocabulary_notices (user_id, seen_at);
alter table public.vocabulary_notices enable row level security;

-- One row per setting per layer: the whole team, a department, one member. `scope_id` is empty
-- for the team, a department id for a department, a user id for a member.
create table public.policy_values (
  team_id    uuid not null references public.teams (id) on delete cascade,
  scope      text not null check (scope in ('team', 'department', 'member')),
  scope_id   text not null default '',
  key        text not null check (key ~ '^[A-Za-z][A-Za-z0-9_.]{0,63}$'),
  value      jsonb not null,
  source     text not null default 'admin' check (source in ('admin', 'compliance')),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (team_id, scope, scope_id, key)
);
alter table public.policy_values enable row level security;

-- Daily counts per person, metric and app group. Counts only: never a word of text.
create table public.usage_daily (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day     date not null,
  metric  text not null,
  bucket  text not null default '',
  count   bigint not null check (count >= 0),
  primary key (team_id, user_id, day, metric, bucket)
);
create index usage_daily_day on public.usage_daily (team_id, day);
alter table public.usage_daily enable row level security;

-- A batch that was received, so a client that sends it again is not counted twice. No client
-- reads this table: it has no policy at all.
create table public.usage_batches (
  team_id     uuid not null references public.teams (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  batch_id    text not null,
  received_at timestamptz not null default now(),
  primary key (team_id, user_id, batch_id)
);
alter table public.usage_batches enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Triggers

create function private.bump_revision() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.team_revisions (team_id, revision) values (new.team_id, 1)
  on conflict (team_id) do update set revision = public.team_revisions.revision + 1;
  return new;
end;
$$;

-- The revision moves when what members can see moves: an entry going live, changing or leaving.
create trigger vocabulary_items_revision_insert
  after insert on public.vocabulary_items
  for each row when (new.status = 'active')
  execute function private.bump_revision();
create trigger vocabulary_items_revision_update
  after update on public.vocabulary_items
  for each row when (old.status = 'active' or new.status = 'active')
  execute function private.bump_revision();

create function private.bump_policy_revision() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t uuid := coalesce(new.team_id, old.team_id);
begin
  insert into public.team_revisions (team_id, policy_revision) values (t, 1)
  on conflict (team_id) do update set policy_revision = public.team_revisions.policy_revision + 1;
  return null;
end;
$$;
create trigger policy_values_revision
  after insert or update or delete on public.policy_values
  for each row execute function private.bump_policy_revision();

-- ---------------------------------------------------------------------------------------------
-- Read policies

create policy team_settings_read on public.team_settings for select to authenticated
  using (private.is_member(team_id));

create policy team_revisions_read on public.team_revisions for select to authenticated
  using (private.is_member(team_id));

-- An active entry in the caller's place (the whole team, their department), their own proposals,
-- and everything for those who may review it.
create policy vocabulary_items_read on public.vocabulary_items for select to authenticated
  using (
    private.is_member(team_id)
    and (
      (status = 'active' and (scope = 'company' or department_id = private.department_of(team_id)))
      or proposed_by = (select auth.uid())
      or private.can('vocabulary.manage', team_id)
      or private.can('vocabulary.review', team_id, department_id)
    )
  );

create policy vocabulary_versions_read on public.vocabulary_versions for select to authenticated
  using (
    exists (
      select 1 from public.vocabulary_items i
      where i.id = vocabulary_versions.item_id
        and (private.can('vocabulary.manage', i.team_id) or private.can('vocabulary.review', i.team_id, i.department_id))
    )
  );

create policy vocabulary_notices_read on public.vocabulary_notices for select to authenticated
  using (user_id = (select auth.uid()));

-- A person sees the team's values, their department's and their own, and an admin sees all.
create policy policy_values_read on public.policy_values for select to authenticated
  using (
    private.is_member(team_id)
    and (
      scope = 'team'
      or (scope = 'department' and scope_id = private.department_of(team_id)::text)
      or (scope = 'member' and scope_id = (select auth.uid())::text)
      or private.can('policy.manage', team_id)
    )
  );

-- Your own counts; a team's for whoever may view usage (a manager: their department's).
create policy usage_daily_read on public.usage_daily for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.team_members tm
      where tm.team_id = usage_daily.team_id
        and tm.user_id = usage_daily.user_id
        and private.can('usage.view', usage_daily.team_id, tm.department_id)
    )
  );

grant select on public.team_settings, public.team_revisions, public.vocabulary_items,
  public.vocabulary_versions, public.vocabulary_notices, public.policy_values, public.usage_daily
  to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Functions a client calls

-- The team's shared entries in the caller's place, with a revision; or `unchanged` when the
-- caller already has this revision.
create function public.team_vocabulary(p_team uuid, p_since integer default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  rev integer;
  dept uuid := private.department_of(p_team);
begin
  if not private.can('vocabulary.view', p_team) then
    perform private.fail(403, 'You may not see this team''s shared entries.');
  end if;
  select coalesce(revision, 0) into rev from public.team_revisions where team_id = p_team;
  rev := coalesce(rev, 0);
  if p_since is not null and p_since = rev then
    return jsonb_build_object('unchanged', true);
  end if;
  return jsonb_build_object(
    'unchanged', false,
    'revision', rev,
    'context', jsonb_build_object(
      'me', (select name from public.profiles where id = me),
      'team', (select name from public.teams where id = p_team)
    ),
    'dictionary', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'term', i.payload ->> 'term',
        'replacement', i.payload -> 'replacement',
        'pronunciation', coalesce(i.payload ->> 'pronunciation', '')
      ) order by i.key, i.id)
      from public.vocabulary_items i
      where i.team_id = p_team and i.kind = 'dictionary' and i.status = 'active'
        and (i.scope = 'company' or i.department_id = dept)
    ), '[]'::jsonb),
    'snippets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'trigger', i.payload ->> 'trigger',
        'expansion', i.payload ->> 'expansion',
        'format', coalesce(i.payload ->> 'format', 'plain'),
        'locked', i.locked
      ) order by i.key, i.id)
      from public.vocabulary_items i
      where i.team_id = p_team and i.kind = 'snippet' and i.status = 'active'
        and (i.scope = 'company' or i.department_id = dept)
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.team_vocabulary(uuid, integer) from public;
grant execute on function public.team_vocabulary(uuid, integer) to authenticated;

-- Puts an entry forward. It goes live when the team is open, or when the caller may approve it
-- where it would go; otherwise it waits for a review.
create function public.propose_item(
  p_team uuid,
  p_kind text,
  p_term text default null,
  p_replacement text default null,
  p_trigger text default null,
  p_expansion text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  mode text := coalesce((select value #>> '{}' from public.team_settings where team_id = p_team and key = 'team.governance.mode'), 'review');
  default_scope text := coalesce((select value #>> '{}' from public.team_settings where team_id = p_team and key = 'team.dictionary.defaultScope'), 'department');
  allowed text[] := coalesce(
    (select array(select jsonb_array_elements_text(value)) from public.team_settings where team_id = p_team and key = 'team.snippets.allowVariables'),
    array['date', 'me', 'team']
  );
  dept uuid := private.department_of(p_team);
  place text;
  place_dept uuid;
  item_key text;
  item_payload jsonb;
  is_live boolean;
  made uuid;
  var text;
begin
  if not private.can('vocabulary.propose', p_team) then
    perform private.fail(403, 'You may not propose shared entries in this team.');
  end if;
  if mode = 'locked' and not private.can('vocabulary.manage', p_team) then
    perform private.fail(403, 'This team''s vocabulary is locked: only admins change it.');
  end if;

  if p_kind = 'dictionary' then
    if p_term is null or btrim(p_term) = '' then
      perform private.fail(400, 'A dictionary entry needs a term.');
    end if;
    if char_length(btrim(p_term)) > 100 then
      perform private.fail(400, 'A term has at most 100 characters.');
    end if;
    if p_replacement is not null and char_length(p_replacement) > 1000 then
      perform private.fail(400, 'A replacement has at most 1000 characters.');
    end if;
    item_key := lower(btrim(p_term));
    item_payload := jsonb_build_object(
      'term', btrim(p_term),
      'replacement', case when p_replacement is null or btrim(p_replacement) = '' then null else p_replacement end,
      'pronunciation', ''
    );
  elsif p_kind = 'snippet' then
    if p_trigger is null or btrim(p_trigger) = '' then
      perform private.fail(400, 'A snippet needs a trigger.');
    end if;
    if char_length(btrim(p_trigger)) > 100 then
      perform private.fail(400, 'A trigger has at most 100 characters.');
    end if;
    if p_expansion is null or btrim(p_expansion) = '' then
      perform private.fail(400, 'A snippet needs text to insert.');
    end if;
    if octet_length(p_expansion) > 20000 then
      perform private.fail(400, 'That snippet is too long.');
    end if;
    for var in select lower(btrim(m[1])) from regexp_matches(p_expansion, '\{\{([^{}]*)\}\}', 'g') as m loop
      if not (var = any (allowed)) then
        perform private.fail(400, format('{{%s}} is not allowed in this team''s snippets.', var));
      end if;
    end loop;
    item_key := lower(btrim(p_trigger));
    item_payload := jsonb_build_object('trigger', btrim(p_trigger), 'expansion', p_expansion, 'format', 'plain');
  else
    perform private.fail(400, 'An entry is a dictionary entry or a snippet.');
  end if;

  -- Where it goes: the team's default place; a person with no department adds to the whole team.
  place := default_scope;
  if place = 'department' and dept is null then
    place := 'company';
  end if;
  place_dept := case when place = 'department' then dept else null end;

  if exists (
    select 1 from public.vocabulary_items
    where team_id = p_team and kind = p_kind and scope = place
      and coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(place_dept, '00000000-0000-0000-0000-000000000000'::uuid)
      and key = item_key and status in ('active', 'pending')
  ) then
    perform private.fail(409, 'That is already in the shared list for this scope.');
  end if;

  is_live := mode = 'open'
    or private.can('vocabulary.manage', p_team)
    or (place_dept is not null and private.can('vocabulary.review', p_team, place_dept));

  insert into public.vocabulary_items (team_id, kind, scope, department_id, key, payload, status, proposed_by, approved_by)
  values (p_team, p_kind, place, place_dept, item_key, item_payload,
          case when is_live then 'active' else 'pending' end, me, case when is_live then me else null end)
  returning id into made;
  if is_live then
    insert into public.vocabulary_versions (item_id, version, action, payload, status, changed_by)
    values (made, 1, 'created', item_payload, 'active', me);
  end if;
  perform private.audit(p_team, me, case when is_live then 'vocabulary.created' else 'vocabulary.proposed' end,
                        'vocabulary', made::text, jsonb_build_object('kind', p_kind, 'scope', place));
  return jsonb_build_object('live', is_live);
end;
$$;
revoke execute on function public.propose_item(uuid, text, text, text, text, text) from public;
grant execute on function public.propose_item(uuid, text, text, text, text, text) to authenticated;

-- A reviewer approves or turns down a waiting entry. A turned-down proposal tells its proposer.
create function public.review_item(p_team uuid, p_item uuid, p_approve boolean, p_note text default '') returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  item public.vocabulary_items;
begin
  select * into item from public.vocabulary_items where id = p_item and team_id = p_team for update;
  if not found or item.status <> 'pending' then
    perform private.fail(404, 'There is no such entry waiting for review.');
  end if;
  if not (private.can('vocabulary.manage', p_team) or private.can('vocabulary.review', p_team, item.department_id)) then
    perform private.fail(403, 'You may not review this entry.');
  end if;
  if p_approve then
    update public.vocabulary_items
      set status = 'active', approved_by = me, version = version + 1, updated_at = now()
      where id = item.id;
    insert into public.vocabulary_versions (item_id, version, action, payload, status, changed_by)
    values (item.id, item.version + 1, 'approved', item.payload, 'active', me);
    perform private.audit(p_team, me, 'vocabulary.approved', 'vocabulary', item.id::text, jsonb_build_object('kind', item.kind));
    return jsonb_build_object('status', 'active');
  end if;
  update public.vocabulary_items set status = 'rejected', updated_at = now() where id = item.id;
  if item.proposed_by is not null then
    insert into public.vocabulary_notices (team_id, user_id, item_id, kind, summary, note)
    values (p_team, item.proposed_by, item.id, 'rejected',
            left(coalesce(item.payload ->> 'term', item.payload ->> 'trigger', ''), 100),
            left(coalesce(p_note, ''), 500));
  end if;
  perform private.audit(p_team, me, 'vocabulary.rejected', 'vocabulary', item.id::text, jsonb_build_object('kind', item.kind));
  return jsonb_build_object('status', 'rejected');
end;
$$;
revoke execute on function public.review_item(uuid, uuid, boolean, text) from public;
grant execute on function public.review_item(uuid, uuid, boolean, text) to authenticated;

-- Rejections the caller has not been told about yet.
create function public.my_notices(p_team uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'summary', n.summary, 'note', n.note) order by n.created_at, n.id)
    from public.vocabulary_notices n
    where n.team_id = p_team and n.user_id = me and n.seen_at is null
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.my_notices(uuid) from public;
grant execute on function public.my_notices(uuid) to authenticated;

create function public.mark_notices_seen(p_team uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  n integer;
begin
  update public.vocabulary_notices set seen_at = now()
    where team_id = p_team and user_id = me and seen_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('marked', n);
end;
$$;
revoke execute on function public.mark_notices_seen(uuid) from public;
grant execute on function public.mark_notices_seen(uuid) to authenticated;

-- An admin changes one of the team's settings. Only these keys, with these kinds of value.
create function public.set_team_setting(p_team uuid, p_key text, p_value jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
begin
  if not private.can('vocabulary.settings', p_team) then
    perform private.fail(403, 'You may not change this team''s settings.');
  end if;
  if p_key = 'team.governance.mode' then
    if p_value not in ('"review"'::jsonb, '"open"'::jsonb, '"locked"'::jsonb) then
      perform private.fail(400, 'Governance is review, open or locked.');
    end if;
  elsif p_key = 'team.dictionary.defaultScope' then
    if p_value not in ('"company"'::jsonb, '"department"'::jsonb) then
      perform private.fail(400, 'The default scope is company or department.');
    end if;
  elsif p_key = 'team.snippets.allowVariables' then
    if jsonb_typeof(p_value) <> 'array' then
      perform private.fail(400, 'The allowed variables are a list.');
    end if;
  else
    perform private.fail(400, 'That is not a setting of this team.');
  end if;
  insert into public.team_settings (team_id, key, value) values (p_team, p_key, p_value)
  on conflict (team_id, key) do update set value = excluded.value;
  perform private.audit(p_team, me, 'team.setting_changed', 'setting', p_key, '{}'::jsonb);
  return jsonb_build_object('key', p_key);
end;
$$;
revoke execute on function public.set_team_setting(uuid, text, jsonb) from public;
grant execute on function public.set_team_setting(uuid, text, jsonb) to authenticated;

-- The policy layers that apply to the caller. The client merges them (strictest wins) with the
-- same rules the app uses to enforce them; the database holds the values and no more.
create function public.policy_layers(p_team uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'policyBasic');
  dept uuid := private.department_of(p_team);
begin
  if not private.can('policy.view', p_team) then
    perform private.fail(403, 'You may not see this team''s policy.');
  end if;
  return jsonb_build_object(
    'revision', coalesce((select policy_revision from public.team_revisions where team_id = p_team), 0),
    'team', coalesce((select jsonb_object_agg(key, value) from public.policy_values
                      where team_id = p_team and scope = 'team'), '{}'::jsonb),
    'department', coalesce((select jsonb_object_agg(key, value) from public.policy_values
                            where team_id = p_team and scope = 'department' and scope_id = dept::text), '{}'::jsonb),
    'member', coalesce((select jsonb_object_agg(key, value) from public.policy_values
                        where team_id = p_team and scope = 'member' and scope_id = me::text), '{}'::jsonb)
  );
end;
$$;
revoke execute on function public.policy_layers(uuid) from public;
grant execute on function public.policy_layers(uuid) to authenticated;

-- Sets and clears values in one layer: a JSON null clears. Whether a value means anything is the
-- admin tool's to check (it shares the app's rules); the database checks the shape of the key.
create function public.set_policy_values(p_team uuid, p_scope text, p_scope_id text, p_values jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'policyBasic');
  k text;
  v jsonb;
  changed integer := 0;
  target text := coalesce(p_scope_id, '');
begin
  if not private.can('policy.manage', p_team) then
    perform private.fail(403, 'You may not change this team''s policy.');
  end if;
  if p_scope not in ('team', 'department', 'member') then
    perform private.fail(400, 'The scope is team, department or member.');
  end if;
  if jsonb_typeof(p_values) <> 'object' then
    perform private.fail(400, 'Send the values as an object.');
  end if;
  if p_scope = 'team' then
    target := '';
  elsif p_scope = 'department' then
    if not exists (select 1 from public.departments where id::text = target and team_id = p_team) then
      perform private.fail(404, 'That department is not in this team.');
    end if;
  elsif not exists (select 1 from public.team_members where user_id::text = target and team_id = p_team) then
    perform private.fail(404, 'That person is not in this team.');
  end if;
  for k, v in select * from jsonb_each(p_values) loop
    if k !~ '^[A-Za-z][A-Za-z0-9_.]{0,63}$' then
      perform private.fail(400, 'That is not the name of a policy setting.');
    end if;
    if jsonb_typeof(v) = 'null' then
      delete from public.policy_values where team_id = p_team and scope = p_scope and scope_id = target and key = k;
    else
      insert into public.policy_values (team_id, scope, scope_id, key, value, updated_by)
      values (p_team, p_scope, target, k, v, me)
      on conflict (team_id, scope, scope_id, key)
        do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
    end if;
    changed := changed + 1;
  end loop;
  -- The log holds which settings changed, never their values.
  perform private.audit(p_team, me, 'policy.updated', 'team', p_team::text,
                        jsonb_build_object('scope', p_scope, 'keys', (select jsonb_agg(key) from jsonb_object_keys(p_values) as key)));
  return jsonb_build_object('changed', changed);
end;
$$;
revoke execute on function public.set_policy_values(uuid, text, text, jsonb) from public;
grant execute on function public.set_policy_values(uuid, text, text, jsonb) to authenticated;

-- A client's report that it applied a retention limit. Counts only, in the audit log.
create function public.report_retention(p_team uuid, p_audio integer default 0, p_transcripts integer default 0) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'policyBasic');
begin
  if not private.can('policy.view', p_team) then
    perform private.fail(403, 'You may not report for this team.');
  end if;
  if p_audio < 0 or p_transcripts < 0 or p_audio > 10000000 or p_transcripts > 10000000 then
    perform private.fail(400, 'The counts are whole numbers.');
  end if;
  -- The names avoid the words the audit log refuses: it holds counts, never content.
  perform private.audit(p_team, me, 'policy.retention_applied', 'team', p_team::text,
                        jsonb_build_object('recordings', p_audio, 'meetings', p_transcripts));
  return jsonb_build_object('recorded', true);
end;
$$;
revoke execute on function public.report_retention(uuid, integer, integer) from public;
grant execute on function public.report_retention(uuid, integer, integer) to authenticated;

-- A batch of counts. A batch id seen before is counted once.
create function public.send_usage(p_team uuid, p_batch text, p_events jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'usageDashboards');
  today date := (now() at time zone 'utc')::date;
  ev jsonb;
  d date;
  metric text;
  n numeric;
  grp text;
  b text;
  fresh boolean;
  accepted integer := 0;
begin
  if not private.can('usage.ingest', p_team) then
    perform private.fail(403, 'You may not send counts for this team.');
  end if;
  if p_batch is null or p_batch !~ '^[A-Za-z0-9_-]{8,64}$' then
    perform private.fail(400, 'A batch has an id of 8 to 64 letters, digits, - or _.');
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array'
     or jsonb_array_length(p_events) < 1 or jsonb_array_length(p_events) > 500 then
    perform private.fail(400, 'A batch has 1 to 500 events.');
  end if;

  -- All events are checked before any is kept.
  for ev in select * from jsonb_array_elements(p_events) loop
    if jsonb_typeof(ev) <> 'object' then
      perform private.fail(400, 'Each event is an object.');
    end if;
    if coalesce(ev ->> 'day', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      perform private.fail(400, 'An event''s day is YYYY-MM-DD.');
    end if;
    begin
      d := (ev ->> 'day')::date;
    exception when others then
      perform private.fail(400, 'An event''s day is YYYY-MM-DD.');
    end;
    if today - d > 35 or today - d < -1 then
      perform private.fail(400, 'An event''s day is within the last 35 days.');
    end if;
    if coalesce(ev ->> 'metric', '') not in
       ('words', 'dictations', 'meeting_minutes_recorded', 'meeting_minutes_processed',
        'meetings_recorded', 'skills_run', 'ask_sessions') then
      perform private.fail(400, 'A metric is words, dictations, meeting_minutes_recorded, meeting_minutes_processed, meetings_recorded, skills_run or ask_sessions.');
    end if;
    if jsonb_typeof(ev -> 'count') <> 'number' then
      perform private.fail(400, 'A count is a whole number up to 1000000.');
    end if;
    n := (ev ->> 'count')::numeric;
    if n <> trunc(n) or n < 0 or n > 1000000 then
      perform private.fail(400, 'A count is a whole number up to 1000000.');
    end if;
  end loop;

  insert into public.usage_batches (team_id, user_id, batch_id) values (p_team, me, p_batch)
  on conflict do nothing;
  get diagnostics accepted = row_count;
  fresh := accepted = 1;
  if not fresh then
    return jsonb_build_object('accepted', 0, 'duplicate', true);
  end if;

  accepted := 0;
  for ev in select * from jsonb_array_elements(p_events) loop
    n := (ev ->> 'count')::numeric;
    continue when n = 0;
    metric := ev ->> 'metric';
    b := '';
    if metric in ('words', 'dictations') then
      grp := lower(coalesce(ev ->> 'bucket', 'other'));
      b := case when grp in ('mail', 'browser', 'chat', 'documents', 'code', 'notes', 'other') then grp else 'other' end;
    end if;
    insert into public.usage_daily (team_id, user_id, day, metric, bucket, count)
    values (p_team, me, (ev ->> 'day')::date, metric, b, n::bigint)
    on conflict (team_id, user_id, day, metric, bucket)
      do update set count = public.usage_daily.count + excluded.count;
    accepted := accepted + 1;
  end loop;
  return jsonb_build_object('accepted', accepted, 'duplicate', false);
end;
$$;
revoke execute on function public.send_usage(uuid, text, jsonb) from public;
grant execute on function public.send_usage(uuid, text, jsonb) to authenticated;

-- Adds an existing account to the team. The person has an account first (an invite makes one).
create function public.add_member(p_team uuid, p_email text, p_role text default 'member', p_department uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teams');
  who uuid;
begin
  if not private.can('members.manage', p_team) then
    perform private.fail(403, 'You may not add people to this team.');
  end if;
  if p_role not in ('admin', 'manager', 'member', 'viewer') then
    perform private.fail(400, 'A member is an admin, manager, member or viewer.');
  end if;
  if p_department is not null
     and not exists (select 1 from public.departments where id = p_department and team_id = p_team) then
    perform private.fail(400, 'That department is not in this team.');
  end if;
  select id into who from public.profiles where email = lower(btrim(p_email)) and status = 'active';
  if who is null then
    perform private.fail(404, 'There is no account with that email.');
  end if;
  if exists (select 1 from public.team_members where team_id = p_team and user_id = who) then
    perform private.fail(409, 'That person is already in this team.');
  end if;
  insert into public.team_members (team_id, user_id, role, department_id) values (p_team, who, p_role, p_department);
  perform private.audit(p_team, me, 'member.added', 'user', who::text, jsonb_build_object('role', p_role));
  return jsonb_build_object('userId', who);
end;
$$;
revoke execute on function public.add_member(uuid, text, text, uuid) from public;
grant execute on function public.add_member(uuid, text, text, uuid) to authenticated;

-- Sets a team's plan tier. A local switch for testing: nothing is charged anywhere.
create function public.set_team_plan(p_team uuid, p_tier text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, null);
begin
  if not private.can('plan.manage', p_team) then
    perform private.fail(403, 'Only the owner of this server can change the plan.');
  end if;
  if p_tier not in ('free', 'pro', 'team', 'growth', 'enterprise') then
    perform private.fail(400, 'The plan is free, pro, team, growth or enterprise.');
  end if;
  update public.team_plans set tier = p_tier where team_id = p_team;
  perform private.audit(p_team, me, 'plan.changed', 'team', p_team::text, jsonb_build_object('tier', p_tier));
  return jsonb_build_object('tier', p_tier);
end;
$$;
revoke execute on function public.set_team_plan(uuid, text) from public;
grant execute on function public.set_team_plan(uuid, text) to authenticated;
