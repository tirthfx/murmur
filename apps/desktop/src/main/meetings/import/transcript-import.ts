import { createHash } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  MeetingChannel,
  TranscriptImportConfirmInput,
  TranscriptImportConfirmResult,
  TranscriptImportPreview,
} from "@murmur/shared";
import type { SpeakersStore } from "../speakers-store";
import {
  IMPORT_FORMAT_TEXT,
  dateFromFileName,
  parseTranscriptFile,
  unsupported,
  type ParsedTranscript,
} from "./formats";

/** A file bigger than this is not a transcript. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
/** A meeting with the same title and a start within this long of the file's is a duplicate. */
export const DUPLICATE_WINDOW_MS = 2 * 60_000;

export interface TranscriptImportDeps {
  speakers: Pick<SpeakersStore, "add" | "rename">;
  newId(): string;
  now(): number;
  /** `<profile>/meetings`: the place a meeting's own files would go. */
  meetingsRoot: string;
  /** The owner's name: lines by this speaker are the microphone's ("You"). */
  ownerName(): string;
  /** Where an imported meeting goes: a folder id, or null for the Inbox. */
  folderId(): string | null;
}

export interface TranscriptImport {
  /** Reads a file and says what is in it. Creates nothing. */
  prepare(file: {
    name: string;
    bytes: Uint8Array;
    /** When the file was last changed: the meeting's date when the file has none. */
    modifiedAt: number;
  }): { ok: true; preview: TranscriptImportPreview } | { ok: false; message: string };
  /** Makes the meeting of a preview, in one transaction: all of it or none of it. */
  confirm(input: TranscriptImportConfirmInput): TranscriptImportConfirmResult;
  discard(token: string): void;
}

interface Pending {
  transcript: ParsedTranscript;
  hash: string;
  fileName: string;
  createdAt: number;
}

/** A preview is forgotten after this long. */
const PENDING_MS = 30 * 60_000;

const sameTitle = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** A title from the file's name: the name without its extension and its date. */
export function titleFromFileName(fileName: string): string {
  const base = path.basename(fileName).replace(/\.[^.]+$/, "");
  const words = base
    .replace(/GMT\d{8}-\d{6}/g, " ")
    .replace(/\d{4}-\d{2}-\d{2}(?:[ T_]\d{2}[.:-]\d{2})?/g, " ")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (words === "" ? base : words).slice(0, 200) || "Imported meeting";
}

/**
 * Meetings from transcript files (NT-21). A file is read and described first (format, date,
 * length, speakers, whether it is a duplicate) and nothing is created until the owner confirms.
 * The meeting has source `imported` and no audio; its speakers come from the file. A file that
 * is not a transcript, or one already imported, creates nothing.
 */
export function createTranscriptImport(
  db: DatabaseSync,
  deps: TranscriptImportDeps,
): TranscriptImport {
  const pending = new Map<string, Pending>();

  const forget = () => {
    const cutoff = deps.now() - PENDING_MS;
    for (const [token, item] of pending) if (item.createdAt < cutoff) pending.delete(token);
  };

  function duplicateOf(
    hash: string,
    title: string,
    startedAt: number,
  ): TranscriptImportPreview["duplicate"] {
    const byFile = db
      .prepare("SELECT id, title FROM meetings WHERE import_hash = ? LIMIT 1")
      .get(hash) as { id: string; title: string } | undefined;
    if (byFile) return { meetingId: byFile.id, title: byFile.title, reason: "same-file" };
    const near = db
      .prepare("SELECT id, title FROM meetings WHERE started_at BETWEEN ? AND ?")
      .all(startedAt - DUPLICATE_WINDOW_MS, startedAt + DUPLICATE_WINDOW_MS) as {
      id: string;
      title: string;
    }[];
    const wanted = sameTitle(title);
    const match = near.find((meeting) => sameTitle(meeting.title) === wanted);
    return match ? { meetingId: match.id, title: match.title, reason: "same-title" } : null;
  }

  return {
    prepare(file) {
      forget();
      if (file.bytes.length === 0 || file.bytes.length > MAX_IMPORT_BYTES) return unsupported();
      const text = new TextDecoder("utf-8").decode(file.bytes);
      // A binary file is not a transcript.
      if (text.includes("\u0000") || (text.match(/�/g)?.length ?? 0) > 20) return unsupported();
      const parsed = parseTranscriptFile(text, file.name);
      if (!parsed.ok) return parsed;
      const { transcript } = parsed;
      const hash = createHash("sha256").update(file.bytes).digest("hex");
      const title = transcript.title ?? titleFromFileName(file.name);
      const startedAt = transcript.startedAt ?? dateFromFileName(file.name) ?? file.modifiedAt;
      const durationMs = Math.max(...transcript.segments.map((segment) => segment.endMs));
      const speakers = [
        ...new Map(
          transcript.segments
            .map((segment) => segment.speaker)
            .filter((name): name is string => name !== null)
            .map((name) => [name.toLowerCase(), name]),
        ).values(),
      ];
      const token = deps.newId();
      pending.set(token, { transcript, hash, fileName: file.name, createdAt: deps.now() });
      return {
        ok: true,
        preview: {
          token,
          fileName: file.name,
          format: transcript.format,
          formatName: IMPORT_FORMAT_TEXT[transcript.format],
          title,
          startedAt,
          durationMs,
          lines: transcript.segments.length,
          speakers,
          timesEstimated: transcript.timesEstimated,
          duplicate: duplicateOf(hash, title, startedAt),
        },
      };
    },

    confirm(input) {
      forget();
      const item = pending.get(input.token);
      if (!item)
        return { ok: false, message: "That file is no longer ready to import. Choose it again." };
      const duplicate = duplicateOf(item.hash, input.title, input.startedAt);
      if (duplicate?.reason === "same-file")
        return { ok: false, message: `This file is already imported as “${duplicate.title}”.` };
      const id = deps.newId();
      const { segments } = item.transcript;
      const durationMs = Math.max(...segments.map((segment) => segment.endMs));
      const owner = deps.ownerName().trim().toLowerCase();
      const isOwner = (name: string | null) =>
        name !== null &&
        (name.toLowerCase() === "you" || (owner !== "" && name.toLowerCase() === owner));
      const channelOf = (name: string | null): MeetingChannel => (isOwner(name) ? "mic" : "system");
      const channels = [
        ...new Set(segments.map((segment) => channelOf(segment.speaker))),
      ].sort() as MeetingChannel[];
      const at = deps.now();

      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          `INSERT INTO meetings (id, title, started_at, ended_at, source, status, channels, duration_ms,
             folder, folder_id, import_hash)
           VALUES (?, ?, ?, ?, 'imported', 'ready', ?, ?, ?, ?, ?)`,
        ).run(
          id,
          input.title.slice(0, 200),
          input.startedAt,
          input.startedAt + durationMs,
          JSON.stringify(channels),
          durationMs,
          path.join(deps.meetingsRoot, id),
          deps.folderId(),
          item.hash,
        );
        // The speakers of the file: the owner on the microphone, the others as added speakers.
        const speakerOf = new Map<string, string | null>();
        for (const segment of segments) {
          const name = segment.speaker;
          if (name === null || speakerOf.has(name.toLowerCase())) continue;
          if (isOwner(name)) {
            if (name.toLowerCase() !== "you") deps.speakers.rename(id, `${id}:mic`, name);
            speakerOf.set(name.toLowerCase(), null);
          } else {
            const added = deps.speakers.add(id, "system", name);
            speakerOf.set(name.toLowerCase(), added.ok ? added.id : null);
          }
        }
        const insert = db.prepare(
          `INSERT INTO meeting_segments
             (id, meeting_id, channel, start_ms, end_ms, text, language, speaker_id, is_dictated, is_final, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 0, 1, ?)`,
        );
        segments.forEach((segment, index) => {
          insert.run(
            `${id}:imp:${index}`,
            id,
            channelOf(segment.speaker),
            segment.startMs,
            segment.endMs,
            segment.text,
            segment.speaker ? (speakerOf.get(segment.speaker.toLowerCase()) ?? null) : null,
            at,
          );
        });
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        return {
          ok: false,
          message: `The file could not be imported: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      pending.delete(input.token);
      return { ok: true, meetingId: id };
    },

    discard(token) {
      pending.delete(token);
    },
  };
}
