import type { DatabaseSync } from "node:sqlite";
import type { MeetingJobKind, Transcript } from "@murmur/shared";
import type { Logger } from "../helper/types";
import type { MeetingsStore } from "./meetings-store";
import type { TranscriptStore } from "./transcript-store";

export interface MeetingJobsDeps {
  db: DatabaseSync;
  meetings: MeetingsStore;
  transcripts: TranscriptStore;
  /**
   * Transcribes one chunk file, keeping its timing, in the meeting's language: `languages`
   * empty detects it, and `translate` writes the words in English (NT-20).
   */
  transcribe(
    path: string,
    options: { languages: string[]; translate: boolean },
  ): Promise<Transcript>;
  /** False while the speech model is missing or loading: jobs wait in the queue. */
  speechReady(): boolean;
  /** True while a dictation is recording or being transcribed: it goes first. */
  dictating(): boolean;
  now(): number;
  wait(ms: number): Promise<void>;
  /** A meeting's status or transcript changed. */
  onProgress(meetingId: string): void;
  /** A meeting has been transcribed to the end (NT-09 writes its summary next). */
  onTranscribed?(meetingId: string): void;
  /**
   * Writes the meeting's summary. Rejects with `code`: `model-missing` (wait for the model),
   * `busy` (another summary is being written: try again), `no-transcript` (nothing to do).
   */
  summarise?(meetingId: string): Promise<void>;
  /** The summary job finished (NT-26 suggests tasks next). */
  onSummarised?(meetingId: string): void;
  /**
   * Suggests the meeting's tasks (NT-26). Rejects with the same codes as `summarise`. A
   * returned `note` is kept in the job's log; the job still ends `done`.
   */
  extractTasks?(meetingId: string): Promise<{ note?: string } | void>;
  logger: Logger;
}

export interface MeetingJobs {
  enqueue(meetingId: string, kind: MeetingJobKind): void;
  /** Runs queued jobs unless they are already running. Safe to call often. */
  kick(): void;
  /**
   * At start: jobs a crash left running are queued again, and a meeting waiting for its
   * transcript with no job gets one. Returns how many jobs are queued.
   */
  resume(): number;
  /** The state of a meeting's job of this kind, or null when it has none. */
  jobStatus(
    meetingId: string,
    kind: MeetingJobKind,
  ): "queued" | "running" | "done" | "failed" | null;
  /** Resolves when the current run of the queue ends (tests). */
  idle(): Promise<void>;
}

/** A job is given up after this many failed runs. */
export const MAX_ATTEMPTS = 3;

const errorCode = (error: unknown) => (error as { code?: string } | null)?.code;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The Notetaker's work queue (NT-05). Transcription needs nothing but the local speech model:
 * a meeting recorded with no model stays `queued` and is transcribed once the model is
 * ready, with no action from the owner. Each chunk is written when done, so an interrupted
 * job carries on from the next chunk.
 */
export function createMeetingJobs(deps: MeetingJobsDeps): MeetingJobs {
  const { db } = deps;
  let running: Promise<void> | null = null;

  const setJob = (meetingId: string, kind: MeetingJobKind, status: string, error?: string) =>
    db
      .prepare(
        `UPDATE meeting_jobs SET status = ?, last_error = COALESCE(?, last_error), updated_at = ?
         WHERE meeting_id = ? AND kind = ?`,
      )
      .run(status, error ?? null, deps.now(), meetingId, kind);

  function next(
    skip: ReadonlySet<MeetingJobKind> = new Set(),
  ): { meetingId: string; kind: MeetingJobKind; attempts: number } | null {
    const rows = db
      .prepare(
        `SELECT meeting_id, kind, attempts FROM meeting_jobs
         WHERE status = 'queued' ORDER BY created_at, rowid`,
      )
      .all() as { meeting_id: string; kind: MeetingJobKind; attempts: number }[];
    const row = rows.find((candidate) => !skip.has(candidate.kind));
    return row ? { meetingId: row.meeting_id, kind: row.kind, attempts: row.attempts } : null;
  }

  /** Returns false when the job should wait (no model yet), true when it ran or failed. */
  async function transcribe(meetingId: string, attempts: number): Promise<boolean> {
    db.prepare(
      `UPDATE meeting_jobs SET status = 'running', attempts = attempts + 1, updated_at = ?
       WHERE meeting_id = ? AND kind = 'transcribe'`,
    ).run(deps.now(), meetingId);
    if (deps.meetings.get(meetingId)?.status !== "recording") {
      deps.meetings.setStatus(meetingId, "processing");
    }
    deps.onProgress(meetingId);
    // How this meeting is transcribed is read for each chunk, so a change while it records
    // applies from the next chunk (NT-20).
    try {
      // Chunks keep arriving while a meeting records: drain until none is left.
      for (
        let pending = deps.transcripts.pendingChunks(meetingId);
        pending.length > 0;
        pending = deps.transcripts.pendingChunks(meetingId)
      )
        for (const chunk of pending) {
          while (deps.dictating()) await deps.wait(500);
          const meeting = deps.meetings.get(meetingId);
          let transcript: Transcript;
          try {
            transcript = await deps.transcribe(chunk.path, {
              languages: meeting?.language ? [meeting.language] : [],
              translate: meeting?.translate ?? false,
            });
          } catch (error) {
            // A chunk file removed by hand: nothing to read, so move on.
            if (errorCode(error) !== "NOT_FOUND") throw error;
            deps.logger.warn(`a chunk of meeting ${meetingId} is missing; skipped`);
            transcript = { text: "", language: "", segments: [] } as unknown as Transcript;
          }
          deps.transcripts.addChunkSegments(
            chunk,
            transcript.segments.map((segment) => ({
              channel: chunk.channel,
              startMs: chunk.startMs + segment.startMs,
              endMs: chunk.startMs + segment.endMs,
              text: segment.text,
              language: transcript.language || null,
            })),
            deps.now(),
          );
          deps.onProgress(meetingId);
        }
      setJob(meetingId, "transcribe", "done");
      if (deps.meetings.get(meetingId)?.status !== "recording") {
        deps.meetings.setStatus(meetingId, "ready");
      }
      deps.onProgress(meetingId);
      deps.onTranscribed?.(meetingId);
      return true;
    } catch (error) {
      const code = errorCode(error);
      if (code === "MODEL_NOT_READY" || code === "MODEL_MISSING" || code === "HELPER_UNAVAILABLE") {
        // Not a failure: the meeting waits for the model, and the try does not count.
        db.prepare(
          `UPDATE meeting_jobs SET status = 'queued', attempts = attempts - 1, updated_at = ?
           WHERE meeting_id = ? AND kind = 'transcribe'`,
        ).run(deps.now(), meetingId);
        deps.meetings.setStatus(meetingId, "queued");
        deps.onProgress(meetingId);
        return false;
      }
      const failed = attempts + 1 >= MAX_ATTEMPTS;
      deps.logger.warn(
        `transcribing meeting ${meetingId} failed (try ${attempts + 1}): ${message(error)}`,
      );
      setJob(meetingId, "transcribe", failed ? "failed" : "queued", message(error).slice(0, 500));
      deps.meetings.setStatus(meetingId, failed ? "failed" : "queued");
      deps.onProgress(meetingId);
      // A failure waits for the next kick rather than spinning on the same chunk.
      return false;
    }
  }

  /**
   * Runs a job that needs the language model (a summary, the tasks). Returns false when the job
   * has to wait for a later kick.
   */
  async function modelJob(
    kind: "summarise" | "extract_tasks",
    meetingId: string,
    attempts: number,
    work: () => Promise<{ note?: string } | void>,
  ): Promise<boolean> {
    setJobRunning(meetingId, kind);
    deps.onProgress(meetingId);
    try {
      const result = await work();
      setJob(meetingId, kind, "done", result?.note?.slice(0, 500));
      if (kind === "summarise") deps.onSummarised?.(meetingId);
      deps.onProgress(meetingId);
      return true;
    } catch (error) {
      const code = errorCode(error);
      if (code === "no-transcript") {
        setJob(meetingId, kind, "done");
        deps.onProgress(meetingId);
        return true;
      }
      if (code === "model-missing" || code === "busy") {
        // Not a failure: it waits for the model, or for the work already going on.
        db.prepare(
          `UPDATE meeting_jobs SET status = 'queued', attempts = attempts - 1, updated_at = ?
           WHERE meeting_id = ? AND kind = ?`,
        ).run(deps.now(), meetingId, kind);
        deps.onProgress(meetingId);
        return false;
      }
      const failed = attempts + 1 >= MAX_ATTEMPTS;
      deps.logger.warn(
        `job ${kind} of meeting ${meetingId} failed (try ${attempts + 1}): ${message(error)}`,
      );
      setJob(meetingId, kind, failed ? "failed" : "queued", message(error).slice(0, 500));
      deps.onProgress(meetingId);
      return false;
    }
  }

  const setJobRunning = (meetingId: string, kind: MeetingJobKind) =>
    db
      .prepare(
        `UPDATE meeting_jobs SET status = 'running', attempts = attempts + 1, updated_at = ?
         WHERE meeting_id = ? AND kind = ?`,
      )
      .run(deps.now(), meetingId, kind);

  async function run(): Promise<void> {
    // A kind that has to wait must not hold back the others queued after it.
    const waiting = new Set<MeetingJobKind>();
    for (;;) {
      const job = next(waiting);
      if (!job) return;
      if (job.kind === "transcribe") {
        if (!deps.speechReady()) {
          waiting.add("transcribe");
          continue;
        }
        if (!(await transcribe(job.meetingId, job.attempts))) waiting.add("transcribe");
      } else if (job.kind === "summarise" && deps.summarise) {
        const write = deps.summarise;
        if (!(await modelJob("summarise", job.meetingId, job.attempts, () => write(job.meetingId))))
          waiting.add("summarise");
      } else if (job.kind === "extract_tasks" && deps.extractTasks) {
        const find = deps.extractTasks;
        if (
          !(await modelJob("extract_tasks", job.meetingId, job.attempts, () => find(job.meetingId)))
        )
          waiting.add("extract_tasks");
      } else {
        // Later issues add the other kinds; until then they are left queued.
        waiting.add(job.kind);
      }
    }
  }

  function enqueue(meetingId: string, kind: MeetingJobKind): void {
    const now = deps.now();
    db.prepare(
      `INSERT INTO meeting_jobs (meeting_id, kind, status, created_at, updated_at)
       VALUES (?, ?, 'queued', ?, ?)
       ON CONFLICT (meeting_id, kind) DO UPDATE SET status = 'queued', attempts = 0,
         last_error = NULL, updated_at = excluded.updated_at`,
    ).run(meetingId, kind, now, now);
  }

  return {
    enqueue,
    kick() {
      if (running) return;
      running = run()
        .catch((error: unknown) => deps.logger.warn(`meeting jobs stopped: ${message(error)}`))
        .finally(() => {
          running = null;
        });
    },
    resume() {
      db.prepare(
        "UPDATE meeting_jobs SET status = 'queued', updated_at = ? WHERE status = 'running'",
      ).run(deps.now());
      for (const status of ["queued", "processing"] as const) {
        for (const id of deps.meetings.withStatus(status)) {
          const has = db
            .prepare("SELECT 1 FROM meeting_jobs WHERE meeting_id = ? AND kind = 'transcribe'")
            .get(id);
          if (!has) enqueue(id, "transcribe");
          if (status === "processing") deps.meetings.setStatus(id, "queued");
        }
      }
      return (
        db.prepare("SELECT COUNT(*) AS n FROM meeting_jobs WHERE status = 'queued'").get() as {
          n: number;
        }
      ).n;
    },
    jobStatus(meetingId, kind) {
      const row = db
        .prepare("SELECT status FROM meeting_jobs WHERE meeting_id = ? AND kind = ?")
        .get(meetingId, kind) as { status: "queued" | "running" | "done" | "failed" } | undefined;
      return row?.status ?? null;
    },
    idle: () => running ?? Promise.resolve(),
  };
}
