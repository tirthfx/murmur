import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  EMAIL_LIMITS,
  formatKb,
  type WritingSample,
  type WritingSampleInput,
  type WritingSampleSaveResult,
} from "@murmur/shared";

// Writing samples (PZ-20): the owner's own writing, for Rewrites (M3). Never used by cleanup.

export interface WritingSampleStore {
  list(): WritingSample[];
  save(input: WritingSampleInput): WritingSampleSaveResult;
  remove(id: string): void;
}

interface Row {
  id: string;
  label: string;
  text: string;
  created_at: number;
}

const toSample = (row: Row): WritingSample => ({
  id: row.id,
  label: row.label,
  text: row.text,
  bytes: Buffer.byteLength(row.text, "utf8"),
  createdAt: row.created_at,
});

export function createWritingSampleStore(
  db: DatabaseSync,
  now: () => number = Date.now,
  newId: () => string = randomUUID,
): WritingSampleStore {
  const all = db.prepare(
    "SELECT id, label, text, created_at FROM writing_samples ORDER BY created_at, id",
  );
  const count = db.prepare("SELECT count(*) AS n FROM writing_samples");
  const insert = db.prepare(
    "INSERT INTO writing_samples (id, label, text, created_at) VALUES (?, ?, ?, ?)",
  );
  const remove = db.prepare("DELETE FROM writing_samples WHERE id = ?");

  return {
    list: () => (all.all() as unknown as Row[]).map(toSample),

    save(input) {
      const label = input.label.trim();
      // Line endings kept as typed, apart from Windows ones.
      const text = input.text.replace(/\r\n?/g, "\n").trim();
      if (label === "") {
        return { ok: false, reason: "no-label", message: "Give the sample a label." };
      }
      if (label.length > EMAIL_LIMITS.labelChars) {
        return {
          ok: false,
          reason: "no-label",
          message: `A label can be up to ${EMAIL_LIMITS.labelChars} characters.`,
        };
      }
      if (text === "") return { ok: false, reason: "empty", message: "The sample is empty." };
      const bytes = Buffer.byteLength(text, "utf8");
      if (bytes > EMAIL_LIMITS.sampleBytes) {
        return {
          ok: false,
          reason: "too-large",
          message: `The sample is ${formatKb(bytes)}; samples can be up to ${formatKb(EMAIL_LIMITS.sampleBytes)}.`,
        };
      }
      if ((count.get() as { n: number }).n >= EMAIL_LIMITS.samples) {
        return {
          ok: false,
          reason: "full",
          message: `You can keep up to ${EMAIL_LIMITS.samples} samples. Delete one first.`,
        };
      }
      const row: Row = { id: newId(), label, text, created_at: now() };
      insert.run(row.id, row.label, row.text, row.created_at);
      return { ok: true, sample: toSample(row) };
    },

    remove(id) {
      remove.run(id);
    },
  };
}
