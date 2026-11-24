-- 0010 a viewer is refused before a folder is looked at.
--
-- The local server checks the role first (the matrix's `folders.contribute`) and then the folder,
-- so a viewer who tries to change or add to a folder is told "forbidden" whether or not they can
-- see it. These five functions now do the same, so the contract holds on both backends.

create or replace function public.rename_folder(p_team uuid, p_folder uuid, p_name text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  f public.shared_folders;
begin
  if not private.can('folders.contribute', p_team) then
    perform private.fail(403, 'You may not change folders in this team.');
  end if;
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

create or replace function public.remove_folder(p_team uuid, p_folder uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  f public.shared_folders;
begin
  if not private.can('folders.contribute', p_team) then
    perform private.fail(403, 'You may not change folders in this team.');
  end if;
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

create or replace function public.set_folder_member(p_team uuid, p_folder uuid, p_user uuid, p_can_write boolean default true) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  f public.shared_folders;
begin
  if not private.can('folders.contribute', p_team) then
    perform private.fail(403, 'You may not change folders in this team.');
  end if;
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

create or replace function public.share_folder_item(p_team uuid, p_folder uuid, p_title text, p_body text, p_source_ref text default '') returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  f public.shared_folders;
  made uuid;
begin
  if not private.can('folders.contribute', p_team) then
    perform private.fail(403, 'You may not change folders in this team.');
  end if;
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

create or replace function public.remove_folder_item(p_team uuid, p_folder uuid, p_item uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teamVocabulary');
  f public.shared_folders;
  owner_of uuid;
begin
  if not private.can('folders.contribute', p_team) then
    perform private.fail(403, 'You may not change folders in this team.');
  end if;
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
