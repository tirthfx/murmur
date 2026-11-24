-- 0006 a private bucket for shared exports (SW-07).
--
-- Storage holds only shared exports (opt-in) and team attachments. Raw audio is never uploaded:
-- that is a rule, not a setting. Two controls keep it so. The bucket lists the document types it
-- takes (none of them audio or video), and the upload policy refuses a file name with an audio or
-- video extension whatever type it declares. Access is by signed URL; the app asks for ten
-- minutes.
--
-- A team's files live under a folder named for the team: `<team id>/<file>`.
--
-- Storage is installed by Supabase on a hosted project. Where it is not (a minimal local stack
-- without the storage service), this migration says so and does nothing, so the rest still applies.

create function private.export_team(p_name text) returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'Storage is not installed here: the shared-exports bucket is not made.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'shared-exports', 'shared-exports', false, 26214400,
    array[
      'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  )
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- Members read their team's folder.
  execute $p$
    create policy shared_exports_read on storage.objects for select to authenticated
    using (bucket_id = 'shared-exports' and private.is_member(private.export_team(name)))
  $p$;

  -- Members who may write upload to their team's folder, never a file that looks like audio or
  -- video, and only where the plan has teams.
  execute $p$
    create policy shared_exports_upload on storage.objects for insert to authenticated
    with check (
      bucket_id = 'shared-exports'
      and private.role_in_team(private.export_team(name)) in ('owner', 'admin', 'manager', 'member')
      and private.plan_allows(private.export_team(name), 'teams')
      and name !~* '\.(wav|wave|mp3|m4a|m4b|aac|flac|ogg|oga|opus|caf|aif|aiff|wma|amr|mp4|m4v|mov|webm|mkv|avi)$'
    )
  $p$;

  -- The uploader removes their own file; an admin removes any in the team.
  execute $p$
    create policy shared_exports_delete on storage.objects for delete to authenticated
    using (
      bucket_id = 'shared-exports'
      and (owner_id = (select auth.uid())::text or private.can('team.update', private.export_team(name)))
    )
  $p$;
end;
$$;

grant execute on function private.export_team(text) to authenticated;
