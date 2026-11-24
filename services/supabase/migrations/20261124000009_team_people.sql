-- 0009 the people in a team, for choosing who is in a shared folder (NT-17).
--
-- A member already reads their team's member list and the profiles of the people in it through
-- the tables; this is the same answer in one call, with the same rules (a team member, a plan
-- with teams, the matrix's `members.list`).

create function public.team_people(p_team uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_team(p_team, 'teams');
begin
  if not private.can('members.list', p_team) then
    perform private.fail(403, 'You may not see who is in this team.');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('userId', m.user_id, 'name', p.name, 'email', p.email, 'role', m.role)
                     order by p.name, m.user_id)
    from public.team_members m join public.profiles p on p.id = m.user_id
    where m.team_id = p_team and p.status = 'active'
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.team_people(uuid) from public;
grant execute on function public.team_people(uuid) to authenticated;
