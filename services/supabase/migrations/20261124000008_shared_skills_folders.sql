-- 0008 shared Skills and shared folders (NT-16, NT-17, SW-02).
--
-- The same rules as the local server's, written again in SQL (ADR-0099): an admin (a manager, for
-- their own department) publishes a Skill; members read it; each change is a new version. A folder
-- is `shared` (named people), `department` or `company`, and holds copies of notes a person chose
-- to share, as text and never audio. Row-level security on every table, reads through select
-- policies, writes only through the functions below.

-- ---------------------------------------------------------------------------------------------
-- Tables

create table public.team_skills (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  name          text not null check (btrim(name) <> '' and char_length(name) <= 100),
  description   text not null default '' check (char_length(description) <= 500),
  body          text not null check (btrim(body) <> '' and octet_length(body) <= 20000),
  scope         text not null check (scope in ('company', 'department')),
  department_id uuid references public.departments (id) on delete cascade,
  version       integer not null default 1,
  status        text not null default 'active' check (status in ('active', 'deleted')),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((scope = 'company') = (department_id is null))
);
create unique index team_skills_name on public.team_skills
  (team_id, scope, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
  where status = 'active';
alter table public.team_skills enable row level security;

create table public.team_skill_versions (
  id         bigint generated always as identity primary key,
  skill_id   uuid not null references public.team_skills (id) on delete cascade,
  version    integer not null,
  name       text not null,
  body       text not null,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index team_skill_versions_skill on public.team_skill_versions (skill_id, version);
alter table public.team_skill_versions enable row level security;

create table public.shared_folders (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams (id) on delete cascade,
  name          text not null check (btrim(name) <> '' and char_length(name) <= 100),
  kind          text not null check (kind in ('shared', 'department', 'company')),
  department_id uuid references public.departments (id) on delete cascade,
  status        text not null default 'active' check (status in ('active', 'deleted')),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  check ((kind = 'department') = (department_id is not null))
);
create index shared_folders_team on public.shared_folders (team_id, status);
alter table public.shared_folders enable row level security;

-- Who is in a "shared" folder, and whether they may add to it. Department and company folders
-- follow the department and the team, so they have no rows here.
create table public.folder_members (
  folder_id uuid not null references public.shared_folders (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  can_write boolean not null default true,
  added_by  uuid references public.profiles (id) on delete set null,
  added_at  timestamptz not null default now(),
  primary key (folder_id, user_id)
);
alter table public.folder_members enable row level security;

-- What a person chose to share into a folder: a copy of the notes as text, never audio. There is
-- no column that could hold a file.
create table public.folder_items (
  id         uuid primary key default gen_random_uuid(),
  folder_id  uuid not null references public.shared_folders (id) on delete cascade,
  title      text not null check (btrim(title) <> '' and char_length(title) <= 200),
  body_md    text not null check (btrim(body_md) <> '' and octet_length(body_md) <= 60000),
  source_ref text not null default '' check (char_length(source_ref) <= 200),
  shared_by  uuid references public.profiles (id) on delete set null,
  shared_at  timestamptz not null default now()
);
create index folder_items_folder on public.folder_items (folder_id, shared_at);
alter table public.folder_items enable row level security;

-- Goes up whenever Skills or folders change, so a client can ask "anything new since?".
alter table public.team_revisions add column content_revision integer not null default 0;

-- ---------------------------------------------------------------------------------------------
-- Helpers (private)

create function private.is_team_admin(p_team uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.role_in_team(p_team) in ('owner', 'admin'), false) or private.is_server_owner();
$$;

create function private.bump_content(p_team uuid) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.team_revisions (team_id, content_revision) values (p_team, 1)
  on conflict (team_id) do update set content_revision = public.team_revisions.content_revision + 1;
$$;

create function private.skill_visible(p_team uuid, p_scope text, p_department uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.is_member(p_team) or private.is_server_owner())
    and (private.is_team_admin(p_team) or p_scope = 'company' or p_department = private.department_of(p_team));
$$;

-- Whether the caller may publish a Skill where it would go (an admin anywhere, a manager in
-- their own department).
create function private.may_publish(p_team uuid, p_scope text, p_department uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_team_admin(p_team)
    or (private.role_in_team(p_team) = 'manager' and p_scope = 'department'
        and p_department is not null and p_department = private.department_of(p_team));
$$;

create function private.folder_visible(p_folder uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shared_folders f
    where f.id = p_folder and f.status = 'active'
      and (
        private.is_team_admin(f.team_id)
        or (
          private.is_member(f.team_id)
          and (
            f.kind = 'company'
            or (f.kind = 'department' and f.department_id = private.department_of(f.team_id))
            or (f.kind = 'shared' and exists (
              select 1 from public.folder_members m
              where m.folder_id = f.id and m.user_id = (select auth.uid())
            ))
          )
        )
      )
  );
$$;

create function private.folder_writable(p_folder uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.folder_visible(p_folder)
    and exists (
      select 1 from public.shared_folders f
      where f.id = p_folder
        and private.role_in_team(f.team_id) is distinct from 'viewer'
        and (
          f.kind <> 'shared'
          or private.is_team_admin(f.team_id)
          or coalesce((select m.can_write from public.folder_members m
                       where m.folder_id = f.id and m.user_id = (select auth.uid())), false)
        )
    );
$$;

create function private.folder_manageable(p_folder uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shared_folders f
    where f.id = p_folder
      and (
        private.is_team_admin(f.team_id)
        or f.created_by = (select auth.uid())
        or (f.kind = 'department' and private.role_in_team(f.team_id) = 'manager'
            and f.department_id = private.department_of(f.team_id))
      )
  );
$$;

create function private.skill_json(s public.team_skills) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', s.id, 'name', s.name, 'description', s.description, 'body', s.body,
    'scope', s.scope, 'departmentId', s.department_id, 'version', s.version,
    'updatedAt', (extract(epoch from s.updated_at) * 1000)::bigint
  );
$$;

create function private.folder_json(f public.shared_folders) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', f.id, 'name', f.name, 'kind', f.kind, 'departmentId', f.department_id,
    'createdBy', f.created_by, 'mine', f.created_by = (select auth.uid()),
    'canWrite', private.folder_writable(f.id), 'canManage', private.folder_manageable(f.id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('userId', m.user_id, 'name', p.name, 'canWrite', m.can_write) order by p.name, m.user_id)
      from public.folder_members m join public.profiles p on p.id = m.user_id
      where m.folder_id = f.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'title', i.title, 'sharedBy', coalesce(p.name, ''),
        'sharedAt', (extract(epoch from i.shared_at) * 1000)::bigint, 'sourceRef', i.source_ref
      ) order by i.shared_at desc, i.id)
      from public.folder_items i left join public.profiles p on p.id = i.shared_by
      where i.folder_id = f.id
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------------------------
-- Read policies

create policy team_skills_read on public.team_skills for select to authenticated
  using (status = 'active' and private.skill_visible(team_id, scope, department_id));

create policy team_skill_versions_read on public.team_skill_versions for select to authenticated
  using (
    exists (
      select 1 from public.team_skills s
      where s.id = team_skill_versions.skill_id and s.status = 'active'
        and private.skill_visible(s.team_id, s.scope, s.department_id)
    )
  );

create policy shared_folders_read on public.shared_folders for select to authenticated
  using (private.folder_visible(id));

create policy folder_members_read on public.folder_members for select to authenticated
  using (private.folder_visible(folder_id));

create policy folder_items_read on public.folder_items for select to authenticated
  using (private.folder_visible(folder_id));

grant select on public.team_skills, public.team_skill_versions, public.shared_folders,
  public.folder_members, public.folder_items to authenticated;

grant execute on function private.is_team_admin(uuid), private.skill_visible(uuid, text, uuid),
  private.folder_visible(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Functions a client calls

-- Everything a client keeps in step with: the Skills and folders this person can see, with a
-- revision (or `unchanged`). A note's text is read one at a time with `read_folder_item`.
create function public.team_content(p_team uuid, p_since integer default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  rev integer;
begin
  if not private.can('skills.view', p_team) then
    perform private.fail(403, 'You may not see this team''s Skills.');
  end if;
  select coalesce(content_revision, 0) into rev from public.team_revisions where team_id = p_team;
  rev := coalesce(rev, 0);
  if p_since is not null and p_since = rev then
    return jsonb_build_object('revision', rev, 'unchanged', true);
  end if;
  return jsonb_build_object(
    'revision', rev,
    'unchanged', false,
    'skills', coalesce((
      select jsonb_agg(private.skill_json(s) order by lower(s.name), s.id)
      from public.team_skills s
      where s.team_id = p_team and s.status = 'active'
        and private.skill_visible(s.team_id, s.scope, s.department_id)
    ), '[]'::jsonb),
    'folders', coalesce((
      select jsonb_agg(private.folder_json(f) order by lower(f.name), f.id)
      from public.shared_folders f
      where f.team_id = p_team and f.status = 'active' and private.folder_visible(f.id)
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.team_content(uuid, integer) from public;
grant execute on function public.team_content(uuid, integer) to authenticated;

create function public.publish_skill(
  p_team uuid, p_name text, p_description text, p_body text,
  p_scope text default 'company', p_department uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  dept uuid;
  made public.team_skills;
begin
  if p_scope not in ('company', 'department') then
    perform private.fail(400, 'The scope is company or department.');
  end if;
  dept := case when p_scope = 'department' then coalesce(p_department, private.department_of(p_team)) end;
  if p_scope = 'department' and dept is null then
    perform private.fail(400, 'Choose a department, or publish to the whole team.');
  end if;
  if dept is not null and not exists (select 1 from public.departments where id = dept and team_id = p_team) then
    perform private.fail(400, 'That department is not in this team.');
  end if;
  if not private.may_publish(p_team, p_scope, dept) then
    perform private.fail(403, 'You can publish only to your own department.');
  end if;
  if p_name is null or btrim(p_name) = '' or char_length(btrim(p_name)) > 100 then
    perform private.fail(400, 'A Skill has a name of 1 to 100 characters.');
  end if;
  if char_length(coalesce(p_description, '')) > 500 then
    perform private.fail(400, 'That description is too long.');
  end if;
  if p_body is null or btrim(p_body) = '' then
    perform private.fail(400, 'A Skill needs its prompt.');
  end if;
  if octet_length(p_body) > 20000 then
    perform private.fail(400, 'That Skill is too long.');
  end if;
  if exists (
    select 1 from public.policy_values
    where team_id = p_team and key = 'features.notetaker' and value = 'false'::jsonb
      and (scope = 'team' or (scope = 'department' and scope_id = private.department_of(p_team)::text)
           or (scope = 'member' and scope_id = me::text))
  ) then
    perform private.fail(403, 'This team''s policy turns Notetaker off, so a Skill cannot be published.');
  end if;
  if exists (
    select 1 from public.team_skills
    where team_id = p_team and scope = p_scope and department_id is not distinct from dept
      and lower(name) = lower(btrim(p_name)) and status = 'active'
  ) then
    perform private.fail(409, 'A Skill with that name is already published here.');
  end if;
  insert into public.team_skills (team_id, name, description, body, scope, department_id, created_by)
  values (p_team, btrim(p_name), btrim(coalesce(p_description, '')), p_body, p_scope, dept, me)
  returning * into made;
  insert into public.team_skill_versions (skill_id, version, name, body, changed_by)
  values (made.id, 1, made.name, made.body, me);
  perform private.bump_content(p_team);
  perform private.audit(p_team, me, 'skill.published', 'shared_content', made.id::text,
                        jsonb_build_object('scope', p_scope, 'version', 1));
  return jsonb_build_object('skill', private.skill_json(made));
end;
$$;
revoke execute on function public.publish_skill(uuid, text, text, text, text, uuid) from public;
grant execute on function public.publish_skill(uuid, text, text, text, text, uuid) to authenticated;

-- A changed Skill is a new version; a null leaves a field as it is.
create function public.update_skill(
  p_team uuid, p_skill uuid, p_name text default null, p_description text default null, p_body text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  r public.team_skills;
  new_name text;
  new_description text;
  new_body text;
begin
  select * into r from public.team_skills where id = p_skill and team_id = p_team and status = 'active' for update;
  if not found or not private.skill_visible(r.team_id, r.scope, r.department_id) then
    perform private.fail(404, 'There is no such Skill.');
  end if;
  if not private.may_publish(p_team, r.scope, r.department_id) then
    perform private.fail(403, 'Only an admin, or the department''s manager, changes this Skill.');
  end if;
  new_name := btrim(coalesce(p_name, r.name));
  new_description := btrim(coalesce(p_description, r.description));
  new_body := coalesce(p_body, r.body);
  if new_name = '' or char_length(new_name) > 100 then
    perform private.fail(400, 'A Skill has a name of 1 to 100 characters.');
  end if;
  if char_length(new_description) > 500 then
    perform private.fail(400, 'That description is too long.');
  end if;
  if btrim(new_body) = '' then
    perform private.fail(400, 'A Skill needs its prompt.');
  end if;
  if octet_length(new_body) > 20000 then
    perform private.fail(400, 'That Skill is too long.');
  end if;
  if new_name = r.name and new_description = r.description and new_body = r.body then
    return jsonb_build_object('skill', private.skill_json(r), 'changed', false);
  end if;
  if exists (
    select 1 from public.team_skills
    where team_id = p_team and scope = r.scope and department_id is not distinct from r.department_id
      and lower(name) = lower(new_name) and status = 'active' and id <> r.id
  ) then
    perform private.fail(409, 'A Skill with that name is already published here.');
  end if;
  update public.team_skills
    set name = new_name, description = new_description, body = new_body,
        version = r.version + 1, updated_at = now()
    where id = r.id
    returning * into r;
  insert into public.team_skill_versions (skill_id, version, name, body, changed_by)
  values (r.id, r.version, r.name, r.body, me);
  perform private.bump_content(p_team);
  perform private.audit(p_team, me, 'skill.updated', 'shared_content', r.id::text,
                        jsonb_build_object('scope', r.scope, 'version', r.version));
  return jsonb_build_object('skill', private.skill_json(r), 'changed', true);
end;
$$;
revoke execute on function public.update_skill(uuid, uuid, text, text, text) from public;
grant execute on function public.update_skill(uuid, uuid, text, text, text) to authenticated;

create function public.remove_skill(p_team uuid, p_skill uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  r public.team_skills;
begin
  select * into r from public.team_skills where id = p_skill and team_id = p_team and status = 'active' for update;
  if not found or not private.skill_visible(r.team_id, r.scope, r.department_id) then
    perform private.fail(404, 'There is no such Skill.');
  end if;
  if not private.may_publish(p_team, r.scope, r.department_id) then
    perform private.fail(403, 'Only an admin, or the department''s manager, removes this Skill.');
  end if;
  update public.team_skills set status = 'deleted', updated_at = now() where id = r.id;
  perform private.bump_content(p_team);
  perform private.audit(p_team, me, 'skill.removed', 'shared_content', r.id::text, jsonb_build_object('scope', r.scope));
  return jsonb_build_object('removed', true);
end;
$$;
revoke execute on function public.remove_skill(uuid, uuid) from public;
grant execute on function public.remove_skill(uuid, uuid) to authenticated;

create function public.skill_versions(p_team uuid, p_skill uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  r public.team_skills;
begin
  select * into r from public.team_skills where id = p_skill and team_id = p_team and status = 'active';
  if not found or not private.skill_visible(r.team_id, r.scope, r.department_id) then
    perform private.fail(404, 'There is no such Skill.');
  end if;
  return jsonb_build_object('versions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'version', v.version, 'name', v.name, 'body', v.body,
      'changedAt', (extract(epoch from v.changed_at) * 1000)::bigint,
      'changedBy', coalesce(p.name, '')
    ) order by v.version desc)
    from public.team_skill_versions v left join public.profiles p on p.id = v.changed_by
    where v.skill_id = r.id
  ), '[]'::jsonb));
end;
$$;
revoke execute on function public.skill_versions(uuid, uuid) from public;
grant execute on function public.skill_versions(uuid, uuid) to authenticated;

create function public.create_folder(
  p_team uuid, p_name text, p_kind text, p_department uuid default null, p_members uuid[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  dept uuid;
  made public.shared_folders;
  person uuid;
begin
  if not private.can('folders.contribute', p_team) then
    perform private.fail(403, 'You may not make folders in this team.');
  end if;
  if p_kind not in ('shared', 'department', 'company') then
    perform private.fail(400, 'A folder is shared, department or company.');
  end if;
  if p_name is null or btrim(p_name) = '' or char_length(btrim(p_name)) > 100 then
    perform private.fail(400, 'A folder has a name of 1 to 100 characters.');
  end if;
  if p_kind = 'department' then
    dept := coalesce(p_department, private.department_of(p_team));
    if dept is null then
      perform private.fail(400, 'Choose the department the folder is for.');
    end if;
    if not exists (select 1 from public.departments where id = dept and team_id = p_team) then
      perform private.fail(400, 'That department is not in this team.');
    end if;
    if not private.is_team_admin(p_team)
       and not (private.role_in_team(p_team) = 'manager' and dept = private.department_of(p_team)) then
      perform private.fail(403, 'Only an admin, or the department''s manager, makes a department folder.');
    end if;
  end if;
  if p_kind = 'company' and not private.is_team_admin(p_team) then
    perform private.fail(403, 'Only an admin makes a folder for the whole company.');
  end if;
  if p_kind <> 'shared' and coalesce(array_length(p_members, 1), 0) > 0 then
    perform private.fail(400, 'Only a shared folder has named people.');
  end if;
  if coalesce(array_length(p_members, 1), 0) > 200 then
    perform private.fail(400, 'A folder has at most 200 people.');
  end if;
  foreach person in array coalesce(p_members, '{}') loop
    if not exists (select 1 from public.team_members where team_id = p_team and user_id = person) then
      perform private.fail(400, 'Everyone in a folder must be in this team.');
    end if;
  end loop;
  if exists (
    select 1 from public.shared_folders
    where team_id = p_team and kind = p_kind and department_id is not distinct from dept
      and lower(name) = lower(btrim(p_name)) and status = 'active'
  ) then
    perform private.fail(409, 'A folder with that name is already there.');
  end if;
  insert into public.shared_folders (team_id, name, kind, department_id, created_by)
  values (p_team, btrim(p_name), p_kind, dept, me) returning * into made;
  if p_kind = 'shared' then
    insert into public.folder_members (folder_id, user_id, can_write, added_by)
    select made.id, u, true, me from unnest(array_append(coalesce(p_members, '{}'), me)) as u
    on conflict do nothing;
  end if;
  perform private.bump_content(p_team);
  perform private.audit(p_team, me, 'folder.created', 'shared_content', made.id::text, jsonb_build_object('kind', p_kind));
  return jsonb_build_object('folder', private.folder_json(made));
end;
$$;
revoke execute on function public.create_folder(uuid, text, text, uuid, uuid[]) from public;
grant execute on function public.create_folder(uuid, text, text, uuid, uuid[]) to authenticated;

create function public.rename_folder(p_team uuid, p_folder uuid, p_name text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  f public.shared_folders;
begin
  select * into f from public.shared_folders where id = p_folder and team_id = p_team and status = 'active';
  if not found or not private.folder_visible(f.id) then
    perform private.fail(404, 'There is no such folder.');
  end if;
  if not private.folder_manageable(f.id) then
    perform private.fail(403, 'You cannot change this folder.');
  end if;
  if p_name is null or btrim(p_name) = '' or char_length(btrim(p_name)) > 100 then
    perform private.fail(400, 'A folder has a name of 1 to 100 characters.');
  end if;
  update public.shared_folders set name = btrim(p_name) where id = f.id returning * into f;
  perform private.bump_content(p_team);
  perform private.audit(p_team, me, 'folder.renamed', 'shared_content', f.id::text, jsonb_build_object('kind', f.kind));
  return jsonb_build_object('folder', private.folder_json(f));
end;
$$;
revoke execute on function public.rename_folder(uuid, uuid, text) from public;
grant execute on function public.rename_folder(uuid, uuid, text) to authenticated;

-- The notes in a folder are removed with it: they were copies.
create function public.remove_folder(p_team uuid, p_folder uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  f public.shared_folders;
begin
  select * into f from public.shared_folders where id = p_folder and team_id = p_team and status = 'active';
  if not found or not private.folder_visible(f.id) then
    perform private.fail(404, 'There is no such folder.');
  end if;
  if not private.folder_manageable(f.id) then
    perform private.fail(403, 'You cannot remove this folder.');
  end if;
  update public.shared_folders set status = 'deleted' where id = f.id;
  delete from public.folder_items where folder_id = f.id;
  perform private.bump_content(p_team);
  perform private.audit(p_team, me, 'folder.removed', 'shared_content', f.id::text, jsonb_build_object('kind', f.kind));
  return jsonb_build_object('removed', true);
end;
$$;
revoke execute on function public.remove_folder(uuid, uuid) from public;
grant execute on function public.remove_folder(uuid, uuid) to authenticated;

create function public.set_folder_member(p_team uuid, p_folder uuid, p_user uuid, p_can_write boolean default true) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  f public.shared_folders;
begin
  select * into f from public.shared_folders where id = p_folder and team_id = p_team and status = 'active';
  if not found or not private.folder_visible(f.id) then
    perform private.fail(404, 'There is no such folder.');
  end if;
  if f.kind <> 'shared' then
    perform private.fail(400, 'A department or company folder follows the team; it has no named people.');
  end if;
  if not private.folder_manageable(f.id) then
    perform private.fail(403, 'You cannot change who is in this folder.');
  end if;
  if not exists (select 1 from public.team_members where team_id = p_team and user_id = p_user) then
    perform private.fail(400, 'That person is not in this team.');
  end if;
  if not exists (select 1 from public.folder_members where folder_id = f.id and user_id = p_user)
     and (select count(*) from public.folder_members where folder_id = f.id) >= 200 then
    perform private.fail(400, 'A folder has at most 200 people.');
  end if;
  insert into public.folder_members (folder_id, user_id, can_write, added_by) values (f.id, p_user, p_can_write, me)
  on conflict (folder_id, user_id) do update set can_write = excluded.can_write;
  perform private.bump_content(p_team);
  perform private.audit(p_team, me, 'folder.member_set', 'shared_content', f.id::text, jsonb_build_object('canWrite', p_can_write));
  return jsonb_build_object('folder', private.folder_json(f));
end;
$$;
revoke execute on function public.set_folder_member(uuid, uuid, uuid, boolean) from public;
grant execute on function public.set_folder_member(uuid, uuid, uuid, boolean) to authenticated;

create function public.remove_folder_member(p_team uuid, p_folder uuid, p_user uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  f public.shared_folders;
begin
  select * into f from public.shared_folders where id = p_folder and team_id = p_team and status = 'active';
  if not found or not private.folder_visible(f.id) then
    perform private.fail(404, 'There is no such folder.');
  end if;
  -- A person may leave; managing is for those who can.
  if not private.folder_manageable(f.id) and p_user <> me then
    perform private.fail(403, 'You cannot change who is in this folder.');
  end if;
  if not exists (select 1 from public.folder_members where folder_id = f.id and user_id = p_user) then
    perform private.fail(404, 'That person is not in this folder.');
  end if;
  delete from public.folder_members where folder_id = f.id and user_id = p_user;
  perform private.bump_content(p_team);
  perform private.audit(p_team, me, 'folder.member_removed', 'shared_content', f.id::text, '{}'::jsonb);
  return jsonb_build_object('removed', true);
end;
$$;
revoke execute on function public.remove_folder_member(uuid, uuid, uuid) from public;
grant execute on function public.remove_folder_member(uuid, uuid, uuid) to authenticated;

create function public.share_folder_item(p_team uuid, p_folder uuid, p_title text, p_body text, p_source_ref text default '') returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  f public.shared_folders;
  made uuid;
begin
  select * into f from public.shared_folders where id = p_folder and team_id = p_team and status = 'active';
  if not found or not private.folder_visible(f.id) then
    perform private.fail(404, 'There is no such folder.');
  end if;
  if not private.folder_writable(f.id) then
    perform private.fail(403, 'You cannot add to this folder.');
  end if;
  if p_title is null or btrim(p_title) = '' or char_length(btrim(p_title)) > 200 then
    perform private.fail(400, 'A shared note has a title of 1 to 200 characters.');
  end if;
  if p_body is null or btrim(p_body) = '' then
    perform private.fail(400, 'There is nothing to share.');
  end if;
  if octet_length(p_body) > 60000 then
    perform private.fail(400, 'That is too long to share (60 KB at most).');
  end if;
  insert into public.folder_items (folder_id, title, body_md, source_ref, shared_by)
  values (f.id, btrim(p_title), p_body, left(coalesce(p_source_ref, ''), 200), me)
  returning id into made;
  perform private.bump_content(p_team);
  perform private.audit(p_team, me, 'folder.item_shared', 'shared_content', made::text, jsonb_build_object('kind', f.kind));
  return jsonb_build_object('id', made);
end;
$$;
revoke execute on function public.share_folder_item(uuid, uuid, text, text, text) from public;
grant execute on function public.share_folder_item(uuid, uuid, text, text, text) to authenticated;

create function public.read_folder_item(p_team uuid, p_folder uuid, p_item uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  f public.shared_folders;
  r record;
begin
  select * into f from public.shared_folders where id = p_folder and team_id = p_team and status = 'active';
  if not found or not private.folder_visible(f.id) then
    perform private.fail(404, 'There is no such folder.');
  end if;
  select i.id, i.title, i.body_md, i.source_ref, i.shared_at, coalesce(p.name, '') as who into r
  from public.folder_items i left join public.profiles p on p.id = i.shared_by
  where i.id = p_item and i.folder_id = f.id;
  if not found then
    perform private.fail(404, 'There is no such note in this folder.');
  end if;
  return jsonb_build_object('item', jsonb_build_object(
    'id', r.id, 'title', r.title, 'body', r.body_md, 'sourceRef', r.source_ref,
    'sharedBy', r.who, 'sharedAt', (extract(epoch from r.shared_at) * 1000)::bigint
  ));
end;
$$;
revoke execute on function public.read_folder_item(uuid, uuid, uuid) from public;
grant execute on function public.read_folder_item(uuid, uuid, uuid) to authenticated;

create function public.remove_folder_item(p_team uuid, p_folder uuid, p_item uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  f public.shared_folders;
  owner_of uuid;
begin
  select * into f from public.shared_folders where id = p_folder and team_id = p_team and status = 'active';
  if not found or not private.folder_visible(f.id) then
    perform private.fail(404, 'There is no such folder.');
  end if;
  select shared_by into owner_of from public.folder_items where id = p_item and folder_id = f.id;
  if not found then
    perform private.fail(404, 'There is no such note in this folder.');
  end if;
  if owner_of is distinct from me and not private.folder_manageable(f.id) then
    perform private.fail(403, 'Only the person who shared it, or the folder''s managers, remove a note.');
  end if;
  delete from public.folder_items where id = p_item;
  perform private.bump_content(p_team);
  perform private.audit(p_team, me, 'folder.item_removed', 'shared_content', p_item::text, jsonb_build_object('kind', f.kind));
  return jsonb_build_object('removed', true);
end;
$$;
revoke execute on function public.remove_folder_item(uuid, uuid, uuid) from public;
grant execute on function public.remove_folder_item(uuid, uuid, uuid) to authenticated;
