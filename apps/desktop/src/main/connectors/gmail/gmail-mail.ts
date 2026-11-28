import {
  type GmailContactsResult,
  type GmailSettings,
  type GmailStyleResult,
  type GmailThread,
  type GmailThreadsResult,
  type MeetingAttendee,
} from "@murmur/shared";
import { ConnectorError, type ConnectorService } from "../connector-service";
import { learnEmailStyle } from "./email-style";
import { GmailError, recentInboxThreads, sentMessages } from "./gmail";
import { gmailReader } from "./gmail-reader";

/** How many threads are offered, and how many sent messages are looked at. */
export const REPLY_THREADS = 10;
export const CONTACT_MESSAGES = 100;
export const STYLE_MESSAGES = 50;
/** The most of a thread that goes into notes. */
const THREAD_CHARS = 8000;

/** A thread as the text a reply is drafted from. */
export function threadText(thread: GmailThread): string {
  const messages = thread.messages.map((message) => `From ${message.from}:\n${message.text}`);
  const text = [`Email thread: ${thread.subject}`, ...messages].join("\n\n");
  // The end matters most for a reply.
  return text.length <= THREAD_CHARS
    ? text
    : `${`Email thread: ${thread.subject}`}\n\n…${text.slice(-THREAD_CHARS)}`;
}

/** The people in an address line such as `Dana Lee <dana@x.com>, lee@y.com`. */
export function addresses(line: string): MeetingAttendee[] {
  return (line.match(/(?:"[^"]*"|[^,"<]|<[^>]*>)+/g) ?? []).flatMap((part) => {
    const named = /^(.*)<([^<>]+)>\s*$/.exec(part.trim());
    const email = (named ? named[2]! : part).trim().toLowerCase();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return [];
    const name = named?.[1]?.replace(/"/g, "").trim() || null;
    return [{ name, email }];
  });
}

export interface GmailMailDeps {
  connectors: Pick<ConnectorService, "list" | "authorizedFetch">;
  settings(): GmailSettings;
  /** Keeps what was learned. */
  saveStyle(style: GmailSettings["style"]): void;
  addContacts(people: readonly MeetingAttendee[]): number;
  now(): number;
}

export interface GmailMail {
  threads(): Promise<GmailThreadsResult>;
  importContacts(): Promise<GmailContactsResult>;
  learnStyle(): Promise<GmailStyleResult>;
}

/**
 * What reads Gmail only when the owner asks (CN-04, NT-12, PZ-23): threads to reply to, the
 * people written to, and how email is written. Each needs its own switch.
 */
export function createGmailMail(deps: GmailMailDeps): GmailMail {
  /** Runs `work` with Gmail, if the switch is on and an account may be read. */
  async function withGmail<T>(
    on: boolean,
    work: (reader: NonNullable<ReturnType<typeof gmailReader>>) => Promise<T>,
  ): Promise<T | { ok: false; message: string }> {
    if (!on) return { ok: false, message: "That is turned off on the Connectors page." };
    const reader = gmailReader(deps.connectors);
    if (!reader) return { ok: false, message: "Gmail has not been given permission to read mail." };
    try {
      return await work(reader);
    } catch (error) {
      if (error instanceof GmailError || error instanceof ConnectorError)
        return { ok: false, message: error.message };
      return { ok: false, message: "Gmail could not be read." };
    }
  }

  return {
    threads: () =>
      withGmail(deps.settings().replyContext, async ({ fetch }) => {
        const threads = await recentInboxThreads({ fetch, max: REPLY_THREADS });
        return {
          ok: true as const,
          threads: threads.map((thread) => ({
            id: thread.id,
            subject: thread.subject,
            from: thread.messages.at(-1)?.from ?? "",
            text: threadText(thread),
          })),
        };
      }),

    importContacts: () =>
      withGmail(deps.settings().contactsFromMail, async ({ fetch, email }) => {
        const sent = await sentMessages({ fetch, max: CONTACT_MESSAGES, headersOnly: true });
        const people = new Map<string, MeetingAttendee>();
        for (const message of sent)
          for (const person of addresses(`${message.to},${message.cc}`)) {
            if (person.email === email.toLowerCase()) continue;
            if (!people.has(person.email) || person.name) people.set(person.email, person);
          }
        return {
          ok: true as const,
          added: deps.addContacts([...people.values()]),
          found: people.size,
        };
      }),

    learnStyle: () =>
      withGmail(deps.settings().learnStyle, async ({ fetch }) => {
        const sent = await sentMessages({ fetch, max: STYLE_MESSAGES, headersOnly: false });
        const style = learnEmailStyle(
          sent.map((message) => message.text),
          deps.now(),
        );
        if (!style)
          return {
            ok: false as const,
            message: "There is too little sent mail from the last 90 days to learn from.",
          };
        deps.saveStyle(style);
        return { ok: true as const, style };
      }),
  };
}
