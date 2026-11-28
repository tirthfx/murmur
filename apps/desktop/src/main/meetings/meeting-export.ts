import {
  TASK_STATUS_TEXT,
  formatElapsed,
  type MeetingExportOptions,
  type TaskStatus,
  readableMentions,
} from "@murmur/shared";

/** What a shareable file is made from (NT-18). */
export interface ExportInput {
  title: string;
  startedAt: number;
  durationMs: number;
  folderName: string | null;
  /** The spoken lines in order, with the speaker's name. */
  segments: { id: string; startMs: number; speaker: string; text: string }[];
  summary: { markdown: string; skillName: string; createdAt: number } | null;
  tasks: {
    title: string;
    status: TaskStatus;
    owner: string | null;
    ownerIsMe: boolean;
    dueOn: string | null;
  }[];
  notes: string;
  options: MeetingExportOptions;
  exportedAt: number;
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const esc = (text: string) => text.replace(/[&<>"']/g, (char) => ESCAPES[char]!);

/** The anchor of a transcript line: the same for the line and for the links that point at it. */
const anchor = (segmentId: string) => `seg-${segmentId.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/** `**bold**` and `[12:34](seg:id)` on text that is already escaped. */
function inline(escaped: string, links: boolean): string {
  return escaped
    .replace(/\[([^\]]+)\]\(seg:([^)\s]+)\)/g, (_match, label: string, id: string) =>
      links ? `<a href="#${anchor(id)}">${label}</a>` : `<span class="time">${label}</span>`,
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/** The limited Markdown of a summary: headings, bullets, bold and links to transcript lines. */
export function summaryHtml(markdown: string, links: boolean): string {
  const out: string[] = [];
  let open = false;
  const close = () => {
    if (open) out.push("</ul>");
    open = false;
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    const heading = /^#{1,4}\s+(.+)$/.exec(line);
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (heading) {
      close();
      out.push(`<h3>${inline(esc(heading[1]!), links)}</h3>`);
    } else if (bullet) {
      if (!open) out.push("<ul>");
      open = true;
      out.push(`<li>${inline(esc(bullet[1]!), links)}</li>`);
    } else if (line.trim() !== "") {
      close();
      out.push(`<p>${inline(esc(line), links)}</p>`);
    }
  }
  close();
  return out.join("\n");
}

const day = (at: number) =>
  new Date(at).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const CSS = `
:root { color-scheme: light dark; --fg: #1c1c1e; --bg: #ffffff; --muted: #6b6b70; --line: #d9d9de; --mark: #fff3bf; }
@media (prefers-color-scheme: dark) { :root { --fg: #f2f2f4; --bg: #1c1c1e; --muted: #a0a0a8; --line: #3a3a40; --mark: #4a4220; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; }
h1 { font-size: 1.7rem; line-height: 1.25; margin: 0 0 4px; }
h2 { font-size: 1.2rem; margin: 36px 0 8px; padding-top: 12px; border-top: 1px solid var(--line); }
h3 { font-size: 1rem; margin: 18px 0 4px; }
p { margin: 6px 0; }
ul { margin: 4px 0 8px; padding-left: 22px; }
a { color: inherit; text-decoration: underline; }
.meta, .note, .time, .t { color: var(--muted); }
.meta, .note { font-size: 0.9rem; }
.line { margin: 4px 0; padding: 2px 6px; border-radius: 4px; }
.line:target { background: var(--mark); }
.t { font-variant-numeric: tabular-nums; margin-right: 8px; }
.who { font-weight: 600; margin-right: 8px; }
pre { white-space: pre-wrap; font: inherit; margin: 6px 0; }
@media print { main { padding: 0; } a { text-decoration: none; } }
`;

/**
 * A meeting as one HTML file that opens offline in any browser (NT-18): the summary, the
 * transcript, the tasks and, if asked, the owner's notes. It has no scripts, no fonts, no
 * images and no links to the web, and every piece of text is escaped. Audio is never in it.
 * A link in the summary jumps to the transcript line it came from.
 */
export function renderMeetingHtml(input: ExportInput): string {
  const { options } = input;
  const parts: string[] = [];
  const meta = [
    day(input.startedAt),
    formatElapsed(input.durationMs),
    ...(input.folderName ? [`Folder: ${input.folderName}`] : []),
  ];
  parts.push(`<h1>${esc(input.title)}</h1>`, `<p class="meta">${esc(meta.join(" · "))}</p>`);

  if (options.summary) {
    parts.push('<section id="summary"><h2>Summary</h2>');
    if (input.summary) {
      parts.push(
        summaryHtml(input.summary.markdown, options.transcript),
        `<p class="note">Written by Murmur with the Skill “${esc(input.summary.skillName)}”.</p>`,
      );
    } else {
      parts.push('<p class="note">This meeting has no summary yet.</p>');
    }
    parts.push("</section>");
  }

  if (options.tasks) {
    parts.push('<section id="tasks"><h2>Tasks</h2>');
    if (input.tasks.length === 0) parts.push('<p class="note">No tasks.</p>');
    else {
      parts.push("<ul>");
      for (const task of input.tasks) {
        const who = task.ownerIsMe ? "me" : task.owner;
        const detail = [
          TASK_STATUS_TEXT[task.status],
          ...(who ? [`owner: ${who}`] : []),
          ...(task.dueOn ? [`due ${task.dueOn}`] : []),
        ].join(", ");
        parts.push(`<li>${esc(task.title)} <span class="note">(${esc(detail)})</span></li>`);
      }
      parts.push("</ul>");
    }
    parts.push("</section>");
  }

  if (options.notes && input.notes.trim() !== "") {
    parts.push(
      `<section id="notes"><h2>Notes</h2><pre>${esc(readableMentions(input.notes).trim())}</pre></section>`,
    );
  }

  if (options.transcript) {
    parts.push('<section id="transcript"><h2>Transcript</h2>');
    if (input.segments.length === 0) parts.push('<p class="note">No speech was found.</p>');
    for (const line of input.segments) {
      parts.push(
        `<p class="line" id="${anchor(line.id)}"><span class="t">${formatElapsed(line.startMs)}</span>` +
          `<span class="who">${esc(line.speaker)}</span>${esc(line.text)}</p>`,
      );
    }
    parts.push("</section>");
  }

  parts.push(
    `<p class="note">Exported from Murmur on ${esc(day(input.exportedAt))}. The audio is not included.</p>`,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(input.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${parts.join("\n")}
</main>
</body>
</html>
`;
}

/** `2026-11-21 Design sync.html`, without characters a file name cannot hold. */
export function exportFileName(title: string, startedAt: number): string {
  const date = new Date(startedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const safe = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 80)
    .trim();
  return `${stamp} ${safe || "Meeting"}.html`;
}
