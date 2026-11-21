import type { DatabaseSync } from "node:sqlite";
import {
  SEGMENT_TEXT_MAX,
  type Correction,
  type MeetingChannel,
  type RevertResult,
  type SegmentHistoryItem,
} from "@murmur/shared";
import type { SpeakersStore } from "./speakers-store";

/** A transcript line as stored. */
interface SegmentRow {
  id: string;
  meeting_id: string;
  channel: MeetingChannel;
  start_ms: number;
  end_ms: number;
  text: string;
  language: string | null;
  speaker_id: string | null;
  is_dictated: number;
  is_final: number;
  created_at: number;
  edited: number;
}

/** What a correction did, for the caller. */
export type Applied =
  | { ok: true; segmentId: string; changed: boolean; before?: string; after?: string }
  | { ok: false; message: string };

/**
 * Corrections to a transcript (NT-24): the text of a line, who said it, a line cut in two, two
 * lines joined. Every change keeps the lines as they were, so taking it back puts them back
 * exactly. Only the newest change of a line can be taken back first, so changes never overwrite
 * each other.
 */
export interface CorrectionsStore {
  apply(meetingId: string, correction: Correction): Applied;
  /** The corrections of a line, newest first. */
  history(meetingId: string, segmentId: string): SegmentHistoryItem[];
  revert(meetingId: string, correctionId: number): RevertResult;
}

const COLUMNS =
  "id, meeting_id, channel, start_ms, end_ms, text, language, speaker_id, is_dictated, is_final, created_at, edited";

export function createCorrectionsStore(
  db: DatabaseSync,
  deps: { now(): number; speakers: Pick<SpeakersStore, "list" | "add"> },
): CorrectionsStore {
  const row = (meetingId: string, id: string) =>
    db
      .prepare(`SELECT ${COLUMNS} FROM meeting_segments WHERE meeting_id = ? AND id = ?`)
      .get(meetingId, id) as unknown as SegmentRow | undefined;

  const put = (r: SegmentRow) =>
    db
      .prepare(
        `INSERT OR REPLACE INTO meeting_segments
           (id, meeting_id, channel, start_ms, end_ms, text, language, speaker_id, is_dictated, is_final, created_at, edited)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        r.id,
        r.meeting_id,
        r.channel,
        r.start_ms,
        r.end_ms,
        r.text,
        r.language,
        r.speaker_id,
        r.is_dictated,
        r.is_final,
        r.created_at,
        r.edited,
      );

  const record = (
    meetingId: string,
    kind: "text" | "speaker" | "split" | "merge",
    before: SegmentRow[],
    afterIds: string[],
  ) =>
    db
      .prepare(
        `INSERT INTO transcript_corrections (meeting_id, kind, before_json, after_ids_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(meetingId, kind, JSON.stringify(before), JSON.stringify(afterIds), deps.now());

  /** In one transaction, so a correction is whole or not there. */
  const atomic = <T>(work: () => T): T => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  const spoken = (segment: SegmentRow | undefined): segment is SegmentRow =>
    !!segment && segment.is_dictated === 0;

  const GONE = "That line is gone.";

  return {
    apply(meetingId, correction) {
      const segment = row(meetingId, correction.segmentId);
      if (!spoken(segment)) return { ok: false, message: GONE };

      if (correction.kind === "text") {
        const text = correction.text.replace(/[ \t]+/g, " ").trim();
        if (text === "") return { ok: false, message: "A line cannot be empty." };
        if (text.length > SEGMENT_TEXT_MAX)
          return { ok: false, message: `A line can be up to ${SEGMENT_TEXT_MAX} characters.` };
        if (text === segment.text) return { ok: true, segmentId: segment.id, changed: false };
        atomic(() => {
          record(meetingId, "text", [segment], [segment.id]);
          put({ ...segment, text, edited: segment.edited + 1 });
        });
        return {
          ok: true,
          segmentId: segment.id,
          changed: true,
          before: segment.text,
          after: text,
        };
      }

      if (correction.kind === "speaker") {
        const speakers = deps.speakers.list(meetingId);
        const current = segment.speaker_id ?? `${meetingId}:${segment.channel}`;
        let target: string | undefined = correction.speakerId;
        if (target === undefined) {
          if (!correction.newName || correction.newName.trim() === "")
            return { ok: false, message: "Choose a speaker or write a name." };
        } else if (!speakers.some((speaker) => speaker.id === target)) {
          return { ok: false, message: "That speaker is not in this meeting." };
        }
        if (target === current) return { ok: true, segmentId: segment.id, changed: false };
        return atomic(() => {
          if (target === undefined) {
            const added = deps.speakers.add(meetingId, segment.channel, correction.newName!);
            if (!added.ok) return added;
            target = added.id;
          }
          record(meetingId, "speaker", [segment], [segment.id]);
          put({ ...segment, speaker_id: target!, edited: segment.edited + 1 });
          return { ok: true as const, segmentId: segment.id, changed: true };
        });
      }

      if (correction.kind === "split") {
        const left = segment.text.slice(0, correction.offset).trim();
        const right = segment.text.slice(correction.offset).trim();
        if (left === "" || right === "")
          return { ok: false, message: "Put the cursor inside the line, between two words." };
        if (segment.end_ms - segment.start_ms < 2)
          return { ok: false, message: "That line is too short to split." };
        // The cut falls where the same share of the line's time has passed.
        const share = correction.offset / segment.text.length;
        const cut = Math.min(
          segment.end_ms - 1,
          Math.max(
            segment.start_ms + 1,
            segment.start_ms + Math.round((segment.end_ms - segment.start_ms) * share),
          ),
        );
        const second: SegmentRow = {
          ...segment,
          id: "",
          text: right,
          start_ms: cut,
          edited: segment.edited + 1,
        };
        return atomic(() => {
          const info = record(meetingId, "split", [segment], []);
          // The first half keeps the id; the second is named after the correction.
          second.id = `${segment.id}+${info.lastInsertRowid}`;
          db.prepare("UPDATE transcript_corrections SET after_ids_json = ? WHERE id = ?").run(
            JSON.stringify([segment.id, second.id]),
            info.lastInsertRowid,
          );
          put({ ...segment, text: left, end_ms: cut, edited: segment.edited + 1 });
          put(second);
          return { ok: true as const, segmentId: segment.id, changed: true };
        });
      }

      // merge: with the next line of the same channel and speaker.
      const next = db
        .prepare(
          `SELECT ${COLUMNS} FROM meeting_segments
           WHERE meeting_id = ? AND channel = ? AND is_dictated = 0
             AND (start_ms > ? OR (start_ms = ? AND id > ?))
           ORDER BY start_ms, id LIMIT 1`,
        )
        .get(
          meetingId,
          segment.channel,
          segment.start_ms,
          segment.start_ms,
          segment.id,
        ) as unknown as SegmentRow | undefined;
      if (!next) return { ok: false, message: "There is no next line to join." };
      if ((next.speaker_id ?? "") !== (segment.speaker_id ?? ""))
        return { ok: false, message: "The next line is by another speaker." };
      return atomic(() => {
        record(meetingId, "merge", [segment, next], [segment.id]);
        db.prepare("DELETE FROM meeting_segments WHERE meeting_id = ? AND id = ?").run(
          meetingId,
          next.id,
        );
        put({
          ...segment,
          text: `${segment.text} ${next.text}`.slice(0, SEGMENT_TEXT_MAX),
          end_ms: Math.max(segment.end_ms, next.end_ms),
          edited: Math.max(segment.edited, next.edited) + 1,
        });
        return { ok: true as const, segmentId: segment.id, changed: true };
      });
    },

    history(meetingId, segmentId) {
      const rows = db
        .prepare(
          `SELECT id, kind, before_json, after_ids_json, created_at FROM transcript_corrections
           WHERE meeting_id = ? ORDER BY id DESC`,
        )
        .all(meetingId) as {
        id: number;
        kind: "text" | "speaker" | "split" | "merge";
        before_json: string;
        after_ids_json: string;
        created_at: number;
      }[];
      const names = new Map(deps.speakers.list(meetingId).map((s) => [s.id, s.name]));
      const items: SegmentHistoryItem[] = [];
      // Newest first: a correction can be taken back only if no newer one used its lines.
      const consumed = new Set<string>();
      for (const item of rows) {
        const after = JSON.parse(item.after_ids_json) as string[];
        const before = JSON.parse(item.before_json) as SegmentRow[];
        if (after.includes(segmentId)) {
          const first = before[0]!;
          items.push({
            id: item.id,
            kind: item.kind,
            createdAt: item.created_at,
            original:
              item.kind === "speaker"
                ? (names.get(first.speaker_id ?? `${meetingId}:${first.channel}`) ??
                  (first.channel === "mic" ? "You" : "Remote"))
                : before.map((r) => r.text).join(" "),
            canRevert: !after.some((id) => consumed.has(id)),
          });
        }
        for (const r of before) consumed.add(r.id);
      }
      return items;
    },

    revert(meetingId, correctionId) {
      const found = db
        .prepare(
          `SELECT id, before_json, after_ids_json FROM transcript_corrections
           WHERE meeting_id = ? AND id = ?`,
        )
        .get(meetingId, correctionId) as
        { id: number; before_json: string; after_ids_json: string } | undefined;
      if (!found) return { ok: false, message: "That correction is already gone." };
      const after = JSON.parse(found.after_ids_json) as string[];
      const before = JSON.parse(found.before_json) as SegmentRow[];
      // A newer correction that used one of these lines must be taken back first.
      const newer = db
        .prepare("SELECT before_json FROM transcript_corrections WHERE meeting_id = ? AND id > ?")
        .all(meetingId, found.id) as { before_json: string }[];
      const blocked = newer.some((item) =>
        (JSON.parse(item.before_json) as SegmentRow[]).some((r) => after.includes(r.id)),
      );
      if (blocked) return { ok: false, message: "Take back the later change to this line first." };
      atomic(() => {
        for (const id of after) {
          db.prepare("DELETE FROM meeting_segments WHERE meeting_id = ? AND id = ?").run(
            meetingId,
            id,
          );
        }
        for (const r of before) put(r);
        db.prepare("DELETE FROM transcript_corrections WHERE id = ?").run(found.id);
      });
      return { ok: true };
    },
  };
}
