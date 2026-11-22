import {
  type AskActionProposal,
  type AskActionRequest,
  type AskActionResult,
  type CalendarEventProposal,
  type EmailDraftProposal,
  type EmailRecipient,
  type ExtensionActionId,
} from "@murmur/shared";
import type { ActionRunner } from "../extensions/action-runner";

/**
 * Connector actions from Ask (CN-13), behind the experimental option. Ask decides whether the
 * owner is asking Murmur to do something or only asking a question; for the first it fills in one
 * form of an action that is ready, and nothing more: no provider is called, nothing is sent or
 * created, and the owner reads and confirms the form with a click like any other action.
 */
export interface AskActions {
  propose(request: AskActionRequest): Promise<AskActionResult>;
}

export interface AskActionsDeps {
  /** The experimental option. With it off nothing is asked of the model and nothing is proposed. */
  enabled(): boolean;
  runner: Pick<ActionRunner, "stateOf">;
  /** One call of the local model. May reject when it cannot answer. */
  generate(request: { system: string; prompt: string; maxTokens: number }): Promise<string>;
  /** The people Murmur knows from the meetings it has, to choose a recipient from. */
  contacts(): EmailRecipient[];
  /** The Gmail account a draft would be made in, or null. */
  emailAccount(): { id: string; email: string } | null;
  /** The calendar account an event would be made in, or null. */
  calendarAccount(): { id: string; email: string; connector: string } | null;
  eventDefaults(): { durationMinutes: number; invitesAllowed: boolean };
  now(): number;
}

const START =
  /^\s*(?:(?:please|kindly)\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:go\s+ahead\s+and\s+)?(draft|write|compose|create|schedule|book|set\s+up|post|send|share|add\s+an?\s+event|make\s+an?\s+event)\b/i;
const QUESTION =
  /^\s*(?:what|who|when|where|why|how|which|did|does|do|is|are|was|were|has|have|had|summari[sz]e|list|show|find|tell)\b/i;

/**
 * Whether a request starts like an order to do something ("Draft a follow-up…", "Can you
 * schedule…"), as opposed to a question that merely has such a verb in it ("Did we create an event
 * for the offsite?", "What did we say about drafting it?"). Only the first is shown to the model.
 */
export function looksLikeAction(question: string): boolean {
  if (QUESTION.test(question)) return false;
  return START.test(question);
}

const SYSTEM = (actions: readonly ExtensionActionId[]) =>
  [
    "You decide whether the owner is asking Murmur to DO something with their email, calendar or Slack, or only asking a question.",
    'Reply with JSON only, in this shape: {"intent":"action"|"answer","action":"draft_email"|"create_event"|"post_to_slack"|null,"recipient":null,"subject":null,"body":null,"title":null,"when":null,"message":null}.',
    `Only these actions exist: ${actions.join(", ")}.`,
    'The intent is "action" only when the owner clearly asks you to write, create or post something now. A question about what happened, who, when or why is an "answer", even if it uses a word like draft or create.',
    '"recipient" is the name of the person, as said. "when" is a local date and time like 2026-11-25T14:00, or null. Never invent names, dates or facts; use null when it was not said.',
  ].join("\n");

// A control character other than a tab or a line break has no place in a draft.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const plain = (text: unknown, max: number) =>
  typeof text === "string" ? text.replace(CONTROL, "").trim().slice(0, max) : "";
const oneLine = (text: unknown, max: number) =>
  typeof text === "string" ? plain(text.replace(/[\r\n]+/g, " "), max) : "";

interface Answer {
  intent: unknown;
  action: unknown;
  recipient: unknown;
  subject: unknown;
  body: unknown;
  title: unknown;
  when: unknown;
  message: unknown;
}

function parseAnswer(text: string): Answer | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof value === "object" && value !== null ? (value as Answer) : null;
  } catch {
    return null;
  }
}

const tomorrowMorning = (now: number): number => {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 9, 0).getTime();
};

export function createAskActions(deps: AskActionsDeps): AskActions {
  const ready = (): ExtensionActionId[] =>
    (["draft_email", "create_event", "post_to_slack"] as const).filter(
      (id) => deps.runner.stateOf(id).state === "ready",
    );

  /** The people a name could mean: a match when there is one, else the people Murmur knows. */
  function recipientFor(name: string): {
    candidates: EmailRecipient[];
    to: string;
    note: string | null;
  } {
    const all = deps.contacts();
    if (name === "") return { candidates: all.slice(0, 10), to: "", note: null };
    const wanted = name.toLowerCase();
    const matches = all.filter((person) => {
      const full = (person.name ?? "").toLowerCase();
      return (
        full === wanted ||
        full.split(/\s+/)[0] === wanted.split(/\s+/)[0] ||
        person.email.toLowerCase() === wanted
      );
    });
    if (matches.length === 1) return { candidates: matches, to: matches[0]!.email, note: null };
    if (matches.length > 1)
      return {
        candidates: matches,
        to: "",
        note: `More than one person is called “${name}”. Choose who you mean.`,
      };
    return {
      candidates: all.slice(0, 10),
      to: "",
      note: `No one called “${name}” was found. Choose a contact or type an address.`,
    };
  }

  return {
    async propose(request) {
      // The option is off: Ask is as it was, and the model is never asked about actions.
      if (!deps.enabled()) return { ok: true, proposal: null };
      if (!looksLikeAction(request.question)) return { ok: true, proposal: null };
      const actions = ready();
      if (actions.length === 0) return { ok: true, proposal: null };

      let answer: Answer | null;
      try {
        answer = parseAnswer(
          await deps.generate({
            system: SYSTEM(actions),
            prompt: `Request: ${plain(request.question, 1500)}`,
            maxTokens: 400,
          }),
        );
      } catch {
        // Ask goes on to answer the question in the usual way.
        return { ok: true, proposal: null };
      }
      if (!answer || answer.intent !== "action") return { ok: true, proposal: null };
      const action = actions.find((id) => id === answer.action);
      if (!action) return { ok: true, proposal: null };

      const name = oneLine(answer.recipient, 80);
      const to = recipientFor(name);

      if (action === "draft_email") {
        const account = deps.emailAccount();
        if (!account) return { ok: true, proposal: null };
        const subject =
          oneLine(answer.subject, 200) || (name ? `Follow-up for ${name}` : "Follow-up");
        const form: EmailDraftProposal = {
          candidates: to.candidates,
          to: to.to,
          subject,
          body: plain(answer.body, 3000),
          accountId: account.id,
          accountEmail: account.email,
        };
        const proposal: AskActionProposal = {
          action,
          line: `Draft an email${to.to ? ` to ${name}` : name ? ` for ${name}` : ""}: ${subject}`,
          note: to.note,
          form,
        };
        return { ok: true, proposal };
      }

      if (action === "create_event") {
        const account = deps.calendarAccount();
        if (!account) return { ok: true, proposal: null };
        const defaults = deps.eventDefaults();
        const asked = typeof answer.when === "string" ? Date.parse(answer.when) : Number.NaN;
        const startMs =
          !Number.isNaN(asked) && asked > deps.now() ? asked : tomorrowMorning(deps.now());
        const title = oneLine(answer.title, 200) || (name ? `Meeting with ${name}` : "Follow-up");
        const form: CalendarEventProposal = {
          title,
          startMs,
          durationMinutes: defaults.durationMinutes,
          candidates: to.candidates,
          description: plain(answer.body ?? answer.message, 2000),
          accountId: account.id,
          accountEmail: account.email,
          connector: account.connector,
          invitesAllowed: defaults.invitesAllowed,
        };
        return {
          ok: true,
          proposal: {
            action,
            line: `Create the event “${title}” on ${new Date(startMs).toLocaleString()}`,
            note:
              Number.isNaN(asked) || asked <= deps.now()
                ? "No time was given, so it starts tomorrow morning."
                : null,
            form,
          },
        };
      }

      const text = plain(answer.message ?? answer.body, 3000);
      return {
        ok: true,
        proposal: {
          action,
          line: "Send a message to Slack",
          note: null,
          text,
        },
      };
    },
  };
}
