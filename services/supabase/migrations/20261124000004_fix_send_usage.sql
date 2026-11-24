-- 0004 fix: `send_usage` named a variable `metric`, which clashed with the column of the same
-- name in the `on conflict` list (found by tests/rls.sql). The variable is `v_metric` now.

create or replace function public.send_usage(p_team uuid, p_batch text, p_events jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'usageDashboards');
  today date := (now() at time zone 'utc')::date;
  ev jsonb;
  d date;
  v_metric text;
  n numeric;
  grp text;
  b text;
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

  -- A batch id seen before is counted once.
  insert into public.usage_batches (team_id, user_id, batch_id) values (p_team, me, p_batch)
  on conflict do nothing;
  get diagnostics accepted = row_count;
  if accepted = 0 then
    return jsonb_build_object('accepted', 0, 'duplicate', true);
  end if;

  accepted := 0;
  for ev in select * from jsonb_array_elements(p_events) loop
    n := (ev ->> 'count')::numeric;
    continue when n = 0;
    v_metric := ev ->> 'metric';
    b := '';
    if v_metric in ('words', 'dictations') then
      grp := lower(coalesce(ev ->> 'bucket', 'other'));
      b := case when grp in ('mail', 'browser', 'chat', 'documents', 'code', 'notes', 'other') then grp else 'other' end;
    end if;
    insert into public.usage_daily as u (team_id, user_id, day, metric, bucket, count)
    values (p_team, me, (ev ->> 'day')::date, v_metric, b, n::bigint)
    on conflict (team_id, user_id, day, metric, bucket)
      do update set count = u.count + excluded.count;
    accepted := accepted + 1;
  end loop;
  return jsonb_build_object('accepted', accepted, 'duplicate', false);
end;
$$;
