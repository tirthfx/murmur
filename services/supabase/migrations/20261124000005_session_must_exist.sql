-- 0005 a signed-out session stops working at once.
--
-- A Supabase access token is a signed JWT that stays valid until it expires, even after the
-- person signs out and their session is deleted. Every function calls `private.uid()` first, so
-- it checks here that the session named in the token (`session_id`) still exists. A token with no
-- session id (a test, a service call) is judged by its signature alone, as before.
--
-- Direct table reads through the select policies are not covered: they use `auth.uid()` and can
-- still read until the token expires, which is at most the project's access token lifetime.

create or replace function private.uid() returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  sid text := (select auth.jwt() ->> 'session_id');
begin
  if me is null then
    perform private.fail(401, 'Sign in to continue.');
  end if;
  if sid is not null and not exists (select 1 from auth.sessions where id = sid::uuid) then
    perform private.fail(401, 'Your session has ended. Sign in again.');
  end if;
  return me;
end;
$$;
