import type { DatabaseSync } from "node:sqlite";
import type { EmailAutomationRecord } from "@murmur/shared";

/**
 * What the draft automation made (NT-27): one row for each draft the owner confirmed. Only the
 * recipient, the subject and where the draft is in Gmail are kept; the text of the draft is not.
 * The row stays when the account is disconnected, and removing it never touches the Gmail draft.
 */
export interface AutomationsStore {
  /** Records a draft that was created. */
  addEmailDraft(input: {
    id: string;
    accountId: string;
    sourceKind: "task" | "meeting";
    sourceId: string;
    to: string;
    subject: string;
    draftId: string;
    openUrl: string;
    at: number;
  }): EmailAutomationRecord;
  /** The drafts made from a task or a meeting, newest first. */
  listEmailDrafts(source: { kind: "task" | "meeting"; id: string }): EmailAutomationRecord[];
  /** Forgets the record; the draft in Gmail is left alone. */
  remove(id: string): boolean;
}

interface Row {
  id: string;
  config_json: string;
  result_ref: string | null;
  open_url: string | null;
  created_at: number;
}

interface Config {
  sourceKind: "task" | "meeting";
  sourceId: string;
  to: string;
  subject: string;
}

const toRecord = (row: Row): EmailAutomationRecord => {
  const config = JSON.parse(row.config_json) as Config;
  return {
    id: row.id,
    sourceKind: config.sourceKind,
    sourceId: config.sourceId,
    to: config.to,
    subject: config.subject,
    draftId: row.result_ref ?? "",
    openUrl: row.open_url ?? "",
    createdAt: row.created_at,
  };
};

export function createAutomationsStore(db: DatabaseSync): AutomationsStore {
  return {
    addEmailDraft(input) {
      const config: Config = {
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        to: input.to,
        subject: input.subject,
      };
      db.prepare(
        `INSERT INTO automations
           (id, name, trigger_kind, action_kind, account_id, config_json, result_ref, open_url,
            enabled, last_run_at, last_status, created_at, updated_at)
         VALUES (?, ?, 'manual', 'draft_email', ?, ?, ?, ?, 0, ?, 'created', ?, ?)`,
      ).run(
        input.id,
        "Draft email",
        input.accountId,
        JSON.stringify(config),
        input.draftId,
        input.openUrl,
        input.at,
        input.at,
        input.at,
      );
      return toRecord({
        id: input.id,
        config_json: JSON.stringify(config),
        result_ref: input.draftId,
        open_url: input.openUrl,
        created_at: input.at,
      });
    },
    listEmailDrafts(source) {
      const rows = db
        .prepare(
          `SELECT id, config_json, result_ref, open_url, created_at FROM automations
           WHERE action_kind = 'draft_email'
             AND json_extract(config_json, '$.sourceKind') = ?
             AND json_extract(config_json, '$.sourceId') = ?
           ORDER BY created_at DESC, id DESC`,
        )
        .all(source.kind, source.id) as unknown as Row[];
      return rows.map(toRecord);
    },
    remove(id) {
      return db.prepare("DELETE FROM automations WHERE id = ?").run(id).changes > 0;
    },
  };
}
