import type { DatabaseSync } from "node:sqlite";

/** The rules a team sets for its shared vocabulary (TM-06 to TM-08). */
export const GOVERNANCE_MODES = ["open", "review", "locked"] as const;
export type GovernanceMode = (typeof GOVERNANCE_MODES)[number];
export const SNIPPET_VARIABLES = ["date", "me", "team"] as const;
export type SnippetVariable = (typeof SNIPPET_VARIABLES)[number];

export interface VocabularySettings {
  /** `open`: proposals go live at once; `review`: they wait; `locked`: only admins change anything. */
  governanceMode: GovernanceMode;
  /** How long earlier versions can be rolled back to. */
  rollbackRetentionDays: number;
  /** Where a new entry goes when its maker does not say. */
  defaultScope: "company" | "department";
  /** How often a client asks for the shared list. */
  syncMinutes: number;
  allowRichText: boolean;
  allowVariables: SnippetVariable[];
}

export const VOCABULARY_DEFAULTS: VocabularySettings = {
  governanceMode: "review",
  rollbackRetentionDays: 180,
  defaultScope: "department",
  syncMinutes: 5,
  allowRichText: true,
  allowVariables: ["date", "me", "team"],
};

const KEYS: Record<keyof VocabularySettings, string> = {
  governanceMode: "team.governance.mode",
  rollbackRetentionDays: "team.governance.rollbackRetentionDays",
  defaultScope: "team.dictionary.defaultScope",
  syncMinutes: "team.dictionary.syncMinutes",
  allowRichText: "team.snippets.allowRichText",
  allowVariables: "team.snippets.allowVariables",
};

/** The settings of one team, and their changes. */
export function createTeamSettings(db: DatabaseSync) {
  const read = (teamId: string, key: string): unknown => {
    const row = db
      .prepare("SELECT value_json FROM team_settings WHERE team_id = ? AND key = ?")
      .get(teamId, key) as { value_json: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value_json);
    } catch {
      return undefined;
    }
  };

  return {
    vocabulary(teamId: string): VocabularySettings {
      const get = <K extends keyof VocabularySettings>(name: K): VocabularySettings[K] => {
        const value = read(teamId, KEYS[name]);
        return (value === undefined ? VOCABULARY_DEFAULTS[name] : value) as VocabularySettings[K];
      };
      return {
        governanceMode: get("governanceMode"),
        rollbackRetentionDays: get("rollbackRetentionDays"),
        defaultScope: get("defaultScope"),
        syncMinutes: get("syncMinutes"),
        allowRichText: get("allowRichText"),
        allowVariables: get("allowVariables"),
      };
    },

    /** Checks and saves a change. Returns the changed names with old and new values, or a message. */
    setVocabulary(
      teamId: string,
      patch: Record<string, unknown>,
    ):
      | { ok: true; changed: Record<string, string | number | boolean> }
      | { ok: false; message: string } {
      const current = this.vocabulary(teamId);
      const next: Partial<VocabularySettings> = {};
      const changed: Record<string, string | number | boolean> = {};

      if (patch["governanceMode"] !== undefined) {
        if (!(GOVERNANCE_MODES as readonly unknown[]).includes(patch["governanceMode"]))
          return { ok: false, message: "The mode is open, review or locked." };
        next.governanceMode = patch["governanceMode"] as GovernanceMode;
      }
      if (patch["rollbackRetentionDays"] !== undefined) {
        const days = patch["rollbackRetentionDays"];
        if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 3650)
          return { ok: false, message: "Keep earlier versions for 1 to 3650 days." };
        next.rollbackRetentionDays = days;
      }
      if (patch["defaultScope"] !== undefined) {
        if (patch["defaultScope"] !== "company" && patch["defaultScope"] !== "department")
          return { ok: false, message: "The default scope is company or department." };
        next.defaultScope = patch["defaultScope"];
      }
      if (patch["syncMinutes"] !== undefined) {
        const minutes = patch["syncMinutes"];
        if (
          typeof minutes !== "number" ||
          !Number.isInteger(minutes) ||
          minutes < 1 ||
          minutes > 1440
        )
          return { ok: false, message: "Sync every 1 to 1440 minutes." };
        next.syncMinutes = minutes;
      }
      if (patch["allowRichText"] !== undefined) {
        if (typeof patch["allowRichText"] !== "boolean")
          return { ok: false, message: "Rich text is on or off." };
        next.allowRichText = patch["allowRichText"];
      }
      if (patch["allowVariables"] !== undefined) {
        const list = patch["allowVariables"];
        if (
          !Array.isArray(list) ||
          !list.every((name) => (SNIPPET_VARIABLES as readonly unknown[]).includes(name))
        )
          return { ok: false, message: `Variables can only be ${SNIPPET_VARIABLES.join(", ")}.` };
        next.allowVariables = [...new Set(list as SnippetVariable[])];
      }

      for (const name of Object.keys(next) as (keyof VocabularySettings)[]) {
        const value = next[name];
        if (JSON.stringify(value) === JSON.stringify(current[name])) continue;
        db.prepare(
          `INSERT INTO team_settings (team_id, key, value_json) VALUES (?, ?, ?)
           ON CONFLICT (team_id, key) DO UPDATE SET value_json = excluded.value_json`,
        ).run(teamId, KEYS[name], JSON.stringify(value));
        changed[name] = Array.isArray(value)
          ? value.join(",")
          : (value as string | number | boolean);
      }
      return { ok: true, changed };
    },
  };
}

export type TeamSettings = ReturnType<typeof createTeamSettings>;
