import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CommandId, CommandOutcome, CommandTrigger } from "@murmur/shared";

export type CommandTarget = "selection" | "last_dictation" | "none";

export interface CommandRunInput {
  /** What was said, after the wake phrase. */
  phrase: string;
  commandId: CommandId | null;
  language: string | null;
  trigger: CommandTrigger;
  matchedBy: "rule" | "model" | null;
  target: CommandTarget;
  /** The text acted on, and the text that replaced it (for undo, RW-10). */
  sourceText: string | null;
  outputText: string | null;
  outcome: CommandOutcome;
  appBundleId: string | null;
  durationMs: number | null;
}

export interface CommandRun extends CommandRunInput {
  id: string;
  textTruncated: boolean;
  createdAt: number;
}

export interface CommandRunStore {
  record(run: CommandRunInput): string;
  /** Newest first. */
  recent(limit: number): CommandRun[];
  /** Cuts the text of runs older than 7 days to 200 characters. Returns how many. */
  trimOld(): number;
}

/** Text is kept whole this long, as for Rewrite runs. */
export const COMMAND_TEXT_DAYS = 7;
export const COMMAND_TEXT_KEEP_CHARS = 200;

interface Row {
  id: string;
  phrase: string;
  command_id: CommandId | null;
  language: string | null;
  trigger: CommandTrigger;
  matched_by: "rule" | "model" | null;
  target: CommandTarget;
  source_text: string | null;
  output_text: string | null;
  text_truncated: number;
  outcome: CommandOutcome;
  app_bundle_id: string | null;
  created_at: number;
  duration_ms: number | null;
}

export function createCommandRunStore(
  db: DatabaseSync,
  now: () => number = Date.now,
  newId: () => string = randomUUID,
): CommandRunStore {
  const insert = db.prepare(
    `INSERT INTO command_runs (id, phrase, command_id, language, trigger, matched_by, target,
       source_text, output_text, outcome, app_bundle_id, created_at, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const recent = db.prepare(
    "SELECT * FROM command_runs ORDER BY created_at DESC, rowid DESC LIMIT ?",
  );
  const trim = db.prepare(
    `UPDATE command_runs SET source_text = substr(source_text, 1, ?),
       output_text = substr(output_text, 1, ?), text_truncated = 1
     WHERE text_truncated = 0 AND created_at < ?`,
  );
  return {
    record(run) {
      const id = newId();
      insert.run(
        id,
        run.phrase,
        run.commandId,
        run.language,
        run.trigger,
        run.matchedBy,
        run.target,
        run.sourceText,
        run.outputText,
        run.outcome,
        run.appBundleId,
        now(),
        run.durationMs,
      );
      return id;
    },
    recent(limit) {
      return (recent.all(limit) as unknown as Row[]).map((row) => ({
        id: row.id,
        phrase: row.phrase,
        commandId: row.command_id,
        language: row.language,
        trigger: row.trigger,
        matchedBy: row.matched_by,
        target: row.target,
        sourceText: row.source_text,
        outputText: row.output_text,
        textTruncated: row.text_truncated === 1,
        outcome: row.outcome,
        appBundleId: row.app_bundle_id,
        createdAt: row.created_at,
        durationMs: row.duration_ms,
      }));
    },
    trimOld() {
      const cutoff = now() - COMMAND_TEXT_DAYS * 24 * 60 * 60_000;
      return Number(trim.run(COMMAND_TEXT_KEEP_CHARS, COMMAND_TEXT_KEEP_CHARS, cutoff).changes);
    },
  };
}
