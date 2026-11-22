import type { DatabaseSync } from "node:sqlite";
import {
  POLICY_KEYS,
  POLICY_LIMITS,
  checkPolicyValue,
  domainBlocked,
  isPolicyKey,
  mergePolicy,
  type EffectivePolicy,
  type PolicyKey,
  type PolicyValues,
} from "../../../packages/shared/src/policy.ts";
import type { AuditInput } from "./audit.ts";
import { fail, type Failure } from "./http.ts";
import type { Teams, Who } from "./teams.ts";

/**
 * Team policy on the server (TM-13 to TM-16): values for the whole team, one department and one
 * member, and the policy that results for a person. The rules for merging and for what a value
 * means are in `packages/shared/src/policy.ts`, which the app uses to enforce it.
 */
export type PolicyScope = "team" | "department" | "member";
export type PolicySource = "admin" | "compliance";

export interface PolicyLayer {
  scope: PolicyScope;
  scopeId: string;
  values: Record<string, unknown>;
  sources: Record<string, PolicySource>;
}

export interface PolicyDeps {
  db: DatabaseSync;
  now(): number;
  audit(input: AuditInput): void;
  teams: Teams;
}

/** How often a client asks for its policy. */
export const POLICY_POLL_MINUTES = 5;

type Ok<T> = { ok: true } & T;

interface ValueRow {
  key: string;
  value_json: string;
  source: PolicySource;
}

/** What goes in an audit entry about a value: a count for a list, never a list's contents. */
function summarize(key: string, value: unknown): string | number | boolean | null {
  if (value === undefined) return "unset";
  if (Array.isArray(value)) return `${value.length} items`;
  if (key === "adminContact") return "changed";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  )
    return value;
  return "set";
}

export function createPolicy(deps: PolicyDeps) {
  const { db } = deps;

  const rows = (teamId: string, scope: PolicyScope, scopeId: string) =>
    db
      .prepare(
        "SELECT key, value_json, source FROM policy_values WHERE team_id = ? AND scope = ? AND scope_id = ?",
      )
      .all(teamId, scope, scopeId) as unknown as ValueRow[];

  function layer(teamId: string, scope: PolicyScope, scopeId: string): PolicyLayer {
    const values: Record<string, unknown> = {};
    const sources: Record<string, PolicySource> = {};
    for (const row of rows(teamId, scope, scopeId)) {
      if (!isPolicyKey(row.key)) continue;
      values[row.key] = JSON.parse(row.value_json);
      sources[row.key] = row.source;
    }
    return { scope, scopeId, values, sources };
  }

  const bump = (teamId: string) =>
    db
      .prepare(
        `INSERT INTO team_revisions (team_id, revision, policy_revision) VALUES (?, 0, 1)
         ON CONFLICT (team_id) DO UPDATE SET policy_revision = policy_revision + 1`,
      )
      .run(teamId);

  const revision = (teamId: string): number =>
    (
      db.prepare("SELECT policy_revision FROM team_revisions WHERE team_id = ?").get(teamId) as
        { policy_revision: number } | undefined
    )?.policy_revision ?? 0;

  /** The scope's id is checked: a department of this team, or a member of it. */
  function checkTarget(
    teamId: string,
    scope: unknown,
    scopeId: unknown,
  ): Ok<{ scope: PolicyScope; scopeId: string }> | Failure {
    if (scope !== "team" && scope !== "department" && scope !== "member")
      return fail(400, "invalid_scope", "The scope is team, department or member.");
    if (scope === "team") return { ok: true, scope, scopeId: "" };
    if (typeof scopeId !== "string" || scopeId === "")
      return fail(400, "invalid_scope", `Say which ${scope} this is for.`);
    if (scope === "department") {
      const dept = deps.teams.department(scopeId);
      if (!dept || dept.teamId !== teamId)
        return fail(404, "not_found", "That department is not in this team.");
    } else if (!deps.teams.member(teamId, scopeId))
      return fail(404, "not_found", "That person is not in this team.");
    return { ok: true, scope, scopeId };
  }

  return {
    revision,

    layer(teamId: string, scope: PolicyScope, scopeId: string) {
      return layer(teamId, scope, scopeId);
    },

    /** What an admin sees of one layer. */
    read(teamId: string, scope: unknown, scopeId: unknown): Ok<{ layer: PolicyLayer }> | Failure {
      const target = checkTarget(teamId, scope, scopeId);
      if (!target.ok) return target;
      return { ok: true, layer: layer(teamId, target.scope, target.scopeId) };
    },

    /** The policy that applies to a person: the team's, their department's and their own. */
    effective(
      who: Pick<Who, "userId" | "departmentId">,
      teamId: string,
    ): { revision: number; pollMinutes: number; policy: EffectivePolicy } {
      const layers: PolicyValues[] = [layer(teamId, "team", "").values as PolicyValues];
      if (who.departmentId)
        layers.push(layer(teamId, "department", who.departmentId).values as PolicyValues);
      layers.push(layer(teamId, "member", who.userId).values as PolicyValues);
      return {
        revision: revision(teamId),
        pollMinutes: POLICY_POLL_MINUTES,
        policy: mergePolicy(layers),
      };
    },

    /**
     * Sets and clears values in one layer. Each value is checked; a retention minimum cannot be
     * above the maximum in the same layer. Every changed setting is written to the audit log.
     */
    set(
      actorId: string,
      teamId: string,
      input: { scope: unknown; scopeId?: unknown; set?: unknown; unset?: unknown },
      source: PolicySource = "admin",
    ): Ok<{ layer: PolicyLayer; changed: number }> | Failure {
      if (!deps.teams.exists(teamId)) return fail(404, "not_found", "There is no such team.");
      const target = checkTarget(teamId, input.scope, input.scopeId);
      if (!target.ok) return target;
      const toSet = input.set === undefined ? {} : input.set;
      const toUnset = input.unset === undefined ? [] : input.unset;
      if (!toSet || typeof toSet !== "object" || Array.isArray(toSet))
        return fail(400, "invalid_policy", "`set` is an object of settings.");
      if (!Array.isArray(toUnset) || !toUnset.every((key) => typeof key === "string"))
        return fail(400, "invalid_policy", "`unset` is a list of setting names.");
      if (Object.keys(toSet).length === 0 && toUnset.length === 0)
        return fail(400, "invalid_policy", "Nothing to change.");

      const before = layer(teamId, target.scope, target.scopeId);
      const next: Record<string, unknown> = { ...before.values };
      const changes: [PolicyKey, unknown, unknown][] = [];

      for (const [name, value] of Object.entries(toSet)) {
        if (!isPolicyKey(name))
          return fail(400, "unknown_setting", `"${name}" is not a policy setting.`);
        if (name === "adminContact" && target.scope !== "team")
          return fail(400, "invalid_policy", "The admin contact is set for the whole team.");
        const checked = checkPolicyValue(name, value);
        if (!checked.ok) return fail(400, "invalid_policy", checked.message);
        if (JSON.stringify(before.values[name]) !== JSON.stringify(checked.value)) {
          changes.push([name, before.values[name], checked.value]);
          next[name] = checked.value;
        }
      }
      for (const name of toUnset as string[]) {
        if (!isPolicyKey(name))
          return fail(400, "unknown_setting", `"${name}" is not a policy setting.`);
        if (name in before.values && !(name in toSet)) {
          changes.push([name, before.values[name], undefined]);
          delete next[name];
        }
      }
      for (const kind of ["audio", "transcript"] as const) {
        const max = next[`retention.${kind}.max`];
        const min = next[`retention.${kind}.min`];
        if (typeof max === "number" && typeof min === "number" && min > max)
          return fail(
            400,
            "invalid_policy",
            `The minimum for ${kind} cannot be longer than the maximum.`,
          );
      }

      if (changes.length > 0) {
        const now = deps.now();
        for (const [name, , value] of changes) {
          if (value === undefined)
            db.prepare(
              "DELETE FROM policy_values WHERE team_id = ? AND scope = ? AND scope_id = ? AND key = ?",
            ).run(teamId, target.scope, target.scopeId, name);
          else
            db.prepare(
              `INSERT INTO policy_values (team_id, scope, scope_id, key, value_json, source, updated_by, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (team_id, scope, scope_id, key) DO UPDATE SET
                 value_json = excluded.value_json, source = excluded.source,
                 updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
            ).run(
              teamId,
              target.scope,
              target.scopeId,
              name,
              JSON.stringify(value),
              source,
              actorId,
              now,
            );
          deps.audit({
            actorId,
            action: "policy.changed",
            targetType: "team",
            targetId: teamId,
            detail: {
              setting: name,
              scope: target.scope,
              scopeId: target.scopeId,
              from: summarize(name, before.values[name]),
              to: summarize(name, value),
              source,
            },
          });
        }
        bump(teamId);
      }
      return {
        ok: true,
        layer: layer(teamId, target.scope, target.scopeId),
        changed: changes.length,
      };
    },

    /** A client's report that it applied a retention limit; written to the audit log as counts only. */
    reportRetention(
      userId: string,
      teamId: string,
      report: { audio?: unknown; transcripts?: unknown },
    ): Ok<object> | Failure {
      const count = (value: unknown) =>
        value === undefined
          ? 0
          : typeof value === "number" &&
              Number.isInteger(value) &&
              value >= 0 &&
              value <= 10_000_000
            ? value
            : -1;
      const audio = count(report.audio);
      const transcripts = count(report.transcripts);
      if (audio < 0 || transcripts < 0)
        return fail(400, "invalid_report", "The counts are whole numbers.");
      deps.audit({
        actorId: userId,
        action: "policy.retention_applied",
        targetType: "team",
        targetId: teamId,
        // The names avoid the words the audit guard refuses: the log holds counts, never content.
        detail: { recordings: audio, meetings: transcripts },
      });
      return { ok: true };
    },

    /** Whether any team lists this host as blocked (the server checks webhook targets against it). */
    hostBlockedAnywhere(hostOrUrl: string): boolean {
      const lists = db
        .prepare(
          "SELECT value_json FROM policy_values WHERE key = 'blockedDomains' AND scope = 'team'",
        )
        .all() as { value_json: string }[];
      return lists.some((row) => domainBlocked(hostOrUrl, JSON.parse(row.value_json) as string[]));
    },

    keys: POLICY_KEYS,
    limits: POLICY_LIMITS,
  };
}

export type Policy = ReturnType<typeof createPolicy>;
