-- 0001 accounts and teams (SW-02, SW-04).
--
-- Murmur's team backend on Postgres. Rules this file follows, and every later one too:
--   * Row-level security is on for every table in `public`.
--   * A client reads through select policies and writes only through the functions below. No
--     table has an insert, update or delete policy for a client.
--   * Functions that change things are `security definer` with an empty search_path and check
--     `auth.uid()` themselves. A function a client may call is in `public`; helpers that
--     policies and functions share are in `private`, which the API does not expose.
--   * Errors carry a PostgREST status code (`PT403` is HTTP 403), so a client can tell
--     "not allowed" from "not found" from "that clashes with what is there".

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- New objects start closed. Each one is opened by an explicit grant.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Errors

create function private.fail(p_status int, p_message text) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_message using errcode = 'PT' || p_status::text;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Accounts

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,
  name       text not null,
  is_owner   boolean not null default false,
  status     text not null default 'active' check (status in ('active', 'deactivated')),
  created_at timestamptz not null default now()
);
-- At most one owner (the person who set the backend up).
create unique index profiles_one_owner on public.profiles (is_owner) where is_owner;

alter table public.profiles enable row level security;

-- A profile is made for every account Supabase Auth makes. The name comes from the sign-up data.
create function private.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    lower(new.email),
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- The permission matrix and the plan matrix, as data

-- Seeded from services/local-server/src/permissions.json. A test compares the two, so the
-- server and the database cannot drift (SW-04).
create table public.role_permissions (
  action           text not null,
  scope            text not null check (scope in ('server', 'team')),
  role             text not null check (role in ('owner', 'admin', 'manager', 'member', 'viewer')),
  department_scoped boolean not null default false,
  primary key (action, role)
);
alter table public.role_permissions enable row level security;

-- Seeded from packages/shared/src/plans.ts (FEATURE_TIER), and compared by a test.
create table public.plan_features (
  feature  text primary key,
  min_tier text not null check (min_tier in ('free', 'pro', 'team', 'growth', 'enterprise'))
);
alter table public.plan_features enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Teams

create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (btrim(name) <> '' and char_length(name) <= 100),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.teams enable row level security;

-- A tier name and nothing else: no billing columns (canonical rules).
create table public.team_plans (
  team_id uuid primary key references public.teams (id) on delete cascade,
  tier    text not null default 'enterprise' check (tier in ('free', 'pro', 'team', 'growth', 'enterprise'))
);
alter table public.team_plans enable row level security;

-- One level: a department may have a parent that has none (TM-05).
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams (id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  cost_center text not null default '',
  parent_id   uuid references public.departments (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (team_id, name)
);
alter table public.departments enable row level security;

create table public.team_members (
  team_id       uuid not null references public.teams (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          text not null check (role in ('owner', 'admin', 'manager', 'member', 'viewer')),
  department_id uuid references public.departments (id) on delete set null,
  joined_at     timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user on public.team_members (user_id);
alter table public.team_members enable row level security;

-- Only the hash of an invite code is kept.
create table public.invites (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references public.teams (id) on delete cascade,
  code_hash         bytea not null unique,
  role              text not null check (role in ('admin', 'manager', 'member', 'viewer')),
  department_id     uuid references public.departments (id) on delete set null,
  created_by        uuid not null references public.profiles (id) on delete restrict,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  max_uses          integer not null check (max_uses > 0),
  uses              integer not null default 0,
  approval_required boolean not null,
  revoked_at        timestamptz
);
create index invites_team on public.invites (team_id);
alter table public.invites enable row level security;

-- A request to join, made with an invite that needs approval.
create table public.join_requests (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  invite_id     uuid references public.invites (id) on delete set null,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  role          text not null,
  department_id uuid references public.departments (id) on delete set null,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  created_at    timestamptz not null default now(),
  decided_by    uuid references public.profiles (id) on delete restrict,
  decided_at    timestamptz
);
create index join_requests_team on public.join_requests (team_id, status);
create index join_requests_user on public.join_requests (user_id);
alter table public.join_requests enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Audit events (TM-12): append-only, one hash chain per team

create table public.audit_events (
  team_id     uuid not null references public.teams (id) on delete restrict,
  seq         bigint not null,
  ts          timestamptz not null,
  actor_id    uuid references public.profiles (id) on delete restrict,
  action      text not null,
  target_type text not null default '',
  target_id   text not null default '',
  detail      jsonb not null default '{}'::jsonb,
  prev_hash   text not null,
  hash        text not null unique,
  primary key (team_id, seq)
);
alter table public.audit_events enable row level security;

create function private.audit_frozen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit events cannot be changed or removed.';
end;
$$;

create trigger audit_events_frozen
  before update or delete on public.audit_events
  for each row execute function private.audit_frozen();

-- ---------------------------------------------------------------------------------------------
-- Helpers (private)

create function private.uid() returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    perform private.fail(401, 'Sign in to continue.');
  end if;
  return me;
end;
$$;

create function private.is_server_owner() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_owner and status = 'active'
  );
$$;

create function private.is_member(p_team uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team and user_id = (select auth.uid())
  );
$$;

create function private.role_in_team(p_team uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.team_members
  where team_id = p_team and user_id = (select auth.uid());
$$;

create function private.department_of(p_team uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select department_id from public.team_members
  where team_id = p_team and user_id = (select auth.uid());
$$;

-- Whether the caller may do `p_action` in the team. A server-scoped action is the owner's. The
-- owner of the backend may also do what an admin may do in any team. A manager's action that is
-- department-scoped counts only for their own department (`p_department`, when it is given).
create function private.can(p_action text, p_team uuid, p_department uuid default null) returns boolean
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
                or p_department is null
                or p_department = private.department_of(p_team)
              ))
            or (rp.role = 'admin' and private.is_server_owner())
          )
        )
      )
  );
$$;

-- Whether the team's plan has the feature (TM-25).
create function private.plan_allows(p_team uuid, p_feature text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select array_position(array['free', 'pro', 'team', 'growth', 'enterprise'], tp.tier)
             >= array_position(array['free', 'pro', 'team', 'growth', 'enterprise'], pf.min_tier)
      from public.team_plans tp, public.plan_features pf
      where tp.team_id = p_team and pf.feature = p_feature
    ),
    false
  );
$$;

-- The caller is a member and the plan has the feature; otherwise the answer a client acts on.
create function private.require_team(p_team uuid, p_feature text) returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := private.uid();
begin
  if not exists (select 1 from public.teams where id = p_team) then
    perform private.fail(404, 'There is no such team.');
  end if;
  if not private.is_member(p_team) and not private.is_server_owner() then
    perform private.fail(403, 'You are not in this team.');
  end if;
  if p_feature is not null and not private.plan_allows(p_team, p_feature) then
    perform private.fail(403, 'This is not on the team''s plan.');
  end if;
  return me;
end;
$$;

-- Adds an event to the team's chain. Each row holds the hash of the one before it; the row's
-- hash covers every field, so a changed row breaks the chain from there on.
create function private.audit(
  p_team uuid,
  p_actor uuid,
  p_action text,
  p_target_type text default '',
  p_target_id text default '',
  p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_seq bigint;
  last_hash text;
  n bigint;
  prev text;
  at timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_team::text, 0));
  select seq, hash into last_seq, last_hash
  from public.audit_events where team_id = p_team order by seq desc limit 1;
  n := coalesce(last_seq, 0) + 1;
  prev := coalesce(last_hash, repeat('0', 64));
  insert into public.audit_events (team_id, seq, ts, actor_id, action, target_type, target_id, detail, prev_hash, hash)
  values (
    p_team, n, at, p_actor, p_action, p_target_type, p_target_id, p_detail, prev,
    private.audit_hash(prev, n, at, p_actor, p_action, p_target_type, p_target_id, p_detail)
  );
end;
$$;

create function private.audit_hash(
  p_prev text, p_seq bigint, p_ts timestamptz, p_actor uuid, p_action text,
  p_target_type text, p_target_id text, p_detail jsonb
) returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      concat_ws('|', p_prev, p_seq::text, extract(epoch from p_ts)::text, coalesce(p_actor::text, ''),
                p_action, p_target_type, p_target_id, p_detail::text),
      'sha256'
    ),
    'hex'
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- Read policies

create policy profiles_read on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.team_members mine
      join public.team_members theirs on theirs.team_id = mine.team_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
    )
  );

create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy plan_features_read on public.plan_features for select to authenticated using (true);

create policy teams_read on public.teams for select to authenticated
  using (private.is_member(id));

create policy team_plans_read on public.team_plans for select to authenticated
  using (private.is_member(team_id));

create policy departments_read on public.departments for select to authenticated
  using (private.is_member(team_id));

create policy team_members_read on public.team_members for select to authenticated
  using (private.is_member(team_id));

create policy invites_read on public.invites for select to authenticated
  using (private.can('invites.manage', team_id));

create policy join_requests_read on public.join_requests for select to authenticated
  using (user_id = (select auth.uid()) or private.can('requests.manage', team_id));

-- The audit log is the backend owner's to read (the matrix's `audit.view`). There is no
-- insert, update or delete policy: events are written by `private.audit` alone.
create policy audit_events_read on public.audit_events for select to authenticated
  using (private.can('audit.view', team_id));

-- A client may read; it may not write, and may not read an invite's code hash.
grant select on public.profiles, public.role_permissions, public.plan_features, public.teams,
  public.team_plans, public.departments, public.team_members, public.join_requests
  to authenticated;
grant select (id, team_id, role, department_id, created_by, created_at, expires_at, max_uses, uses,
  approval_required, revoked_at) on public.invites to authenticated;
-- Update and delete are granted so that an attempt on an audit row is answered with "no rows"
-- (nothing is visible to change) rather than an error; the trigger above stops anyone else.
grant select, update, delete on public.audit_events to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Functions a client calls

-- Whether there is a backend, and whether it has an owner yet.
create function public.murmur_health() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('setUp', exists (select 1 from public.profiles where is_owner));
$$;
revoke execute on function public.murmur_health() from public;
grant execute on function public.murmur_health() to anon, authenticated;

-- The first run: the person who signed up becomes the owner, once.
create function public.claim_owner() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.uid();
begin
  if exists (select 1 from public.profiles where is_owner) then
    perform private.fail(409, 'This server already has an owner.');
  end if;
  begin
    update public.profiles set is_owner = true where id = me;
  exception when unique_violation then
    perform private.fail(409, 'This server already has an owner.');
  end;
  return jsonb_build_object('owner', true);
end;
$$;
revoke execute on function public.claim_owner() from public;
grant execute on function public.claim_owner() to authenticated;

-- The owner makes a team and is its first member.
create function public.create_team(p_name text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.uid();
  made uuid;
begin
  if not private.can('team.create', null) then
    perform private.fail(403, 'Only the owner of this server can make a team.');
  end if;
  if p_name is null or btrim(p_name) = '' or char_length(p_name) > 100 then
    perform private.fail(400, 'A team has a name of 1 to 100 characters.');
  end if;
  insert into public.teams (name, created_by) values (btrim(p_name), me) returning id into made;
  insert into public.team_plans (team_id) values (made);
  insert into public.team_members (team_id, user_id, role) values (made, me, 'owner');
  perform private.audit(made, me, 'team.created', 'team', made::text, jsonb_build_object('name', btrim(p_name)));
  return jsonb_build_object('id', made);
end;
$$;
revoke execute on function public.create_team(text) from public;
grant execute on function public.create_team(text) to authenticated;

-- The teams the caller is in, with their role.
create function public.my_teams() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := private.uid();
begin
  return coalesce(
    (
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'myRole', m.role) order by t.created_at, t.id)
      from public.team_members m
      join public.teams t on t.id = m.team_id
      where m.user_id = me
    ),
    '[]'::jsonb
  );
end;
$$;
revoke execute on function public.my_teams() from public;
grant execute on function public.my_teams() to authenticated;

-- Makes an invite and returns its code once; only the hash is kept.
create function public.create_invite(
  p_team uuid,
  p_role text default 'member',
  p_approval_required boolean default false,
  p_max_uses integer default 1,
  p_days integer default 7,
  p_department uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teams');
  code text := 'inv_' || encode(extensions.gen_random_bytes(18), 'hex');
  made uuid;
begin
  if not private.can('invites.manage', p_team) then
    perform private.fail(403, 'You may not make invites for this team.');
  end if;
  if p_role not in ('admin', 'manager', 'member', 'viewer') then
    perform private.fail(400, 'An invite is for the role admin, manager, member or viewer.');
  end if;
  if p_max_uses < 1 or p_max_uses > 1000 or p_days < 1 or p_days > 90 then
    perform private.fail(400, 'An invite has 1 to 1000 uses and lasts 1 to 90 days.');
  end if;
  if p_department is not null
     and not exists (select 1 from public.departments where id = p_department and team_id = p_team) then
    perform private.fail(400, 'That department is not in this team.');
  end if;
  insert into public.invites (team_id, code_hash, role, department_id, created_by, expires_at, max_uses, approval_required)
  values (p_team, extensions.digest(code, 'sha256'), p_role, p_department, me,
          now() + make_interval(days => p_days), p_max_uses, p_approval_required)
  returning id into made;
  perform private.audit(p_team, me, 'invite.created', 'invite', made::text,
                        jsonb_build_object('role', p_role, 'approvalRequired', p_approval_required));
  return jsonb_build_object('id', made, 'code', code);
end;
$$;
revoke execute on function public.create_invite(uuid, text, boolean, integer, integer, uuid) from public;
grant execute on function public.create_invite(uuid, text, boolean, integer, integer, uuid) to authenticated;

-- Whether a code is good, before an account is made for it. Answers with the team's name only.
create function public.check_invite(p_code text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  team_name text;
begin
  select t.name into team_name
  from public.invites i join public.teams t on t.id = i.team_id
  where i.code_hash = extensions.digest(coalesce(p_code, ''), 'sha256')
    and i.revoked_at is null and i.expires_at > now() and i.uses < i.max_uses;
  if team_name is null then
    perform private.fail(404, 'That invite is not valid, or it has expired.');
  end if;
  return jsonb_build_object('teamName', team_name);
end;
$$;
revoke execute on function public.check_invite(text) from public;
grant execute on function public.check_invite(text) to anon, authenticated;

-- Uses an invite as the caller: a member at once, or a request that waits for an admin.
create function public.redeem_invite(p_code text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.uid();
  inv public.invites;
  team_name text;
begin
  select * into inv from public.invites
  where code_hash = extensions.digest(coalesce(p_code, ''), 'sha256')
  for update;
  if not found or inv.revoked_at is not null or inv.expires_at <= now() or inv.uses >= inv.max_uses then
    perform private.fail(404, 'That invite is not valid, or it has expired.');
  end if;
  select name into team_name from public.teams where id = inv.team_id;

  if exists (select 1 from public.team_members where team_id = inv.team_id and user_id = me) then
    return jsonb_build_object('status', 'joined', 'teamName', team_name);
  end if;

  update public.invites set uses = uses + 1 where id = inv.id;
  if inv.approval_required then
    if not exists (
      select 1 from public.join_requests
      where team_id = inv.team_id and user_id = me and status = 'pending'
    ) then
      insert into public.join_requests (team_id, invite_id, user_id, role, department_id)
      values (inv.team_id, inv.id, me, inv.role, inv.department_id);
    end if;
    perform private.audit(inv.team_id, me, 'join.requested', 'invite', inv.id::text, '{}'::jsonb);
    return jsonb_build_object('status', 'pending', 'teamName', team_name);
  end if;

  insert into public.team_members (team_id, user_id, role, department_id)
  values (inv.team_id, me, inv.role, inv.department_id);
  perform private.audit(inv.team_id, me, 'member.joined', 'invite', inv.id::text,
                        jsonb_build_object('role', inv.role));
  return jsonb_build_object('status', 'joined', 'teamName', team_name);
end;
$$;
revoke execute on function public.redeem_invite(text) from public;
grant execute on function public.redeem_invite(text) to authenticated;

-- Walks a team's chain and says whether it holds (TM-12). The backend owner's.
create function public.verify_audit_chain(p_team uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.audit_events;
  expected_prev text := repeat('0', 64);
  expected_seq bigint := 1;
  total bigint := 0;
begin
  perform private.uid();
  if not private.can('audit.view', p_team) then
    perform private.fail(403, 'Only the owner of this server can check the audit log.');
  end if;
  for r in select * from public.audit_events where team_id = p_team order by seq loop
    if r.seq <> expected_seq
       or r.prev_hash <> expected_prev
       or r.hash <> private.audit_hash(r.prev_hash, r.seq, r.ts, r.actor_id, r.action, r.target_type, r.target_id, r.detail)
    then
      return jsonb_build_object('ok', false, 'count', total, 'brokenAt', r.seq);
    end if;
    expected_prev := r.hash;
    expected_seq := expected_seq + 1;
    total := total + 1;
  end loop;
  return jsonb_build_object('ok', true, 'count', total);
end;
$$;
revoke execute on function public.verify_audit_chain(uuid) from public;
grant execute on function public.verify_audit_chain(uuid) to authenticated;

-- Helpers the read policies call.
grant execute on function private.is_member(uuid), private.is_server_owner(), private.role_in_team(uuid),
  private.department_of(uuid), private.can(text, uuid, uuid), private.plan_allows(uuid, text)
  to authenticated;
