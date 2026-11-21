import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  DELETE_CATEGORIES,
  type DataCounts,
  type DeleteCategory,
  type DeleteResult,
} from "@murmur/shared";
import type { HistoryStore } from "../history/history-store";
import { sizeOf } from "./storage";

export interface DataDeleterDeps {
  db: DatabaseSync;
  history: HistoryStore;
  /** `<data>/notes`: note images, one folder per note. */
  notesRoot: string;
  /** `<data>/audio`. */
  audioRoot: string;
  /** Pronunciation clips live with the Dictionary. */
  clipsRoot: string | null;
  /** `<data>/meetings`: one folder of audio chunks per meeting (NT-04). */
  meetingsRoot: string;
}

export interface DataDeleter {
  counts(): DataCounts;
  delete(category: DeleteCategory): DeleteResult;
  /** HB-47 "Delete all data and reset": every category, Rewrites and settings too. */
  deleteAll(): DeleteResult;
  /** Tries again to remove files a delete could not. */
  retryFailed(): number;
}

const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;

/** The four default styles, as migration 0005 made them. */
const DEFAULT_STYLES: [string, string, string, string, string][] = [
  ["style-personal", "no-caps-less", "none", "light", "normal"],
  ["style-work", "caps", "standard", "full", "normal"],
  ["style-email", "formal", "standard", "full", "normal"],
  ["style-other", "caps", "standard", "full", "normal"],
];

/**
 * HB-47: deletes one category at a time; each in one transaction, files after it commits.
 * A file that cannot be removed is kept on a list for a retry. Deleting one category never
 * touches another (Dictations leave Dictionary and Snippets alone).
 */
export function createDataDeleter(deps: DataDeleterDeps): DataDeleter {
  const { db } = deps;
  const failed = new Set<string>();

  function inTransaction(statements: string[]): number {
    let rows = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const sql of statements) rows += Number(db.prepare(sql).run().changes);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return rows;
  }

  /** Removes everything inside a folder, keeping the folder. Returns files removed. */
  function emptyFolder(folder: string | null): number {
    if (!folder || !existsSync(folder)) return 0;
    let removed = 0;
    for (const entry of readdirSync(folder)) {
      const target = path.join(folder, entry);
      try {
        rmSync(target, { recursive: true, force: true });
        removed += 1;
      } catch {
        failed.add(target);
      }
    }
    return removed;
  }

  function byCategory(category: DeleteCategory): DeleteResult {
    switch (category) {
      case "dictations": {
        const ids = (db.prepare("SELECT id FROM history").all() as { id: string }[]).map(
          (row) => row.id,
        );
        let rows = 0;
        let files = 0;
        for (let start = 0; start < ids.length; start += 500) {
          const result = deps.history.remove(ids.slice(start, start + 500));
          rows += result.rows;
          files += result.files;
        }
        rows += inTransaction([
          "DELETE FROM rewrite_runs",
          "DELETE FROM command_runs",
          "DELETE FROM pending_sessions",
        ]);
        return { rows, files, failedFiles: failed.size };
      }
      case "audio": {
        const result = deps.history.clearAudio();
        return { rows: result.rows, files: result.files, failedFiles: failed.size };
      }
      case "dictionary": {
        const rows = inTransaction(["DELETE FROM dictionary", "DELETE FROM phrase_counts"]);
        return { rows, files: emptyFolder(deps.clipsRoot), failedFiles: failed.size };
      }
      case "snippets":
        return {
          rows: inTransaction(["DELETE FROM snippets"]),
          files: 0,
          failedFiles: failed.size,
        };
      case "styles": {
        let rows = inTransaction([
          "DELETE FROM app_categories WHERE source != 'default'",
          "DELETE FROM writing_samples",
        ]);
        const reset = db.prepare(
          `UPDATE styles SET preset = ?, capitalisation = ?, punctuation = ?, emphasis = ?,
            instructions = NULL WHERE id = ?`,
        );
        for (const [id, preset, caps, punctuation, emphasis] of DEFAULT_STYLES) {
          rows += Number(reset.run(preset, caps, punctuation, emphasis, id).changes);
        }
        return { rows, files: 0, failedFiles: failed.size };
      }
      case "memory":
        return {
          rows: inTransaction(["DELETE FROM memory_items"]),
          files: 0,
          failedFiles: failed.size,
        };
      case "voiceProfile":
        return {
          rows: inTransaction(["DELETE FROM voice_samples", "DELETE FROM voice_profiles"]),
          files: 0,
          failedFiles: failed.size,
        };
      case "notes": {
        const rows = inTransaction(["DELETE FROM notes"]);
        return { rows, files: emptyFolder(deps.notesRoot), failedFiles: failed.size };
      }
      case "instruct":
        return {
          rows: inTransaction(["DELETE FROM instruct_history", "DELETE FROM instruct_threads"]),
          files: 0,
          failedFiles: failed.size,
        };
      case "insights": {
        const rows = inTransaction(["DELETE FROM insights_daily", "DELETE FROM milestones"]);
        // History is not counted again, and what is reached from now on is announced.
        const mark = db.prepare(
          "INSERT INTO insights_meta (key, value) VALUES (?, '1') ON CONFLICT(key) DO NOTHING",
        );
        mark.run("backfilled");
        mark.run("milestones.seeded");
        return { rows, files: 0, failedFiles: failed.size };
      }
      case "learnedCandidates":
        return {
          rows: inTransaction(["DELETE FROM learn_candidates"]),
          files: 0,
          failedFiles: failed.size,
        };
      case "meetings": {
        // Chunk rows go with their meeting (ON DELETE CASCADE).
        const rows = inTransaction(["DELETE FROM meetings"]);
        return { rows, files: emptyFolder(deps.meetingsRoot), failedFiles: failed.size };
      }
    }
  }

  return {
    counts() {
      const sizes: Partial<Record<DeleteCategory, number>> = {
        audio: sizeOf(deps.audioRoot),
        notes: sizeOf(deps.notesRoot),
        dictionary: deps.clipsRoot ? sizeOf(deps.clipsRoot) : 0,
        meetings: sizeOf(deps.meetingsRoot),
      };
      const counts: Record<DeleteCategory, number> = {
        dictations: count(db, "SELECT COUNT(*) AS n FROM history"),
        audio: count(db, "SELECT COUNT(*) AS n FROM history WHERE audio_path IS NOT NULL"),
        dictionary: count(db, "SELECT COUNT(*) AS n FROM dictionary"),
        snippets: count(db, "SELECT COUNT(*) AS n FROM snippets"),
        styles:
          count(db, "SELECT COUNT(*) AS n FROM app_categories WHERE source != 'default'") +
          count(db, "SELECT COUNT(*) AS n FROM writing_samples") +
          count(
            db,
            "SELECT COUNT(*) AS n FROM styles WHERE instructions IS NOT NULL AND instructions != ''",
          ),
        memory: count(db, "SELECT COUNT(*) AS n FROM memory_items"),
        voiceProfile: count(db, "SELECT COUNT(*) AS n FROM voice_samples"),
        notes: count(db, "SELECT COUNT(*) AS n FROM notes"),
        instruct: count(db, "SELECT COUNT(*) AS n FROM instruct_threads"),
        insights:
          count(db, "SELECT COUNT(*) AS n FROM insights_daily") +
          count(db, "SELECT COUNT(*) AS n FROM milestones"),
        learnedCandidates: count(db, "SELECT COUNT(*) AS n FROM learn_candidates"),
        meetings: count(db, "SELECT COUNT(*) AS n FROM meetings"),
      };
      return {
        categories: DELETE_CATEGORIES.map((category) => ({
          category,
          count: counts[category],
          bytes: sizes[category] ?? 0,
        })),
        failedFiles: failed.size,
      };
    },
    delete: byCategory,
    deleteAll() {
      const total = { rows: 0, files: 0, failedFiles: 0 };
      for (const category of DELETE_CATEGORIES) {
        const result = byCategory(category);
        total.rows += result.rows;
        total.files += result.files;
      }
      total.rows += inTransaction([
        "DELETE FROM rewrites WHERE builtin_key IS NULL",
        "DELETE FROM focus_rules",
        "DELETE FROM focus_sessions",
        "DELETE FROM retention_jobs",
        "DELETE FROM insights_meta",
        "DELETE FROM settings",
      ]);
      total.files += emptyFolder(deps.audioRoot);
      total.failedFiles = failed.size;
      return total;
    },
    retryFailed() {
      for (const target of [...failed]) {
        try {
          rmSync(target, { recursive: true, force: true });
          failed.delete(target);
        } catch {
          // Still there; it stays on the list.
        }
      }
      return failed.size;
    },
  };
}
