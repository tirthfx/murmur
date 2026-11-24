import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/**
 * Moving a team server to Supabase (SW-01 phase 4, SW-02): reads the local server's database,
 * plans what goes where, writes it with the project's service key, and checks the counts after.
 * The reading and the planning are pure; only `applyImport` and `verifyImport` talk to a project.
 *
 * What moves: accounts (the same ids), teams, departments, members, plan tiers, the shared
 * dictionary and snippets with their history and notices, policy, team settings, usage counts,
 * shared Skills, folders and the notes in them. What does not, and why:
 *  - passwords: they are hashes of another scheme. Each account gets a temporary password,
 *    written to a file for the owner to hand out;
 *  - the audit log: its chain is hashed another way, so it cannot be carried over and still
 *    verify. It is archived as it is, and each team's new chain starts with an event that
 *    records the old log's length and last hash;
 *  - invites and join requests: outstanding ones are made again;
 *  - changes waiting on a live entry (`pending_json`): the Supabase backend has no such flow.
 */
type Row = Record<string, unknown>;

export interface ImportPlan {
  users: Row[];
  /** The ids of the accounts that were the server's owner or were turned off. */
  owner: string | null;
  deactivated: string[];
  teams: Row[];
  teamPlans: Row[];
  departments: Row[];
  teamMembers: Row[];
  teamSettings: Row[];
  vocabularyItems: Row[];
  vocabularyVersions: Row[];
  vocabularyNotices: Row[];
  policyValues: Row[];
  usageDaily: Row[];
  teamSkills: Row[];
  teamSkillVersions: Row[];
  sharedFolders: Row[];
  folderMembers: Row[];
  folderItems: Row[];
  /** What is left behind, so it is said and not lost quietly. */
  dropped: { pendingChanges: number; invites: number; joinRequests: number; auditEvents: number };
  /** The end of the local audit chain, for the event that starts the new one. */
  audit: { events: number; lastSeq: number; lastHash: string };
  counts: Record<string, number>;
}

const iso = (ms: unknown): string | null =>
  typeof ms === "number" ? new Date(ms).toISOString() : null;

const json = (text: unknown): unknown => {
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
};

const all = (db: DatabaseSync, sql: string): Row[] => db.prepare(sql).all() as Row[];
const count = (db: DatabaseSync, table: string): number =>
  Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

export function planImport(db: DatabaseSync): ImportPlan {
  const tier = ((): string => {
    const row = db
      .prepare("SELECT value_json FROM server_settings WHERE key = 'plan.tier'")
      .get() as { value_json: string } | undefined;
    const saved = row ? json(row.value_json) : null;
    return typeof saved === "string" ? saved : "enterprise";
  })();

  const users = all(db, "SELECT * FROM users ORDER BY created_at, id");
  const teams = all(db, "SELECT * FROM teams ORDER BY created_at, id");
  const teamIds = new Set(teams.map((t) => String(t["id"])));
  const live = (rows: Row[], key = "team_id") => rows.filter((r) => teamIds.has(String(r[key])));

  const items = live(all(db, "SELECT * FROM vocabulary_items ORDER BY created_at, id"));
  const itemIds = new Set(items.map((i) => String(i["id"])));
  const skills = live(all(db, "SELECT * FROM team_skills ORDER BY created_at, id"));
  const skillIds = new Set(skills.map((s) => String(s["id"])));
  const folders = live(all(db, "SELECT * FROM shared_folders ORDER BY created_at, id"));
  const folderIds = new Set(folders.map((f) => String(f["id"])));

  const plan: ImportPlan = {
    users: users.map((u) => ({
      id: u["id"],
      email: u["email"],
      name: u["name"],
      createdAt: iso(u["created_at"]),
    })),
    owner: String(users.find((u) => u["is_owner"] === 1)?.["id"] ?? "") || null,
    deactivated: users.filter((u) => u["status"] !== "active").map((u) => String(u["id"])),
    teams: teams.map((t) => ({
      id: t["id"],
      name: t["name"],
      created_by: t["created_by"],
      created_at: iso(t["created_at"]),
      updated_at: iso(t["updated_at"]),
    })),
    teamPlans: teams.map((t) => ({ team_id: t["id"], tier })),
    departments: live(all(db, "SELECT * FROM departments ORDER BY created_at, id")).map((d) => ({
      id: d["id"],
      team_id: d["team_id"],
      name: d["name"],
      cost_center: d["cost_center"],
      parent_id: d["parent_id"],
      created_at: iso(d["created_at"]),
    })),
    teamMembers: live(all(db, "SELECT * FROM team_members")).map((m) => ({
      team_id: m["team_id"],
      user_id: m["user_id"],
      role: m["role"],
      department_id: m["department_id"],
      joined_at: iso(m["joined_at"]),
    })),
    teamSettings: live(all(db, "SELECT * FROM team_settings"))
      .map((s) => ({ team_id: s["team_id"], key: s["key"], value: json(s["value_json"]) }))
      .filter((s) => s.value !== null),
    vocabularyItems: items.map((i) => ({
      id: i["id"],
      team_id: i["team_id"],
      kind: i["kind"],
      scope: i["scope"],
      department_id: i["department_id"],
      key: i["key"],
      payload: json(i["payload_json"]),
      status: i["status"],
      locked: i["locked"] === 1,
      proposed_by: i["proposed_by"],
      approved_by: i["approved_by"],
      version: i["version"],
      created_at: iso(i["created_at"]),
      updated_at: iso(i["updated_at"]),
    })),
    vocabularyVersions: all(db, "SELECT * FROM vocabulary_versions ORDER BY id")
      .filter((v) => itemIds.has(String(v["item_id"])))
      .map((v) => ({
        item_id: v["item_id"],
        version: v["version"],
        action: v["action"],
        payload: json(v["payload_json"]),
        status: v["status"],
        changed_by: v["changed_by"],
        changed_at: iso(v["changed_at"]),
      })),
    vocabularyNotices: live(
      all(db, "SELECT * FROM vocabulary_notices ORDER BY created_at, id"),
    ).map((n) => ({
      id: n["id"],
      team_id: n["team_id"],
      user_id: n["user_id"],
      item_id: n["item_id"],
      kind: n["kind"],
      summary: n["summary"],
      note: n["note"],
      created_at: iso(n["created_at"]),
      seen_at: iso(n["seen_at"]),
    })),
    policyValues: live(all(db, "SELECT * FROM policy_values")).map((p) => ({
      team_id: p["team_id"],
      scope: p["scope"],
      scope_id: p["scope_id"],
      key: p["key"],
      value: json(p["value_json"]),
      source: p["source"],
      updated_by: p["updated_by"],
      updated_at: iso(p["updated_at"]),
    })),
    usageDaily: live(all(db, "SELECT * FROM usage_daily")).map((u) => ({
      team_id: u["team_id"],
      user_id: u["user_id"],
      day: u["day"],
      metric: u["metric"],
      bucket: u["bucket"],
      count: u["count"],
    })),
    teamSkills: skills.map((s) => ({
      id: s["id"],
      team_id: s["team_id"],
      name: s["name"],
      description: s["description"],
      body: s["body"],
      scope: s["scope"],
      department_id: s["department_id"],
      version: s["version"],
      status: s["status"],
      created_by: s["created_by"],
      created_at: iso(s["created_at"]),
      updated_at: iso(s["updated_at"]),
    })),
    teamSkillVersions: all(db, "SELECT * FROM team_skill_versions ORDER BY id")
      .filter((v) => skillIds.has(String(v["skill_id"])))
      .map((v) => ({
        skill_id: v["skill_id"],
        version: v["version"],
        name: v["name"],
        body: v["body"],
        changed_by: v["changed_by"],
        changed_at: iso(v["changed_at"]),
      })),
    sharedFolders: folders.map((f) => ({
      id: f["id"],
      team_id: f["team_id"],
      name: f["name"],
      kind: f["kind"],
      department_id: f["department_id"],
      status: f["status"],
      created_by: f["created_by"],
      created_at: iso(f["created_at"]),
    })),
    folderMembers: all(db, "SELECT * FROM folder_members")
      .filter((m) => folderIds.has(String(m["folder_id"])))
      .map((m) => ({
        folder_id: m["folder_id"],
        user_id: m["user_id"],
        can_write: m["can_write"] === 1,
        added_by: m["added_by"],
        added_at: iso(m["added_at"]),
      })),
    folderItems: all(db, "SELECT * FROM folder_items ORDER BY shared_at, id")
      .filter((i) => folderIds.has(String(i["folder_id"])))
      .map((i) => ({
        id: i["id"],
        folder_id: i["folder_id"],
        title: i["title"],
        body_md: i["body_md"],
        source_ref: i["source_ref"],
        shared_by: i["shared_by"],
        shared_at: iso(i["shared_at"]),
      })),
    dropped: {
      pendingChanges: items.filter((i) => i["pending_json"] !== null && i["status"] === "active")
        .length,
      invites: count(db, "invites"),
      joinRequests: count(db, "join_requests"),
      auditEvents: count(db, "audit_events"),
    },
    audit: ((): ImportPlan["audit"] => {
      const last = db
        .prepare("SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1")
        .get() as { seq: number; hash: string } | undefined;
      return {
        events: count(db, "audit_events"),
        lastSeq: last?.seq ?? 0,
        lastHash: last?.hash ?? "",
      };
    })(),
    counts: {},
  };
  plan.counts = {
    "auth.users": plan.users.length,
    teams: plan.teams.length,
    team_plans: plan.teamPlans.length,
    departments: plan.departments.length,
    team_members: plan.teamMembers.length,
    team_settings: plan.teamSettings.length,
    vocabulary_items: plan.vocabularyItems.length,
    vocabulary_versions: plan.vocabularyVersions.length,
    vocabulary_notices: plan.vocabularyNotices.length,
    policy_values: plan.policyValues.length,
    usage_daily: plan.usageDaily.length,
    team_skills: plan.teamSkills.length,
    team_skill_versions: plan.teamSkillVersions.length,
    shared_folders: plan.sharedFolders.length,
    folder_members: plan.folderMembers.length,
    folder_items: plan.folderItems.length,
  };
  return plan;
}

/** A short summary of a plan, for a person to read before anything is written. */
export function describePlan(plan: ImportPlan): string {
  const lines = ["What will be moved:"];
  for (const [table, n] of Object.entries(plan.counts)) lines.push(`  ${table.padEnd(22)} ${n}`);
  lines.push(
    "",
    "What is left behind:",
    `  passwords                each account gets a temporary one, written to a file`,
    `  audit log                ${plan.dropped.auditEvents} events, archived as they are; each team's new log starts with an event that records its end`,
    `  invites                  ${plan.dropped.invites} (make them again)`,
    `  join requests            ${plan.dropped.joinRequests} (ask again)`,
    `  waiting changes          ${plan.dropped.pendingChanges} to live entries (the new backend has no such flow)`,
  );
  return lines.join("\n");
}

// ---- the project ----

/** The few calls the import makes to a project, with its service key. */
export interface ProjectApi {
  insert(table: string, rows: Row[]): Promise<void>;
  update(table: string, match: Record<string, string>, patch: Row): Promise<void>;
  createUser(user: { id: string; email: string; name: string; password: string }): Promise<void>;
  rpc(name: string, args: Row): Promise<void>;
  count(table: string, filter?: string): Promise<number>;
}

export function projectApi(
  url: string,
  serviceKey: string,
  fetchImpl: typeof fetch = fetch,
): ProjectApi {
  const base = url.replace(/\/+$/, "");
  const headers = (extra: Record<string, string> = {}) => ({
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
    ...extra,
  });
  async function check(res: Response, what: string): Promise<Response> {
    if (res.ok) return res;
    throw new Error(`${what} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return {
    async insert(table, rows) {
      for (let i = 0; i < rows.length; i += 400) {
        await check(
          await fetchImpl(`${base}/rest/v1/${table}`, {
            method: "POST",
            headers: headers({ prefer: "return=minimal" }),
            body: JSON.stringify(rows.slice(i, i + 400)),
          }),
          `Writing ${table}`,
        );
      }
    },
    async update(table, match, patch) {
      const query = Object.entries(match)
        .map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`)
        .join("&");
      await check(
        await fetchImpl(`${base}/rest/v1/${table}?${query}`, {
          method: "PATCH",
          headers: headers({ prefer: "return=minimal" }),
          body: JSON.stringify(patch),
        }),
        `Changing ${table}`,
      );
    },
    async createUser(user) {
      await check(
        await fetchImpl(`${base}/auth/v1/admin/users`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            id: user.id,
            email: user.email,
            password: user.password,
            email_confirm: true,
            user_metadata: { name: user.name },
          }),
        }),
        `Making the account ${user.email}`,
      );
    },
    async rpc(name, args) {
      await check(
        await fetchImpl(`${base}/rest/v1/rpc/${name}`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(args),
        }),
        `Calling ${name}`,
      );
    },
    async count(table, filter = "") {
      const res = await check(
        await fetchImpl(`${base}/rest/v1/${table}?select=*${filter ? `&${filter}` : ""}`, {
          method: "HEAD",
          headers: headers({ prefer: "count=exact", range: "0-0" }),
        }),
        `Counting ${table}`,
      );
      const total = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1];
      return total === undefined ? 0 : Number(total);
    },
  };
}

export interface ImportReport {
  accounts: { id: string; email: string; temporaryPassword: string }[];
  written: Record<string, number>;
}

/** A password for an account made by the import: random, in groups that are easy to type. */
export function temporaryPassword(): string {
  const text = randomBytes(18).toString("base64url");
  return [0, 6, 12, 18].map((at) => text.slice(at, at + 6)).join("-");
}

export async function applyImport(
  plan: ImportPlan,
  api: ProjectApi,
  options: { passwordFor?: (userId: string) => string } = {},
): Promise<ImportReport> {
  if (plan.teams.length > 0) {
    const existing = await api.count(
      "teams",
      `id=in.(${plan.teams.map((t) => String(t["id"])).join(",")})`,
    );
    if (existing > 0)
      throw new Error(
        "Some of these teams are already in the project. The import is for an empty project; nothing was written.",
      );
  }
  const passwordFor = options.passwordFor ?? (() => temporaryPassword());
  const written: Record<string, number> = {};
  const note = (table: string, n: number) => (written[table] = (written[table] ?? 0) + n);

  const accounts: ImportReport["accounts"] = [];
  for (const user of plan.users) {
    const password = passwordFor(String(user["id"]));
    await api.createUser({
      id: String(user["id"]),
      email: String(user["email"]),
      name: String(user["name"]),
      password,
    });
    accounts.push({
      id: String(user["id"]),
      email: String(user["email"]),
      temporaryPassword: password,
    });
  }
  note("auth.users", accounts.length);
  if (plan.owner) await api.update("profiles", { id: plan.owner }, { is_owner: true });
  for (const id of plan.deactivated)
    await api.update("profiles", { id }, { status: "deactivated" });

  const put = async (table: string, rows: Row[]) => {
    if (rows.length === 0) return;
    await api.insert(table, rows);
    note(table, rows.length);
  };
  await put("teams", plan.teams);
  await put("team_plans", plan.teamPlans);
  // A parent department first, so the reference holds.
  const depth = (d: Row, seen = new Set<string>()): number => {
    const parent = plan.departments.find((p) => p["id"] === d["parent_id"]);
    if (!parent || seen.has(String(d["id"]))) return 0;
    seen.add(String(d["id"]));
    return 1 + depth(parent, seen);
  };
  await put(
    "departments",
    [...plan.departments].sort((a, b) => depth(a) - depth(b)),
  );
  await put("team_members", plan.teamMembers);
  await put("team_settings", plan.teamSettings);
  await put("vocabulary_items", plan.vocabularyItems);
  await put("vocabulary_versions", plan.vocabularyVersions);
  await put("vocabulary_notices", plan.vocabularyNotices);
  await put("policy_values", plan.policyValues);
  await put("usage_daily", plan.usageDaily);
  await put("team_skills", plan.teamSkills);
  await put("team_skill_versions", plan.teamSkillVersions);
  await put("shared_folders", plan.sharedFolders);
  await put("folder_members", plan.folderMembers);
  await put("folder_items", plan.folderItems);

  // Each team's new log begins with what became of the old one.
  for (const team of plan.teams)
    await api.rpc("record_import", {
      p_team: team["id"],
      p_detail: {
        events: plan.audit.events,
        lastSeq: plan.audit.lastSeq,
        lastHash: plan.audit.lastHash,
      },
    });
  return { accounts, written };
}

export interface VerifyLine {
  table: string;
  local: number;
  remote: number;
  ok: boolean;
}

/** Counts each moved table in the project against the plan. */
export async function verifyImport(plan: ImportPlan, api: ProjectApi): Promise<VerifyLine[]> {
  const ids = (rows: Row[], key = "id") => rows.map((r) => String(r[key])).join(",");
  const teamFilter = plan.teams.length > 0 ? `team_id=in.(${ids(plan.teams)})` : "";
  const lines: VerifyLine[] = [];
  const check = async (table: string, local: number, filter: string) => {
    const remote = local === 0 && !filter ? 0 : await api.count(table, filter);
    lines.push({ table, local, remote, ok: local === remote });
  };
  if (plan.teams.length === 0) return lines;
  await check("teams", plan.teams.length, `id=in.(${ids(plan.teams)})`);
  await check("team_plans", plan.teamPlans.length, teamFilter);
  await check("departments", plan.departments.length, teamFilter);
  await check("team_members", plan.teamMembers.length, teamFilter);
  await check("team_settings", plan.teamSettings.length, teamFilter);
  await check("vocabulary_items", plan.vocabularyItems.length, teamFilter);
  await check("vocabulary_notices", plan.vocabularyNotices.length, teamFilter);
  await check("policy_values", plan.policyValues.length, teamFilter);
  await check("usage_daily", plan.usageDaily.length, teamFilter);
  await check("team_skills", plan.teamSkills.length, teamFilter);
  await check("shared_folders", plan.sharedFolders.length, teamFilter);
  if (plan.users.length > 0)
    await check("profiles", plan.users.length, `id=in.(${ids(plan.users)})`);
  return lines;
}
