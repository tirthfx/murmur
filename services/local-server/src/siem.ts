import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AuditEvent } from "./audit.ts";
import type { Settings } from "./settings.ts";

/**
 * SIEM streaming (TM-12), simulated: each new audit entry is written as a JSON line to a file, or
 * posted to a webhook on this machine or the local network. It is real only for a receiver the
 * owner runs. Delivery is tried three times with a growing wait; after that the entry stays in
 * the queue, marked failed, until someone retries it.
 */
export type SiemMode = "off" | "file" | "webhook";
export interface SiemConfig {
  mode: SiemMode;
  webhookUrl: string;
}

export const SIEM_DEFAULTS: SiemConfig = { mode: "off", webhookUrl: "" };
export const MAX_ATTEMPTS = 3;
/** The wait after the first and the second failed try. */
export const BACKOFF_MS = [1_000, 5_000] as const;

/** A web address on this machine or a private network: where a webhook may point. */
export function isLocalUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".localhost")
  )
    return true;
  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts as [number, number, number, number];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return false;
}

export interface SiemDeps {
  db: DatabaseSync;
  settings: Settings;
  now(): number;
  /** The file used in file mode. */
  filePath: string;
  /** Sends one line to the webhook; throws or returns a status that is not 2xx on failure. */
  post?(url: string, line: string): Promise<number>;
  append?(path: string, line: string): Promise<void>;
}

const defaultPost = async (url: string, line: string): Promise<number> => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: line,
    signal: AbortSignal.timeout(5_000),
    redirect: "error",
  });
  return res.status;
};

const defaultAppend = async (path: string, line: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, line, { mode: 0o600 });
};

export function createSiem(deps: SiemDeps) {
  const { db } = deps;
  const post = deps.post ?? defaultPost;
  const append = deps.append ?? defaultAppend;
  let flushing: Promise<unknown> | null = null;

  const config = (): SiemConfig => ({
    mode: deps.settings.get<SiemMode>("team.audit.siem.mode", SIEM_DEFAULTS.mode),
    webhookUrl: deps.settings.get<string>("team.audit.siem.webhookUrl", SIEM_DEFAULTS.webhookUrl),
  });

  async function deliver(event: AuditEvent, current: SiemConfig): Promise<void> {
    const line = JSON.stringify(event);
    if (current.mode === "file") return append(deps.filePath, `${line}\n`);
    const status = await post(current.webhookUrl, line);
    if (status < 200 || status >= 300) throw new Error(`The receiver answered ${status}.`);
  }

  async function run(): Promise<{ sent: number; failed: number }> {
    const current = config();
    if (current.mode === "off") return { sent: 0, failed: 0 };
    const due = db
      .prepare(
        `SELECT q.seq, q.attempts, e.* FROM siem_queue q JOIN audit_events e ON e.seq = q.seq
         WHERE q.status = 'pending' AND q.next_attempt_at <= ? ORDER BY q.seq LIMIT 100`,
      )
      .all(deps.now()) as unknown as (AuditRow & { attempts: number })[];
    let sent = 0;
    let failed = 0;
    for (const row of due) {
      try {
        await deliver(toEvent(row), current);
        db.prepare("UPDATE siem_queue SET status = 'sent', last_error = '' WHERE seq = ?").run(
          row.seq,
        );
        sent++;
      } catch (error) {
        const attempts = row.attempts + 1;
        const message = (error instanceof Error ? error.message : "Delivery failed.").slice(0, 200);
        if (attempts >= MAX_ATTEMPTS) {
          db.prepare(
            "UPDATE siem_queue SET status = 'failed', attempts = ?, last_error = ? WHERE seq = ?",
          ).run(attempts, message, row.seq);
          failed++;
        } else {
          db.prepare(
            "UPDATE siem_queue SET attempts = ?, last_error = ?, next_attempt_at = ? WHERE seq = ?",
          ).run(attempts, message, deps.now() + (BACKOFF_MS[attempts - 1] ?? 5_000), row.seq);
        }
      }
    }
    return { sent, failed };
  }

  return {
    config,

    /** Changes the mode or the webhook address; false when the address is not a local one. */
    setConfig(next: Partial<SiemConfig>): { ok: true } | { ok: false; message: string } {
      const merged = { ...config(), ...next };
      if (!["off", "file", "webhook"].includes(merged.mode))
        return { ok: false, message: "The mode is off, file or webhook." };
      if (merged.mode === "webhook") {
        if (merged.webhookUrl === "") return { ok: false, message: "Write the webhook address." };
        if (!isLocalUrl(merged.webhookUrl))
          return {
            ok: false,
            message: "The webhook must be on this machine or the local network (http or https).",
          };
      }
      deps.settings.set("team.audit.siem.mode", merged.mode);
      deps.settings.set("team.audit.siem.webhookUrl", merged.webhookUrl);
      return { ok: true };
    },

    /** Puts a new entry in the queue when streaming is on. */
    enqueue(event: AuditEvent): void {
      if (config().mode === "off") return;
      db.prepare("INSERT OR IGNORE INTO siem_queue (seq, next_attempt_at) VALUES (?, 0)").run(
        event.seq,
      );
    },

    /** Sends what is due. One run at a time. */
    flush(): Promise<{ sent: number; failed: number }> {
      const next = (flushing ?? Promise.resolve()).then(run, run);
      flushing = next.catch(() => undefined);
      return next;
    },

    status() {
      const count = (status: string) =>
        (
          db.prepare("SELECT COUNT(*) AS n FROM siem_queue WHERE status = ?").get(status) as {
            n: number;
          }
        ).n;
      const failures = db
        .prepare(
          "SELECT seq, attempts, last_error FROM siem_queue WHERE status = 'failed' ORDER BY seq DESC LIMIT 20",
        )
        .all() as { seq: number; attempts: number; last_error: string }[];
      return {
        ...config(),
        pending: count("pending"),
        sent: count("sent"),
        failed: count("failed"),
        failures: failures.map((row) => ({
          seq: row.seq,
          attempts: row.attempts,
          error: row.last_error,
        })),
      };
    },

    /** Puts failed entries back in the queue to be tried again. */
    retryFailed(): number {
      return Number(
        db
          .prepare(
            "UPDATE siem_queue SET status = 'pending', attempts = 0, next_attempt_at = 0 WHERE status = 'failed'",
          )
          .run().changes,
      );
    },
  };
}

interface AuditRow {
  seq: number;
  ts: number;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  detail_json: string;
  client_id: string;
  prev_hash: string;
  hash: string;
}

const toEvent = (row: AuditRow): AuditEvent => ({
  seq: row.seq,
  ts: row.ts,
  actorId: row.actor_id,
  action: row.action,
  targetType: row.target_type,
  targetId: row.target_id,
  detail: JSON.parse(row.detail_json) as AuditEvent["detail"],
  clientId: row.client_id,
  prevHash: row.prev_hash,
  hash: row.hash,
});

export type Siem = ReturnType<typeof createSiem>;
