-- Tests for the shared-exports bucket and its policies (migration 0006, SW-07).
--
-- Run it like rls.sql, against a database where Storage is installed (a hosted project, or a local
-- stack with the storage service). It ends by raising "ALL TESTS PASSED", which undoes everything.

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

grant execute on all functions in schema t to authenticated;

do $$
declare
  ada uuid := '00000000-0000-4000-8000-0000000000a1';  -- the owner
  vic uuid := '00000000-0000-4000-8000-0000000000b1';  -- viewer
  mia uuid := '00000000-0000-4000-8000-0000000000c1';  -- member
  moe uuid := '00000000-0000-4000-8000-0000000000d1';  -- member, in another team only
  team uuid;
  other uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role) values
    (ada, 'ada@example.com', '{"name": "Ada"}', 'authenticated', 'authenticated'),
    (vic, 'vic@example.com', '{"name": "Vic"}', 'authenticated', 'authenticated'),
    (mia, 'mia@example.com', '{"name": "Mia"}', 'authenticated', 'authenticated'),
    (moe, 'moe@example.com', '{"name": "Moe"}', 'authenticated', 'authenticated');
  perform t.as_user(ada);
  perform public.claim_owner();
  team := (public.create_team('Acme') ->> 'id')::uuid;
  other := (public.create_team('Other') ->> 'id')::uuid;
  perform public.add_member(team, 'vic@example.com', 'viewer');
  perform public.add_member(team, 'mia@example.com', 'member');
  perform public.add_member(other, 'moe@example.com', 'member');
  reset role;

  -- The bucket: private, with document types only.
  perform t.check((select not public from storage.buckets where id = 'shared-exports'), 'the bucket is private');
  perform t.check(
    not exists (
      select 1 from storage.buckets b, unnest(b.allowed_mime_types) m
      where b.id = 'shared-exports' and (m like 'audio/%' or m like 'video/%')
    ),
    'the bucket takes no audio or video type');
  perform t.check((select file_size_limit from storage.buckets where id = 'shared-exports') <= 52428800, 'the bucket has a size limit');

  -- Upload: a member may, in their team's folder.
  perform t.as_user(mia);
  perform t.expect(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('shared-exports', '%s/notes.md', '%s')$q$, team, mia), null, 'a member uploads to their team');
  perform t.expect(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('shared-exports', '%s/notes.md', '%s')$q$, other, mia), '42501', 'a member cannot upload to another team');
  perform t.expect($q$insert into storage.objects (bucket_id, name, owner_id) values ('shared-exports', 'not-a-team/notes.md', 'x')$q$, '42501', 'a folder that is not a team is refused');
  perform t.expect(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('shared-exports', '%s/call.wav', '%s')$q$, team, mia), '42501', 'an audio file is refused');
  perform t.expect(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('shared-exports', '%s/CALL.MP3', '%s')$q$, team, mia), '42501', 'an audio file in capitals is refused');
  perform t.expect(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('shared-exports', '%s/clip.mov', '%s')$q$, team, mia), '42501', 'a video file is refused');
  perform t.expect(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('shared-exports', '%s/summary.pdf', '%s')$q$, team, mia), null, 'a document is taken');
  perform t.as_user(vic);
  perform t.expect(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('shared-exports', '%s/v.md', '%s')$q$, team, vic), '42501', 'a viewer cannot upload');

  -- Read: the team's members see the team's files, nobody else.
  perform t.check((select count(*) from storage.objects where bucket_id = 'shared-exports') = 2, 'a viewer reads the team''s files');
  perform t.as_user(moe);
  perform t.check((select count(*) from storage.objects where bucket_id = 'shared-exports') = 0, 'a person in another team reads none');

  -- Delete: the uploader, or an admin; not another member. (Storage refuses a direct delete
  -- unless it is told the query is deliberate.)
  perform set_config('storage.allow_delete_query', 'true', true);
  perform t.as_user(vic);
  delete from storage.objects where bucket_id = 'shared-exports';
  reset role;
  perform t.check((select count(*) from storage.objects where bucket_id = 'shared-exports') = 2, 'a viewer deletes nothing');
  perform t.as_user(mia);
  delete from storage.objects where bucket_id = 'shared-exports' and name like '%/notes.md';
  reset role;
  perform t.check((select count(*) from storage.objects where bucket_id = 'shared-exports') = 1, 'the uploader deletes their file');
  perform t.as_user(ada);
  delete from storage.objects where bucket_id = 'shared-exports';
  reset role;
  perform t.check((select count(*) from storage.objects where bucket_id = 'shared-exports') = 0, 'an admin deletes any file in the team');

  -- The plan: a team on Free has no shared exports.
  perform t.as_user(ada);
  perform public.set_team_plan(team, 'free');
  perform t.as_user(mia);
  perform t.expect(format($q$insert into storage.objects (bucket_id, name, owner_id) values ('shared-exports', '%s/free.md', '%s')$q$, team, mia), '42501', 'Free has no shared exports');

  raise exception 'ALL TESTS PASSED';
end $$;
