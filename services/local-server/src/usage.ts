import type { DatabaseSync } from "node:sqlite";
import type { AuditInput } from "./audit.ts";
import { fail, type Failure } from "./http.ts";
import type { UsageSettingsStore, LeaderboardMetric } from "./team-settings.ts";
import type { Teams, Who } from "./teams.ts";

/**
 * Usage dashboards, export and the leaderboard (TM-09, TM-10). Clients send counts in batches;
 * the server keeps them as daily rollups per person, metric and app group. It never receives or
 * stores text: an event is a day, a metric name, an app group and a number.
 */
export const USAGE_METRICS = [
  "words",
  "dictations",
  "meeting_minutes_recorded",
  "meeting_minutes_processed",
  "meetings_recorded",
  "skills_run",
  "ask_sessions",
] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

/** The app groups a client may report. Anything else is `other`. */
export const APP_BUCKETS = [
  "mail",
  "browser",
  "chat",
  "documents",
  "code",
  "notes",
  "other",
] as const;
/** Only these metrics are kept per app. */
const PER_APP: readonly UsageMetric[] = ["words", "dictations"];

export const USAGE_LIMITS = {
  eventsPerBatch: 500,
  countMax: 1_000_000,
  /** How far back a late batch may reach, in days. */
  lateDays: 35,
  rangeDays: 400,
  topApps: 10,
  appName: 60,
} as const;

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const BATCH_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface UsageDeps {
  db: DatabaseSync;
  now(): number;
  audit(input: AuditInput): void;
  settings: UsageSettingsStore;
  teams: Teams;
}

export interface UsageFilters {
  from?: string;
  to?: string;
  departmentId?: string;
  memberId?: string;
}

type Ok<T> = { ok: true } & T;

const isAdmin = (who: Who) => who.isServerOwner || who.role === "owner" || who.role === "admin";

/** `YYYY-MM-DD` for a time (UTC). */
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
const validDay = (value: unknown): value is string =>
  typeof value === "string" &&
  DAY.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  dayOf(Date.parse(`${value}T00:00:00Z`)) === value;

/** The current run of days ending today or yesterday, and the longest run, from a set of days. */
export function streaks(
  days: Iterable<string>,
  today: string,
): { current: number; longest: number } {
  const numbers = [...new Set([...days].map(dayNumber))].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const n of numbers) {
    run = previous !== null && n === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = n;
  }
  const last = numbers.at(-1);
  const t = dayNumber(today);
  // A streak is alive if the last active day is today or yesterday.
  const current = last !== undefined && (last === t || last === t - 1) ? run : 0;
  return { current, longest };
}

interface RollupRow {
  day: string;
  user_id: string;
  name: string;
  email: string;
  department_id: string | null;
  department: string | null;
  cost_center: string | null;
  metric: UsageMetric;
  bucket: string;
  count: number;
}

export function createUsage(deps: UsageDeps) {
  const { db } = deps;

  // ---- ingest ----

  function ingest(
    who: Who,
    teamId: string,
    body: Record<string, unknown>,
  ): Ok<{ accepted: number; duplicate: boolean }> | Failure {
    const batchId = body["batchId"];
    if (typeof batchId !== "string" || !BATCH_ID.test(batchId))
      return fail(400, "invalid_batch", "A batch has an id of 8 to 64 letters, digits, - or _.");
    const events = body["events"];
    if (
      !Array.isArray(events) ||
      events.length === 0 ||
      events.length > USAGE_LIMITS.eventsPerBatch
    )
      return fail(400, "invalid_batch", `A batch has 1 to ${USAGE_LIMITS.eventsPerBatch} events.`);

    const appNames = deps.settings.usage.get(teamId).appNames;
    const today = dayNumber(dayOf(deps.now()));
    const rows = new Map<
      string,
      { day: string; metric: UsageMetric; bucket: string; count: number }
    >();

    for (const raw of events) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return fail(400, "invalid_event", "Each event is an object.");
      const event = raw as Record<string, unknown>;
      const { day, metric, count } = event;
      if (!validDay(day)) return fail(400, "invalid_event", "An event's day is YYYY-MM-DD.");
      const age = today - dayNumber(day);
      if (age > USAGE_LIMITS.lateDays || age < -1)
        return fail(
          400,
          "invalid_event",
          `An event's day is within the last ${USAGE_LIMITS.lateDays} days.`,
        );
      if (typeof metric !== "string" || !(USAGE_METRICS as readonly string[]).includes(metric))
        return fail(400, "invalid_event", `A metric is one of ${USAGE_METRICS.join(", ")}.`);
      if (
        typeof count !== "number" ||
        !Number.isInteger(count) ||
        count < 0 ||
        count > USAGE_LIMITS.countMax
      )
        return fail(
          400,
          "invalid_event",
          `A count is a whole number up to ${USAGE_LIMITS.countMax}.`,
        );
      if (count === 0) continue;

      // The app group is kept for dictation metrics. A real name is kept only when the team
      // allows app names; otherwise it is dropped and the group stands.
      let bucket = "";
      if ((PER_APP as readonly string[]).includes(metric)) {
        const named =
          typeof event["appName"] === "string" ? event["appName"].replace(/\s+/g, " ").trim() : "";
        const group = typeof event["bucket"] === "string" ? event["bucket"].toLowerCase() : "other";
        bucket =
          appNames && named !== ""
            ? named.slice(0, USAGE_LIMITS.appName)
            : (APP_BUCKETS as readonly string[]).includes(group)
              ? group
              : "other";
      }
      const key = `${day}|${metric}|${bucket}`;
      const existing = rows.get(key);
      if (existing) existing.count += count;
      else rows.set(key, { day, metric: metric as UsageMetric, bucket, count });
    }

    const duplicate = db
      .prepare("SELECT 1 FROM usage_batches WHERE team_id = ? AND user_id = ? AND batch_id = ?")
      .get(teamId, who.userId, batchId);
    if (duplicate) return { ok: true, accepted: 0, duplicate: true };

    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO usage_batches (team_id, user_id, batch_id, received_at) VALUES (?, ?, ?, ?)",
      ).run(teamId, who.userId, batchId, deps.now());
      const upsert = db.prepare(
        `INSERT INTO usage_daily (team_id, user_id, day, metric, bucket, count) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (team_id, user_id, day, metric, bucket) DO UPDATE SET count = count + excluded.count`,
      );
      for (const row of rows.values())
        upsert.run(teamId, who.userId, row.day, row.metric, row.bucket, row.count);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { ok: true, accepted: rows.size, duplicate: false };
  }

  // ---- who may see what ----

  /** The department and member a report is limited to, after the viewer's rights are applied. */
  function scopeFor(
    who: Who,
    teamId: string,
    filters: UsageFilters,
  ): Ok<{ departmentId: string | null; memberId: string | null }> | Failure {
    let departmentId = filters.departmentId ?? null;
    const memberId = filters.memberId ?? null;
    if (departmentId !== null) {
      const dept = deps.teams.department(departmentId);
      if (!dept || dept.teamId !== teamId)
        return fail(404, "not_found", "That department is not in this team.");
    }
    if (!isAdmin(who)) {
      // A Manager sees their own department, and nothing outside it.
      if (who.departmentId === null)
        return fail(403, "forbidden", "You have no department to report on.");
      if (departmentId !== null && departmentId !== who.departmentId)
        return fail(403, "forbidden", "You can only see your own department.");
      departmentId = who.departmentId;
    }
    if (memberId !== null) {
      const member = deps.teams.member(teamId, memberId);
      if (!member) return fail(404, "not_found", "That person is not in this team.");
      if (!isAdmin(who) && member.department_id !== who.departmentId)
        return fail(403, "forbidden", "You can only see people in your own department.");
      if (departmentId !== null && member.department_id !== departmentId)
        return fail(400, "invalid_filter", "That person is not in that department.");
    }
    return { ok: true, departmentId, memberId };
  }

  function range(filters: UsageFilters): Ok<{ from: string; to: string }> | Failure {
    const to = filters.to ?? dayOf(deps.now());
    const from = filters.from ?? dayOf(Date.parse(`${to}T00:00:00Z`) - 29 * DAY_MS);
    if (!validDay(from) || !validDay(to))
      return fail(400, "invalid_range", "Dates are written YYYY-MM-DD.");
    if (from > to) return fail(400, "invalid_range", "The start is after the end.");
    if (dayNumber(to) - dayNumber(from) + 1 > USAGE_LIMITS.rangeDays)
      return fail(400, "invalid_range", `A report covers at most ${USAGE_LIMITS.rangeDays} days.`);
    return { ok: true, from, to };
  }

  /** The rollup rows for a team, a range and a scope, with the person's department and cost centre. */
  function rowsFor(
    teamId: string,
    from: string,
    to: string,
    scope: { departmentId: string | null; memberId: string | null },
  ): RollupRow[] {
    return db
      .prepare(
        `SELECT u.day, u.user_id, usr.name, usr.email, m.department_id, d.name AS department,
                d.cost_center, u.metric, u.bucket, u.count
         FROM usage_daily u
         JOIN team_members m ON m.team_id = u.team_id AND m.user_id = u.user_id
         JOIN users usr ON usr.id = u.user_id
         LEFT JOIN departments d ON d.id = m.department_id
         WHERE u.team_id = ? AND u.day >= ? AND u.day <= ?
           AND (? IS NULL OR m.department_id = ?) AND (? IS NULL OR u.user_id = ?)
         ORDER BY u.day, usr.name, u.metric, u.bucket`,
      )
      .all(
        teamId,
        from,
        to,
        scope.departmentId,
        scope.departmentId,
        scope.memberId,
        scope.memberId,
      ) as unknown as RollupRow[];
  }

  const emptyTotals = () =>
    Object.fromEntries(USAGE_METRICS.map((metric) => [metric, 0])) as Record<UsageMetric, number>;

  // ---- reports ----

  function report(who: Who, teamId: string, filters: UsageFilters, options: { members: boolean }) {
    const scope = scopeFor(who, teamId, filters);
    if (!scope.ok) return scope;
    const span = range(filters);
    if (!span.ok) return span;
    const settings = deps.settings.usage.get(teamId);
    const rows = rowsFor(teamId, span.from, span.to, scope);

    const totals = emptyTotals();
    const days = new Map<string, Record<UsageMetric, number>>();
    for (let n = dayNumber(span.from); n <= dayNumber(span.to); n++)
      days.set(new Date(n * DAY_MS).toISOString().slice(0, 10), emptyTotals());
    const apps = new Map<string, { dictations: number; words: number }>();
    const departments = new Map<
      string,
      {
        departmentId: string | null;
        name: string;
        costCenter: string;
        totals: Record<UsageMetric, number>;
      }
    >();
    const members = new Map<
      string,
      {
        userId: string;
        name: string;
        department: string | null;
        totals: Record<UsageMetric, number>;
      }
    >();

    for (const row of rows) {
      totals[row.metric] += row.count;
      days.get(row.day)![row.metric] += row.count;
      if (row.bucket !== "") {
        const app = apps.get(row.bucket) ?? { dictations: 0, words: 0 };
        if (row.metric === "dictations") app.dictations += row.count;
        if (row.metric === "words") app.words += row.count;
        apps.set(row.bucket, app);
      }
      const deptKey = row.department_id ?? "";
      const dept = departments.get(deptKey) ?? {
        departmentId: row.department_id,
        name: row.department ?? "No department",
        costCenter: row.cost_center ?? "",
        totals: emptyTotals(),
      };
      dept.totals[row.metric] += row.count;
      departments.set(deptKey, dept);
      if (options.members) {
        const person = members.get(row.user_id) ?? {
          userId: row.user_id,
          name: row.name,
          department: row.department,
          totals: emptyTotals(),
        };
        person.totals[row.metric] += row.count;
        members.set(row.user_id, person);
      }
    }

    const saved = (words: number) => Math.round(words / settings.typingWpm);
    return {
      ok: true as const,
      range: { from: span.from, to: span.to },
      filters: { departmentId: scope.departmentId, memberId: scope.memberId },
      typingWpm: settings.typingWpm,
      totals: { ...totals, timeSavedMinutes: saved(totals.words) },
      daily: [...days.entries()].map(([day, counts]) => ({ day, ...counts })),
      topApps: [...apps.entries()]
        .map(([app, counts]) => ({ app, ...counts }))
        .sort(
          (a, b) => b.dictations - a.dictations || b.words - a.words || (a.app < b.app ? -1 : 1),
        )
        .slice(0, USAGE_LIMITS.topApps),
      departments: [...departments.values()]
        .map((dept) => ({
          ...dept,
          totals: { ...dept.totals, timeSavedMinutes: saved(dept.totals.words) },
        }))
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
      ...(options.members
        ? {
            members: [...members.values()]
              .map((person) => ({
                ...person,
                totals: { ...person.totals, timeSavedMinutes: saved(person.totals.words) },
              }))
              .sort((a, b) => (a.name < b.name ? -1 : 1)),
          }
        : {}),
    };
  }

  /** CSV cells that a spreadsheet could read as a formula get a quote in front of them. */
  const cell = (value: string | number | null): string => {
    const text = value === null ? "" : String(value);
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };

  return {
    ingest,

    report: (who: Who, teamId: string, filters: UsageFilters, members: boolean) =>
      report(who, teamId, filters, { members }),

    /** The filtered rollup rows as CSV or JSON, with department and cost centre, and the audit entry. */
    export(
      who: Who,
      teamId: string,
      filters: UsageFilters,
      format: string,
    ): Ok<{ body: string; type: string; rows: number }> | Failure {
      if (format !== "csv" && format !== "json")
        return fail(400, "invalid_format", "The format is csv or json.");
      const scope = scopeFor(who, teamId, filters);
      if (!scope.ok) return scope;
      const span = range(filters);
      if (!span.ok) return span;
      const rows = rowsFor(teamId, span.from, span.to, scope);
      deps.audit({
        actorId: who.userId,
        action: "usage.exported",
        targetType: "team",
        targetId: teamId,
        detail: {
          format,
          rows: rows.length,
          from: span.from,
          to: span.to,
          scoped: scope.departmentId !== null,
        },
      });
      if (format === "json")
        return {
          ok: true,
          type: "application/json; charset=utf-8",
          rows: rows.length,
          body: JSON.stringify(
            rows.map((row) => ({
              day: row.day,
              member: row.name,
              email: row.email,
              department: row.department,
              costCenter: row.cost_center,
              metric: row.metric,
              app: row.bucket === "" ? null : row.bucket,
              count: row.count,
            })),
          ),
        };
      const header = "day,member,email,department,cost_center,metric,app,count";
      const lines = rows.map((row) =>
        [
          row.day,
          row.name,
          row.email,
          row.department,
          row.cost_center,
          row.metric,
          row.bucket,
          row.count,
        ]
          .map(cell)
          .join(","),
      );
      return {
        ok: true,
        type: "text/csv; charset=utf-8",
        rows: rows.length,
        body: [header, ...lines].join("\n") + "\n",
      };
    },

    // ---- leaderboard ----

    leaderboard(who: Who, teamId: string, options: { metric?: string; period?: string }) {
      const settings = deps.settings.leaderboard.get(teamId);
      if (!settings.enabled) return { ok: true as const, enabled: false as const };
      const metric = (options.metric ?? settings.metric) as LeaderboardMetric;
      if (!["words", "meetings", "streak"].includes(metric))
        return fail(400, "invalid_metric", "The metric is words, meetings or streak.");
      const period = options.period ?? "week";
      if (period !== "week" && period !== "all")
        return fail(400, "invalid_period", "The period is week or all.");

      const today = dayOf(deps.now());
      const weekStart = dayOf(deps.now() - 6 * DAY_MS);
      const from = period === "week" ? weekStart : "0000-01-01";

      const members = deps.teams.members(teamId);
      const choices = new Map(
        (
          db
            .prepare("SELECT user_id, visible FROM leaderboard_choices WHERE team_id = ?")
            .all(teamId) as {
            user_id: string;
            visible: number;
          }[]
        ).map((row) => [row.user_id, row.visible === 1]),
      );
      const visible = (userId: string) => choices.get(userId) ?? settings.visibleByDefault;

      const values = new Map<string, number>();
      if (metric === "streak") {
        const daysOf = db
          .prepare(
            "SELECT DISTINCT user_id, day FROM usage_daily WHERE team_id = ? AND day <= ? AND count > 0",
          )
          .all(teamId, today) as { user_id: string; day: string }[];
        const byUser = new Map<string, string[]>();
        for (const row of daysOf)
          byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row.day]);
        for (const member of members) {
          const days = byUser.get(member.userId) ?? [];
          // Week: how many of the last seven days were active. All time: the longest run.
          values.set(
            member.userId,
            period === "week"
              ? days.filter((day) => day >= weekStart).length
              : streaks(days, today).longest,
          );
        }
      } else {
        const column = metric === "words" ? "words" : "meetings_recorded";
        const sums = db
          .prepare(
            `SELECT user_id, SUM(count) AS total FROM usage_daily
             WHERE team_id = ? AND metric = ? AND day >= ? AND day <= ? GROUP BY user_id`,
          )
          .all(teamId, column, from, today) as { user_id: string; total: number }[];
        for (const row of sums) values.set(row.user_id, row.total);
      }

      const shown = members
        .filter((member) => visible(member.userId))
        .map((member) => ({
          userId: member.userId,
          name: member.name,
          value: values.get(member.userId) ?? 0,
        }))
        .sort((a, b) => b.value - a.value || (a.name < b.name ? -1 : 1));
      // Ties share a rank: 1, 1, 3.
      const ranks = shown.map((entry, index) => {
        const first = shown.findIndex((other) => other.value === entry.value);
        return {
          rank: first + 1,
          userId: entry.userId,
          name: entry.name,
          value: entry.value,
          position: index,
        };
      });
      const total = members.reduce((sum, member) => sum + (values.get(member.userId) ?? 0), 0);
      const seesAll = isAdmin(who);
      const mine = ranks.find((entry) => entry.userId === who.userId);

      return {
        ok: true as const,
        enabled: true as const,
        metric,
        period,
        // Counts are shown to the person they belong to, and to admins; everyone else sees ranks.
        ranks: ranks.map((entry) => ({
          rank: entry.rank,
          userId: entry.userId,
          name: entry.name,
          value: seesAll || entry.userId === who.userId ? entry.value : null,
          isMe: entry.userId === who.userId,
        })),
        total,
        hiddenCount: members.length - shown.length,
        me: {
          visible: visible(who.userId),
          value: values.get(who.userId) ?? 0,
          rank: mine?.rank ?? null,
        },
        settings,
      };
    },

    setMyVisibility(who: Who, teamId: string, visible: boolean): void {
      db.prepare(
        `INSERT INTO leaderboard_choices (team_id, user_id, visible) VALUES (?, ?, ?)
         ON CONFLICT (team_id, user_id) DO UPDATE SET visible = excluded.visible`,
      ).run(teamId, who.userId, visible ? 1 : 0);
    },

    /** Removes rollups older than each team's retention and old batch ids. */
    prune(): number {
      let removed = 0;
      for (const team of db.prepare("SELECT id FROM teams").all() as { id: string }[]) {
        const days = deps.settings.usage.get(team.id).retentionDays;
        removed += Number(
          db
            .prepare("DELETE FROM usage_daily WHERE team_id = ? AND day < ?")
            .run(team.id, dayOf(deps.now() - days * DAY_MS)).changes,
        );
      }
      db.prepare("DELETE FROM usage_batches WHERE received_at < ?").run(deps.now() - 7 * DAY_MS);
      return removed;
    },
  };
}

export type Usage = ReturnType<typeof createUsage>;
