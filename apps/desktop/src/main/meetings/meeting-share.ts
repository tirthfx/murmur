import { TASK_STATUS_TEXT, formatElapsed, type TaskStatus, readableMentions } from "@murmur/shared";

/**
 * What a person shares into a team folder from a meeting (NT-17): the title, when it was, the
 * summary and the tasks, as Markdown text. The transcript, the person's own notes and the audio
 * are never part of it: those stay on the Mac unless the person exports them on purpose.
 */
export interface MeetingShareInput {
  title: string;
  startedAt: number;
  durationMs: number;
  summary: { markdown: string; skillName: string } | null;
  tasks: {
    title: string;
    status: TaskStatus;
    owner: string | null;
    ownerIsMe: boolean;
    dueOn: string | null;
  }[];
}

const DAY = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

/** A link into the person's own transcript means nothing to others: keep its words. */
const withoutTranscriptLinks = (markdown: string) =>
  markdown.replace(/\[([^\]]+)\]\(seg:[^)\s]+\)/g, "$1");

/** Null when there is nothing worth sharing yet (no summary). */
export function meetingShare(input: MeetingShareInput): { title: string; body: string } | null {
  if (!input.summary || input.summary.markdown.trim() === "") return null;
  const lines = [
    `# ${input.title}`,
    "",
    `${DAY.format(new Date(input.startedAt))}, ${formatElapsed(input.durationMs)}. Summary: ${input.summary.skillName}.`,
    "",
    withoutTranscriptLinks(input.summary.markdown.trim()),
  ];
  const open = input.tasks.filter((task) => task.status !== "archived");
  if (open.length > 0) {
    lines.push("", "## Tasks", "");
    for (const task of open) {
      const who = task.owner ? ` (${task.ownerIsMe ? "me" : task.owner})` : "";
      const due = task.dueOn ? `, due ${task.dueOn}` : "";
      lines.push(`- ${TASK_STATUS_TEXT[task.status]}: ${readableMentions(task.title)}${who}${due}`);
    }
  }
  return { title: input.title.slice(0, 200), body: lines.join("\n") + "\n" };
}
