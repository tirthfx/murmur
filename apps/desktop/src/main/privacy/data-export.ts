import { existsSync, mkdirSync } from "node:fs";
import { copyFile, writeFile } from "node:fs/promises";
import { setImmediate as breathe } from "node:timers/promises";
import path from "node:path";
import {
  csvCell,
  EXPORT_FORMAT_VERSION,
  EXPORT_LABELS,
  insightsCsv,
  richToMarkdown,
  type DictionaryEntry,
  type ExportCategory,
  type HistoryRow,
  type InsightsDay,
  type InstructThread,
  type MemoryItem,
  type Note,
  type Rewrite,
  type Snippet,
  type StylesView,
} from "@murmur/shared";
import { noteFileName, writeNoteMarkdown, type ImageFiles } from "../notes/note-files";

export interface ExportedMeeting {
  title: string;
  startedAt: number;
  endedAt: number | null;
  attendees: unknown[];
  notes: string;
  summaries: unknown[];
  transcript: unknown[];
}

/** Where each category's data comes from. Each is read only when ticked. */
export interface ExportSources {
  dictations(): HistoryRow[];
  dictionary(): DictionaryEntry[];
  snippets(): Snippet[];
  styles(): StylesView;
  customRewrites(): Rewrite[];
  memory(): MemoryItem[];
  notes(): Note[];
  noteImages: ImageFiles;
  instructThreads(): InstructThread[];
  insights(): InsightsDay[];
  /** Each meeting with its notes, summaries and transcript. */
  meetings(): ExportedMeeting[];
  tasks(): unknown[];
  contacts(): unknown[];
  /** Kept recordings: absolute paths inside the audio folder. */
  audioFiles(): string[];
}

const iso = (epoch: number) => new Date(epoch).toISOString();

/** A file name that does not clash with one already used in the same folder. */
function unique(name: string, used: Set<string>): string {
  let candidate = name;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name} ${n}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

/** So many items are written before the app gets a turn. */
const BATCH = 20;

/**
 * HB-46: writes the ticked categories into `folder` and a generated `README.md` index with
 * each category's files, count and format version. Never writes model files or keys.
 * Returns the count per category.
 */
export async function writeExport(
  folder: string,
  categories: readonly ExportCategory[],
  sources: ExportSources,
  now: number,
  /** Called before each category, with how many are finished. */
  onProgress: (done: number, category: ExportCategory) => void = () => {},
): Promise<Record<string, number>> {
  mkdirSync(folder, { recursive: true });
  const counts: Record<string, number> = {};
  const files: Record<string, string> = {};
  const write = (name: string, text: string) => writeFile(path.join(folder, name), text);

  for (const [done, category] of categories.entries()) {
    onProgress(done, category);
    // The app stays usable while a large export runs.
    await breathe();
    switch (category) {
      case "dictations": {
        const rows = sources.dictations();
        await write(
          "dictations.json",
          `${JSON.stringify(
            rows.map((row) => ({
              createdAt: iso(row.createdAt),
              app: row.appName ?? row.appBundleId,
              status: row.status,
              language: row.language,
              durationMs: row.durationMs,
              words: row.wordCount,
              rawText: row.rawText,
              finalText: row.finalText,
              archived: row.archived,
            })),
            null,
            2,
          )}\n`,
        );
        counts.dictations = rows.length;
        files.dictations = "dictations.json";
        break;
      }
      case "dictionary": {
        const rows = sources.dictionary();
        const lines = ["term,replacement,starred,source,uses,case_sensitive"];
        for (const entry of rows) {
          lines.push(
            [
              entry.term,
              entry.replacement,
              entry.starred,
              entry.source,
              entry.useCount,
              entry.caseSensitive,
            ]
              .map(csvCell)
              .join(","),
          );
        }
        await write("dictionary.csv", `${lines.join("\n")}\n`);
        counts.dictionary = rows.length;
        files.dictionary = "dictionary.csv";
        break;
      }
      case "snippets": {
        const rows = sources.snippets();
        const parts = rows.map(
          (snippet) =>
            `## ${snippet.trigger}\n\n${(snippet.rich ? richToMarkdown(snippet.rich) : `${snippet.plain}\n`).trim()}\n`,
        );
        await write("snippets.md", `# Snippets\n\n${parts.join("\n")}`);
        counts.snippets = rows.length;
        files.snippets = "snippets.md";
        break;
      }
      case "stylesRewrites": {
        const styles = sources.styles();
        const rewrites = sources.customRewrites();
        await write(
          "styles-and-rewrites.json",
          `${JSON.stringify(
            {
              styles: styles.styles,
              appOverrides: styles.overrides,
              customRewrites: rewrites.map((rewrite) => ({
                name: rewrite.name,
                instruction: rewrite.instruction,
                example: rewrite.example,
                enabled: rewrite.enabled,
              })),
            },
            null,
            2,
          )}\n`,
        );
        counts.stylesRewrites = styles.styles.length + rewrites.length;
        files.stylesRewrites = "styles-and-rewrites.json";
        break;
      }
      case "memory": {
        const rows = sources.memory();
        await write(
          "memory.json",
          `${JSON.stringify(
            rows.map((item) => ({
              text: item.text,
              keywords: item.keywords,
              enabled: item.enabled,
              source: item.source,
              createdAt: iso(item.createdAt),
            })),
            null,
            2,
          )}\n`,
        );
        counts.memory = rows.length;
        files.memory = "memory.json";
        break;
      }
      case "notes": {
        const notesFolder = path.join(folder, "notes");
        mkdirSync(notesFolder, { recursive: true });
        const used = new Set<string>();
        const rows = sources.notes();
        for (const [index, note] of rows.entries()) {
          const name = unique(noteFileName(note), used);
          writeNoteMarkdown(note, path.join(notesFolder, `${name}.md`), sources.noteImages);
          if (index % BATCH === BATCH - 1) await breathe();
        }
        counts.notes = rows.length;
        files.notes = "notes/ (one Markdown file per note, images in a folder beside each)";
        break;
      }
      case "instruct": {
        const rows = sources.instructThreads();
        const parts = rows.map((thread) => {
          const turns = thread.turns
            .map(
              (turn) =>
                `**Request:** ${turn.instruction || "(removed)"}\n\n${turn.draft ?? "(no draft)"}\n`,
            )
            .join("\n");
          return `## ${thread.title || "(text removed after 30 days)"}\n\n${iso(thread.createdAt)} · ${thread.outcome}\n\n${turns}`;
        });
        await write("instruct.md", `# Instruct threads\n\n${parts.join("\n")}`);
        counts.instruct = rows.length;
        files.instruct = "instruct.md";
        break;
      }
      case "insights": {
        const days = sources.insights();
        await write("insights.csv", insightsCsv(days));
        counts.insights = days.length;
        files.insights = "insights.csv";
        break;
      }
      case "meetings": {
        const meetings = sources.meetings();
        const folderName = "meetings";
        mkdirSync(path.join(folder, folderName), { recursive: true });
        const used = new Set<string>();
        for (const meeting of meetings) {
          const base = unique(
            `${iso(meeting.startedAt).slice(0, 10)} ${meeting.title}`
              .replace(/[\\/:*?"<>|\p{Cc}]+/gu, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 80) || "Meeting",
            used,
          );
          await write(
            path.join(folderName, `${base}.json`),
            `${JSON.stringify(
              {
                ...meeting,
                startedAt: iso(meeting.startedAt),
                endedAt: meeting.endedAt === null ? null : iso(meeting.endedAt),
              },
              null,
              2,
            )}\n`,
          );
        }
        await write("tasks.json", `${JSON.stringify(sources.tasks(), null, 2)}\n`);
        await write("contacts.json", `${JSON.stringify(sources.contacts(), null, 2)}\n`);
        counts[category] = meetings.length;
        files[category] = "meetings/, tasks.json, contacts.json";
        break;
      }
      case "audio": {
        const audioFolder = path.join(folder, "audio");
        let copied = 0;
        for (const file of sources.audioFiles()) {
          if (!existsSync(file)) continue;
          mkdirSync(audioFolder, { recursive: true });
          await copyFile(file, path.join(audioFolder, path.basename(file)));
          copied += 1;
        }
        counts.audio = copied;
        files.audio = "audio/ (16 kHz mono PCM, 16-bit)";
        break;
      }
    }
  }

  const lines = [
    "# Murmur export",
    "",
    `Made on ${iso(now)}. Everything here came from this Mac; nothing was uploaded.`,
    "",
    "| What | Files | Count | Format version |",
    "| --- | --- | --- | --- |",
    ...categories.map(
      (category) =>
        `| ${EXPORT_LABELS[category]} | ${files[category]} | ${counts[category] ?? 0} | ${EXPORT_FORMAT_VERSION} |`,
    ),
    "",
    "Models, keys and settings are not included.",
    "",
  ];
  // Written last, so a folder with a README is a whole one.
  await write("README.md", lines.join("\n"));
  return counts;
}
