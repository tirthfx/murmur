import {
  GMAIL_ID,
  GMAIL_LIMITS,
  GMAIL_SCOPE_COMPOSE,
  emailDraftInputSchema,
  isEmailAddress,
  type ConnectorAccount,
  type EmailAutomationRecord,
  type EmailDraftProposalResult,
  type EmailDraftResult,
  type EmailDraftSource,
  type EmailDraftState,
  type EmailRecipient,
  type GmailSettings,
  type Meeting,
  type MeetingSummary,
  type Task,
} from "@murmur/shared";
import { ConnectorError, type ConnectorService } from "../connector-service";
import type { AutomationsStore } from "./automations-store";
import { GMAIL_ORIGIN, GmailError, createDraft, draftUrl } from "./gmail";

/**
 * "Draft email" (NT-27): a draft for a task, or from a meeting's summary, made in Gmail's Drafts
 * folder after the owner has read it and clicked. Nothing here sends: the only write is "create a
 * draft", and the text the model wrote is only a proposal the owner edits first.
 */
export interface EmailDraftService {
  /** Whether "Draft email" works now and, when it does not, why. */
  state(): EmailDraftState;
  /** The words and the people for a draft, written by the local model. Creates nothing. */
  propose(source: EmailDraftSource): Promise<EmailDraftProposalResult>;
  /** Creates the draft the owner confirmed, and records it. */
  create(input: unknown): Promise<EmailDraftResult>;
  /** The drafts already made from a task or a meeting, newest first. */
  list(source: EmailDraftSource): EmailAutomationRecord[];
}

export interface EmailDraftDeps {
  connectors: Pick<ConnectorService, "list" | "authorizedFetch">;
  settings(): GmailSettings;
  store: AutomationsStore;
  tasks: { get(id: string): Task | null };
  meetings: { get(id: string): Meeting | null };
  summaries: { list(meetingId: string): MeetingSummary[] };
  /** One call of the local model. May reject when it cannot answer. */
  generate(request: { system: string; prompt: string; maxTokens: number }): Promise<string>;
  now(): number;
  newId(): string;
}

const SYSTEM = [
  "You write a short follow-up email for the person who owns these notes.",
  "Use only the facts given. Never invent names, dates, numbers or promises, and never add a link.",
  "Write plain text with no markdown and no signature.",
  'Reply with JSON only and no other text, in this shape: {"subject":"...","body":"..."}.',
  "The subject is at most 80 characters. The body starts with a greeting by first name when a name is given, then two to six short sentences or lines.",
].join("\n");

const MAX_TOKENS = 500;
const CONTEXT_CHARS = 3000;

// A control character other than a tab or a line break has no place in a draft.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

const plain = (text: string, max: number) => text.replace(CONTROL, "").trim().slice(0, max);
const oneLine = (text: string, max: number) => plain(text.replace(/[\r\n]+/g, " "), max);

/** A summary without its markdown marks and the links that point at transcript lines. */
export function summaryText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]*)\]\(seg:[^)]*\)/g, "")
    .replace(/\(No source\)/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] ?? null;

/** The attendee a task's owner name points at, when exactly one fits. */
function ownerAttendee(owner: string | null, people: readonly EmailRecipient[]): string {
  const wanted = owner?.trim().toLowerCase();
  if (!wanted) return "";
  const found = people.filter((person) => {
    const name = person.name?.toLowerCase() ?? "";
    return name === wanted || name.split(/\s+/)[0] === wanted.split(/\s+/)[0];
  });
  return found.length === 1 ? found[0]!.email : "";
}

interface Written {
  subject: string;
  body: string;
}

function parseAnswer(text: string): Written | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    if (typeof value.subject !== "string" || typeof value.body !== "string") return null;
    const subject = oneLine(value.subject, GMAIL_LIMITS.subject);
    const body = plain(value.body, GMAIL_LIMITS.body);
    return subject !== "" && body !== "" ? { subject, body } : null;
  } catch {
    return null;
  }
}

export function createEmailDraftService(deps: EmailDraftDeps): EmailDraftService {
  /** The accounts that can make a draft: connected, with the compose scope. */
  const usable = (): ConnectorAccount[] =>
    deps.connectors
      .list()
      .filter(
        (account) =>
          account.connector === GMAIL_ID &&
          account.status === "connected" &&
          account.scopes.includes(GMAIL_SCOPE_COMPOSE),
      );

  const state = (): EmailDraftState => {
    if (!deps.settings().draftEnabled)
      return {
        available: false,
        reason: "Drafting is off. Turn it on for Gmail on the Connectors page.",
      };
    const accounts = deps.connectors.list().filter((account) => account.connector === GMAIL_ID);
    if (accounts.length === 0)
      return { available: false, reason: "Connect Gmail on the Connectors page first." };
    if (!accounts.some((account) => account.status === "connected"))
      return { available: false, reason: "Gmail needs to be connected again." };
    if (usable().length === 0)
      return {
        available: false,
        reason:
          "Murmur does not have permission to create drafts yet. Give it on the Connectors page.",
      };
    return { available: true, reason: null };
  };

  const resolve = (
    source: EmailDraftSource,
  ): { task: Task | null; meeting: Meeting | null } | null => {
    // A request typed in Ask has no task or meeting behind it; its form is made by Ask.
    if (source.kind === "ask") return { task: null, meeting: null };
    if (source.kind === "task") {
      const task = deps.tasks.get(source.id);
      if (!task) return null;
      return { task, meeting: task.meetingId ? deps.meetings.get(task.meetingId) : null };
    }
    const meeting = deps.meetings.get(source.id);
    return meeting ? { task: null, meeting } : null;
  };

  const latestSummary = (meetingId: string): MeetingSummary | null => {
    const all = deps.summaries.list(meetingId);
    return [...all].sort((a, b) => b.version - a.version)[0] ?? null;
  };

  return {
    state,

    async propose(source) {
      const current = state();
      if (!current.available)
        return { ok: false, message: current.reason ?? "Drafting is not available." };
      const account = usable()[0]!;
      const found = resolve(source);
      if (!found)
        return {
          ok: false,
          message: source.kind === "task" ? "That task is gone." : "That meeting is gone.",
        };
      const { task, meeting } = found;
      if (source.kind === "ask") return { ok: false, message: "Ask writes its own draft." };
      const summary = meeting ? latestSummary(meeting.id) : null;
      if (!task && !summary)
        return { ok: false, message: "This meeting has no summary to write from yet." };

      const mine = new Set(
        deps.connectors
          .list()
          .filter((entry) => entry.connector === GMAIL_ID)
          .map((entry) => entry.email.toLowerCase()),
      );
      const candidates: EmailRecipient[] = (meeting?.attendees ?? [])
        .filter((person) => !mine.has(person.email.toLowerCase()))
        .map((person) => ({ name: person.name, email: person.email }));
      const to = task
        ? ownerAttendee(task.owner, candidates)
        : candidates.length === 1
          ? candidates[0]!.email
          : "";
      const greetingName = firstName(
        candidates.find((person) => person.email === to)?.name ?? null,
      );

      const facts = [
        meeting ? `Meeting: ${oneLine(meeting.title, 200)}` : null,
        greetingName ? `Write to: ${greetingName}` : null,
        task ? `Task: ${oneLine(task.title, 300)}` : null,
        task?.notes ? `Task notes: ${plain(task.notes, 600)}` : null,
        task?.dueOn ? `Due: ${task.dueOn}` : null,
        summary
          ? `Summary of the meeting:\n${summaryText(summary.markdown).slice(0, CONTEXT_CHARS)}`
          : null,
      ]
        .filter((line): line is string => line !== null)
        .join("\n");
      const prompt = `${facts}\n\n${
        task
          ? "Write a short email about this task."
          : "Write a short follow-up email that recaps this meeting."
      }`;

      let written: Written | null;
      try {
        written = parseAnswer(
          await deps.generate({ system: SYSTEM, prompt, maxTokens: MAX_TOKENS }),
        );
      } catch {
        written = null;
      }
      // The model did not answer in a usable way: a plain starting point the owner can edit.
      written ??= {
        subject: oneLine(
          task ? `Follow-up: ${task.title}` : `Follow-up: ${meeting?.title ?? ""}`,
          80,
        ),
        body: task
          ? `${greetingName ? `Hi ${greetingName},` : "Hi,"}\n\nFollowing up on: ${oneLine(task.title, 300)}${
              task.notes ? `\n\n${plain(task.notes, 600)}` : ""
            }\n\nThanks`
          : `Hi,\n\nHere is a recap of ${oneLine(meeting?.title ?? "our meeting", 200)}:\n\n${summaryText(
              summary?.markdown ?? "",
            ).slice(0, 1500)}\n\nThanks`,
      };
      return {
        ok: true,
        proposal: {
          candidates,
          to,
          subject: written.subject,
          body: written.body,
          accountId: account.id,
          accountEmail: account.email,
        },
      };
    },

    async create(raw) {
      const parsed = emailDraftInputSchema.safeParse(raw);
      if (!parsed.success)
        return { ok: false, message: "A draft needs a subject and some text, within the limits." };
      const input = parsed.data;
      const current = state();
      if (!current.available)
        return { ok: false, message: current.reason ?? "Drafting is not available." };
      const account = usable().find((entry) => entry.id === input.accountId);
      if (!account) return { ok: false, message: "That Gmail account cannot make drafts now." };
      if (input.to !== "" && !isEmailAddress(input.to))
        return { ok: false, message: "Write one email address, or leave the recipient empty." };
      if (!resolve(input.source))
        return {
          ok: false,
          message: input.source.kind === "task" ? "That task is gone." : "That meeting is gone.",
        };

      try {
        const made = await createDraft({
          fetch: (url, init) => {
            // The token only ever goes to Gmail.
            if (!url.startsWith(`${GMAIL_ORIGIN}/`))
              throw new GmailError("Murmur only talks to Gmail here.");
            return deps.connectors.authorizedFetch(account.id, url, init);
          },
          to: input.to,
          subject: input.subject,
          body: input.body,
        });
        const openUrl = draftUrl(account.email, made.messageId);
        const record = deps.store.addEmailDraft({
          id: deps.newId(),
          accountId: account.id,
          sourceKind: input.source.kind,
          sourceId: input.source.id,
          to: input.to,
          subject: input.subject,
          draftId: made.draftId,
          openUrl,
          at: deps.now(),
        });
        return { ok: true, automationId: record.id, draftId: made.draftId, openUrl };
      } catch (error) {
        if (error instanceof GmailError || error instanceof ConnectorError)
          return { ok: false, message: error.message };
        return { ok: false, message: "Murmur could not reach Gmail. Nothing was created." };
      }
    },

    list: (source) => deps.store.listEmailDrafts(source),
  };
}
