-- A signed-out session stops working at once (migration 0005).
--
-- Run it like rls.sql: against a database with the migrations applied. It ends by raising
-- "ALL TESTS PASSED", which undoes everything it did.

-- One transaction, so the final error undoes the helper schema and everything else, even in psql.
begin;

create schema t;
grant usage on schema t to anon, authenticated;

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
  ann uuid := '00000000-0000-4000-8000-0000000000aa';
  live uuid := '00000000-0000-4000-8000-0000000000bb';
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
    values (ann, 'ann@example.com', '{"name": "Ann"}', 'authenticated', 'authenticated');
  insert into auth.sessions (id, user_id) values (live, ann);

  -- A token whose session exists is accepted.
  perform set_config('request.jwt.claims',
    json_build_object('sub', ann, 'role', 'authenticated', 'session_id', live)::text, true);
  set local role authenticated;
  perform t.expect('select public.my_teams()', null, 'a live session is accepted');

  -- The session is deleted, as sign-out does: the same token is refused.
  reset role;
  delete from auth.sessions where id = live;
  perform set_config('request.jwt.claims',
    json_build_object('sub', ann, 'role', 'authenticated', 'session_id', live)::text, true);
  set local role authenticated;
  perform t.expect('select public.my_teams()', 'PT401', 'an ended session is refused');

  -- A token with no session id is judged by its signature alone.
  perform set_config('request.jwt.claims', json_build_object('sub', ann, 'role', 'authenticated')::text, true);
  perform t.expect('select public.my_teams()', null, 'a token with no session id is accepted');

  raise exception 'ALL TESTS PASSED';
end $$;
