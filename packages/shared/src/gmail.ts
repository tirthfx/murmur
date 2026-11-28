import { z } from "zod";

/**
 * Gmail (CN-04) and the email draft automation (NT-27). Murmur reads mail only for the features
 * that need it and only creates drafts: it never sends. Each scope is asked for only when the
 * feature that needs it is turned on.
 */

export const GMAIL_ID = "gmail";

/** Signing in always asks for who the account is, and nothing about mail. */
export const GMAIL_BASE_SCOPES = ["openid", "email"] as const;
export const GMAIL_SCOPE_READ = "https://www.googleapis.com/auth/gmail.readonly";
export const GMAIL_SCOPE_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";

/** `connectors.gmail`: what Murmur may do with mail. Everything is off until the owner turns it on. */
/** How the owner usually writes email, worked out on this Mac from sent mail (PZ-23). */
export const emailStyleSchema = z.strictObject({
  /** The usual opening, with `{name}` where a name goes; null when there is no habit. */
  greeting: z.string().max(80).nullable(),
  signOff: z.string().max(80).nullable(),
  /** The middle length of a message, in words. */
  words: z.number().int().nonnegative(),
  /** How many messages it was learned from. */
  messages: z.number().int().positive(),
  learnedAt: z.number().int().nonnegative(),
});
export type EmailStyle = z.infer<typeof emailStyleSchema>;

/** The habits in plain words, for the owner and for the model. */
export function describeEmailStyle(style: EmailStyle): string {
  const parts = [
    style.greeting ? `Open with “${style.greeting}”.` : "No usual opening.",
    style.signOff ? `Sign off with “${style.signOff}”.` : "No usual sign-off.",
    `Messages are usually about ${style.words} words.`,
  ];
  return parts.join(" ");
}

/** A recent thread to choose as the source of a reply, as plain text. */
export interface GmailThreadChoice {
  id: string;
  subject: string;
  /** Who wrote last. */
  from: string;
  /** The thread as it goes into the notes. */
  text: string;
}

export type GmailThreadsResult =
  { ok: true; threads: GmailThreadChoice[] } | { ok: false; message: string };
export type GmailContactsResult =
  { ok: true; added: number; found: number } | { ok: false; message: string };
export type GmailStyleResult = { ok: true; style: EmailStyle } | { ok: false; message: string };

export const gmailSettingsSchema = z.strictObject({
  /** Read recent threads with the people in a meeting, for briefs. Needs the read scope. */
  briefContext: z.boolean(),
  /** Create drafts from a task or a summary. Needs the compose scope. */
  draftEnabled: z.boolean(),
  maxThreadsPerBrief: z.number().int().min(1).max(10),
  /** Pick a recent thread to put in a meeting's notes, for a reply draft. Needs the read scope. */
  replyContext: z.boolean().default(false),
  /** Add the people the owner writes to as contacts, when asked (NT-12). Needs the read scope. */
  contactsFromMail: z.boolean().default(false),
  /** Learn how the owner writes email from sent mail, when asked (PZ-23). Needs the read scope. */
  learnStyle: z.boolean().default(false),
  /** What was learned, used by Instruct Mode in email apps; null before it was. */
  style: emailStyleSchema.nullable().default(null),
});
export type GmailSettings = z.infer<typeof gmailSettingsSchema>;

export const DEFAULT_GMAIL_SETTINGS: GmailSettings = {
  briefContext: false,
  draftEnabled: false,
  maxThreadsPerBrief: 5,
  replyContext: false,
  contactsFromMail: false,
  learnStyle: false,
  style: null,
};

/** The scopes to ask for when signing in to Gmail: only those of the features that are on. */
export function gmailScopesFor(settings: GmailSettings): string[] {
  const scopes: string[] = [...GMAIL_BASE_SCOPES];
  if (
    settings.briefContext ||
    settings.replyContext ||
    settings.contactsFromMail ||
    settings.learnStyle
  )
    scopes.push(GMAIL_SCOPE_READ);
  if (settings.draftEnabled) scopes.push(GMAIL_SCOPE_COMPOSE);
  return scopes;
}

/** The scopes a feature needs that an account has not been given yet; empty when it is all there. */
export function gmailMissingScopes(settings: GmailSettings, granted: readonly string[]): string[] {
  return gmailScopesFor(settings).filter((scope) => !granted.includes(scope));
}

// ------------------------------------------------------------------ threads (reads)

/** One message of a thread as plain text. HTML is turned into text and attachments are never fetched. */
export interface GmailMessage {
  id: string;
  from: string;
  to: string;
  /** Milliseconds; 0 when the date could not be read. */
  dateMs: number;
  /** Plain text, cut to `GMAIL_LIMITS.messageText` characters. */
  text: string;
}

export interface GmailThread {
  id: string;
  subject: string;
  /** The messages, oldest first. */
  messages: GmailMessage[];
}

export const GMAIL_LIMITS = {
  messageText: 4000,
  messagesPerThread: 6,
  subject: 200,
  body: 20_000,
} as const;

// ------------------------------------------------------------------ drafts (NT-27)

/** What a draft is made from: a task, or the summary of a meeting. */
export const emailDraftSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("task"), id: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("meeting"), id: z.string().min(1).max(64) }),
  /** A request typed in Ask (CN-13): the id is the Ask thread's. */
  z.strictObject({ kind: z.literal("ask"), id: z.string().min(1).max(64) }),
]);
export type EmailDraftSource = z.infer<typeof emailDraftSourceSchema>;

export interface EmailRecipient {
  name: string | null;
  email: string;
}

/** What the window shows before anything is created: the owner edits it, then confirms. */
export interface EmailDraftProposal {
  /** People who were invited to the meeting; the owner picks one or types an address. */
  candidates: EmailRecipient[];
  /** The one that fits the task's owner, when there is one. */
  to: string;
  subject: string;
  body: string;
  /** The account the draft will be created in. */
  accountId: string;
  accountEmail: string;
}

export type EmailDraftProposalResult =
  { ok: true; proposal: EmailDraftProposal } | { ok: false; message: string };

/** What the owner confirmed. The text is the owner's, as edited. */
export const emailDraftInputSchema = z.strictObject({
  source: emailDraftSourceSchema,
  accountId: z.string().min(1).max(64),
  to: z.string().trim().max(320),
  subject: z.string().trim().min(1).max(GMAIL_LIMITS.subject),
  body: z.string().min(1).max(GMAIL_LIMITS.body),
});
export type EmailDraftInput = z.infer<typeof emailDraftInputSchema>;

export type EmailDraftResult =
  | { ok: true; automationId: string; draftId: string; openUrl: string }
  | { ok: false; message: string };

/** Whether "Draft email" can be used now, and if not, why, in words for the button's note. */
export interface EmailDraftState {
  available: boolean;
  /** Why it is not available; null when it is. */
  reason: string | null;
  /** The action is off or its connector is not connected: it is left out of the screens that would offer it (CN-12). */
  hidden?: boolean;
}

export interface EmailAutomationRecord {
  id: string;
  /** `task` or `meeting`, and its id. */
  sourceKind: "task" | "meeting" | "ask";
  sourceId: string;
  to: string;
  subject: string;
  /** The Gmail draft's id (`automations.result_ref`). */
  draftId: string;
  /** The address of the message in Gmail, to open the draft. */
  openUrl: string;
  createdAt: number;
}

/** A plain, simple check of a single address. Gmail checks the rest. */
export function isEmailAddress(text: string): boolean {
  return /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]{2,}$/.test(text);
}
