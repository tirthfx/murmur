import { ACTIONS, allows, type ActionName, type Role } from "../../local-server/src/permissions.ts";

/**
 * Writes `tests/matrix.sql`: the whole permission matrix run against the database (SW-04). It
 * acts as each kind of person and checks every action for every department, how many rows each
 * reads from every table, and that no client writes any table. What an action should answer comes
 * from the local server's own rules, so the two backends cannot drift. `schema.test.ts` fails
 * when the file is out of date or a table is missing from `VISIBLE`.
 */

interface Person {
  key: string;
  /** The role in the first team; null for someone who is not in it. */
  role: Role | null;
  department: "sales" | "support" | null;
  isServerOwner?: boolean;
}

const PEOPLE: readonly Person[] = [
  { key: "owner", role: "owner", department: null, isServerOwner: true },
  { key: "adm", role: "admin", department: null },
  { key: "man", role: "manager", department: "sales" },
  { key: "sam", role: "member", department: "sales" },
  { key: "mem", role: "member", department: "support" },
  { key: "vic", role: "viewer", department: null },
  // In the second team only.
  { key: "zed", role: null, department: null },
];

const DEPARTMENTS = [null, "sales", "support"] as const;

/**
 * Rows of the first team each person reads, in the order of `PEOPLE`. `all` means every row of a
 * table that is not a team's; `denied` means the table cannot be selected at all.
 */
export const VISIBLE: Readonly<Record<string, readonly number[] | "all" | "denied">> = {
  //                      owner adm man sam mem vic zed
  profiles: [6, 6, 6, 6, 6, 6, 0],
  role_permissions: "all",
  plan_features: "all",
  teams: [1, 1, 1, 1, 1, 1, 0],
  team_plans: [1, 1, 1, 1, 1, 1, 0],
  departments: [2, 2, 2, 2, 2, 2, 0],
  team_members: [6, 6, 6, 6, 6, 6, 0],
  invites: [1, 1, 0, 0, 0, 0, 0],
  // Zed asked to join the first team, so sees that request.
  join_requests: [1, 1, 0, 0, 0, 0, 1],
  // `audit.view` is the backend owner's.
  audit_events: [1, 0, 0, 0, 0, 0, 0],
  team_settings: [1, 1, 1, 1, 1, 1, 0],
  team_revisions: [1, 1, 1, 1, 1, 1, 0],
  // A company entry, a Sales entry and Sam's waiting proposal.
  vocabulary_items: [3, 3, 2, 3, 1, 1, 0],
  // History is for reviewers: a manager reads their department's.
  vocabulary_versions: [3, 3, 1, 0, 0, 0, 0],
  vocabulary_notices: [0, 0, 0, 1, 0, 0, 0],
  // One value each for the team, Sales and Sam.
  policy_values: [3, 3, 2, 3, 1, 1, 0],
  // Counts of Sam (Sales) and Mem (Support).
  usage_daily: [2, 2, 1, 1, 1, 0, 0],
  usage_batches: "denied",
  // A company Skill, a Sales Skill and a removed one.
  team_skills: [2, 2, 2, 2, 1, 1, 0],
  team_skill_versions: [2, 2, 2, 2, 1, 1, 0],
  // A company folder, a Sales folder, one shared with Mem, and a removed one.
  shared_folders: [3, 3, 2, 2, 2, 1, 0],
  folder_members: [1, 1, 0, 0, 1, 0, 0],
  folder_items: [3, 3, 2, 2, 2, 1, 0],
};

/**
 * Actions where a server owner who is not in a team gets less from the database than from the
 * local server: the database gives them what an admin has. No database function does these, and
 * a migration that adds one must change `private.can`.
 */
export const OWNER_ELSEWHERE_GAPS: readonly ActionName[] = ["team.delete"];

/** What the local server answers for a person asking about a department of a team. */
function expected(action: ActionName, person: Person, department: string | null): boolean {
  const rule = ACTIONS[action];
  const who = { role: person.role, isServerOwner: person.isServerOwner ?? false };
  if (!allows(action, who)) return false;
  // The router lets a department-scoped role through; the service then compares departments.
  if (rule.scope === "team" && !who.isServerOwner && rule.departmentScoped?.includes(who.role!)) {
    return department !== null && department === person.department;
  }
  return true;
}

const id = (prefix: string, n: number) =>
  `'${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}'`;
const user = (key: string) => id("00000000", PEOPLE.findIndex((p) => p.key === key) + 0xa1);
const TEAM = id("10000000", 1);
const OTHER = id("10000000", 2);
const DEPARTMENT = { sales: id("20000000", 1), support: id("20000000", 2) };
const ITEM = (n: number) => id("30000000", n);
const SKILL = (n: number) => id("40000000", n);
const FOLDER = (n: number) => id("50000000", n);

/** The condition that keeps a count to the first team's rows. */
function teamRows(table: string): string {
  const members = PEOPLE.filter((p) => p.role !== null)
    .map((p) => user(p.key))
    .join(", ");
  switch (table) {
    case "profiles":
      return `id in (${members})`;
    case "teams":
      return `id = ${TEAM}`;
    case "vocabulary_versions":
      return `item_id in (${ITEM(1)}, ${ITEM(2)}, ${ITEM(3)})`;
    case "team_skill_versions":
      return `skill_id in (${SKILL(1)}, ${SKILL(2)}, ${SKILL(3)})`;
    case "folder_members":
    case "folder_items":
      return `folder_id in (${[1, 2, 3, 4].map(FOLDER).join(", ")})`;
    default:
      return `team_id = ${TEAM}`;
  }
}

function seed(): string {
  const accounts = PEOPLE.map(
    (p) => `  (${user(p.key)}, '${p.key}@matrix.example', 'authenticated', 'authenticated')`,
  );
  const members = PEOPLE.filter((p) => p.role !== null).map(
    (p) =>
      `  (${TEAM}, ${user(p.key)}, '${p.role}', ${p.department ? DEPARTMENT[p.department] : "null"})`,
  );
  const { sales, support } = DEPARTMENT;
  return `insert into auth.users (id, email, aud, role) values
${accounts.join(",\n")};
update public.profiles set is_owner = true where id = ${user("owner")};

insert into public.teams (id, name, created_by) values
  (${TEAM}, 'Matrix', ${user("owner")}), (${OTHER}, 'Elsewhere', ${user("owner")});
insert into public.team_plans (team_id) values (${TEAM}), (${OTHER}) on conflict do nothing;
insert into public.departments (id, team_id, name) values
  (${sales}, ${TEAM}, 'Sales'), (${support}, ${TEAM}, 'Support');
insert into public.team_members (team_id, user_id, role, department_id) values
${members.join(",\n")},
  (${OTHER}, ${user("zed")}, 'member', null);
insert into public.invites (team_id, code_hash, role, created_by, expires_at, max_uses, approval_required)
  values (${TEAM}, '\\x6d6174726978', 'member', ${user("owner")}, now() + interval '1 day', 1, true);
insert into public.join_requests (team_id, user_id, role) values (${TEAM}, ${user("zed")}, 'member');
insert into public.audit_events (team_id, seq, ts, actor_id, action, prev_hash, hash)
  values (${TEAM}, 1, now(), ${user("owner")}, 'matrix.seeded', '', 'matrix-hash-1');
insert into public.team_settings (team_id, key, value) values (${TEAM}, 'governance', '"review"');
insert into public.vocabulary_items (id, team_id, kind, scope, department_id, key, payload, status, proposed_by) values
  (${ITEM(1)}, ${TEAM}, 'dictionary', 'company', null, 'one', '{}', 'active', ${user("owner")}),
  (${ITEM(2)}, ${TEAM}, 'dictionary', 'department', ${sales}, 'two', '{}', 'active', ${user("owner")}),
  (${ITEM(3)}, ${TEAM}, 'dictionary', 'company', null, 'three', '{}', 'pending', ${user("sam")});
delete from public.vocabulary_versions where item_id in (${ITEM(1)}, ${ITEM(2)}, ${ITEM(3)});
insert into public.vocabulary_versions (item_id, version, action, payload, status)
  select id, 1, 'created', '{}', status from public.vocabulary_items where team_id = ${TEAM};
insert into public.vocabulary_notices (team_id, user_id, item_id, kind, summary)
  values (${TEAM}, ${user("sam")}, ${ITEM(3)}, 'dictionary', 'three');
insert into public.policy_values (team_id, scope, scope_id, key, value) values
  (${TEAM}, 'team', '', 'matrix.team', 'true'),
  (${TEAM}, 'department', ${sales}, 'matrix.department', 'true'),
  (${TEAM}, 'member', ${user("sam")}, 'matrix.member', 'true');
insert into public.usage_daily (team_id, user_id, day, metric, count) values
  (${TEAM}, ${user("sam")}, current_date, 'words', 1), (${TEAM}, ${user("mem")}, current_date, 'words', 1);
insert into public.usage_batches (team_id, user_id, batch_id) values (${TEAM}, ${user("sam")}, 'one');
insert into public.team_skills (id, team_id, name, body, scope, department_id, status) values
  (${SKILL(1)}, ${TEAM}, 'Company', 'x', 'company', null, 'active'),
  (${SKILL(2)}, ${TEAM}, 'Sales', 'x', 'department', ${sales}, 'active'),
  (${SKILL(3)}, ${TEAM}, 'Removed', 'x', 'company', null, 'deleted');
insert into public.team_skill_versions (skill_id, version, name, body)
  select id, 1, name, body from public.team_skills where team_id = ${TEAM};
insert into public.shared_folders (id, team_id, name, kind, department_id, status) values
  (${FOLDER(1)}, ${TEAM}, 'Company', 'company', null, 'active'),
  (${FOLDER(2)}, ${TEAM}, 'Sales', 'department', ${sales}, 'active'),
  (${FOLDER(3)}, ${TEAM}, 'Shared', 'shared', null, 'active'),
  (${FOLDER(4)}, ${TEAM}, 'Removed', 'company', null, 'deleted');
insert into public.folder_members (folder_id, user_id) values (${FOLDER(3)}, ${user("mem")});
insert into public.folder_items (folder_id, title, body_md)
  select id, name, 'x' from public.shared_folders where team_id = ${TEAM};`;
}

function actionChecks(): string {
  const rows: string[] = [];
  const actions = Object.keys(ACTIONS) as ActionName[];
  for (const person of PEOPLE)
    for (const action of actions)
      for (const department of DEPARTMENTS)
        rows.push(
          `    ('${person.key}', ${user(person.key)}, '${action}', ${TEAM}, ${department ? DEPARTMENT[department] : "null"}, ${expected(action, person, department)})`,
        );
  // The backend owner in a team they do not belong to.
  const elsewhere: Person = {
    key: "owner elsewhere",
    role: null,
    department: null,
    isServerOwner: true,
  };
  for (const action of actions) {
    if (OWNER_ELSEWHERE_GAPS.includes(action)) continue;
    rows.push(
      `    ('${elsewhere.key}', ${user("owner")}, '${action}', ${id("10000000", 3)}, null, ${expected(action, elsewhere, null)})`,
    );
  }
  return rows.join(",\n");
}

function readChecks(): string {
  const checks: string[] = [];
  for (const [table, visible] of Object.entries(VISIBLE)) {
    PEOPLE.forEach((person, index) => {
      checks.push(`  perform t.as_user(${user(person.key)});`);
      const label = `'${person.key} reads ${table}'`;
      if (visible === "denied") {
        checks.push(`  perform t.denied('select 1 from public.${table}', ${label});`);
      } else if (visible === "all") {
        checks.push(
          `  select count(*) into got from public.${table};`,
          `  perform t.check(got = (select n from t.totals where name = '${table}'), ${label});`,
        );
      } else {
        checks.push(
          `  select count(*) into got from public.${table} where ${teamRows(table)};`,
          `  perform t.check(got = ${visible[index]}, ${label} || ': ' || got);`,
        );
      }
    });
    checks.push(
      "  perform t.as_anon();",
      `  perform t.denied('select 1 from public.${table}', 'nobody signed out reads ${table}');`,
    );
  }
  return checks.join("\n");
}

export function matrixSql(): string {
  const everyone = [...PEOPLE.map((p) => user(p.key)), "null"].join(", ");
  return `-- The whole permission matrix against the database (SW-04).
--
-- GENERATED by \`npm run matrix --workspace @murmur/supabase\` from src/matrix.ts and the local
-- server's rules. Do not edit by hand: a test fails when this file is out of date.
--
-- Run it like rls.sql, against a local stack or a database with the migrations applied and no
-- owner yet. It ends by raising "ALL TESTS PASSED", which undoes everything it did.

begin;

create schema t;
grant usage on schema t to anon, authenticated;

create function t.as_user(u uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function t.as_anon() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
end $$;

create function t.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then
    raise exception 'FAIL %', label;
  end if;
end $$;

-- The statement must be refused for want of a privilege.
create function t.denied(stmt text, label text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'FAIL %: it was allowed', label;
end $$;

-- The statement must be refused, or find nothing it may change.
create function t.changes_nothing(stmt text, label text) returns void language plpgsql as $$
declare
  changed bigint;
begin
  begin
    execute stmt;
    get diagnostics changed = row_count;
  exception when insufficient_privilege then
    return;
  end;
  if changed <> 0 then
    raise exception 'FAIL %: % rows changed', label, changed;
  end if;
end $$;

grant execute on all functions in schema t to anon, authenticated;

${seed()}

create table t.totals (name text primary key, n bigint not null);
insert into t.totals values
  ('role_permissions', (select count(*) from public.role_permissions)),
  ('plan_features', (select count(*) from public.plan_features));
grant select on t.totals to authenticated;

do $$
declare
  c record;
  got bigint;
  answer boolean;
  person uuid;
  tbl record;
begin
  -- ---- every action, for every person and department
  for c in select * from (values
${actionChecks()}
  ) as v(who, uid, action, team, department, want)
  loop
    perform t.as_user(c.uid::uuid);
    answer := private.can(c.action, c.team::uuid, c.department::uuid);
    perform t.check(answer = c.want, format('%s %s in department %s: wanted %s', c.who, c.action, coalesce(c.department::text, 'none'), c.want));
  end loop;

  -- ---- every table is covered
  reset role;
  perform t.check(
    (select array_agg(tablename::text order by tablename::text) from pg_tables where schemaname = 'public')
      = array[${Object.keys(VISIBLE)
        .sort()
        .map((name) => `'${name}'`)
        .join(", ")}],
    'the matrix names every table in public');

  -- ---- what each person reads
${readChecks()}

  -- ---- no client writes any table
  foreach person in array array[${everyone}]::uuid[] loop
    reset role;
    for tbl in
      select p.tablename::text as name,
             (select a.attname::text from pg_attribute a
              where a.attrelid = format('public.%I', p.tablename)::regclass and a.attnum > 0
                and not a.attisdropped and a.attidentity = '' and a.attgenerated = ''
              order by a.attnum limit 1) as first_column
      from pg_tables p where p.schemaname = 'public'
    loop
      if person is null then perform t.as_anon(); else perform t.as_user(person); end if;
      perform t.denied(format('insert into public.%I default values', tbl.name), 'insert into ' || tbl.name);
      perform t.changes_nothing(format('update public.%I set %I = %I', tbl.name, tbl.first_column, tbl.first_column), 'update ' || tbl.name);
      perform t.changes_nothing(format('delete from public.%I', tbl.name), 'delete from ' || tbl.name);
      reset role;
    end loop;
  end loop;

  reset role;
  raise exception 'ALL TESTS PASSED';
end $$;
`;
}
