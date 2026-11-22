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
export const gmailSettingsSchema = z.strictObject({
  /** Read recent threads with the people in a meeting, for briefs. Needs the read scope. */
  briefContext: z.boolean(),
  /** Create drafts from a task or a summary. Needs the compose scope. */
  draftEnabled: z.boolean(),
  maxThreadsPerBrief: z.number().int().min(1).max(10),
});
export type GmailSettings = z.infer<typeof gmailSettingsSchema>;

export const DEFAULT_GMAIL_SETTINGS: GmailSettings = {
  briefContext: false,
  draftEnabled: false,
  maxThreadsPerBrief: 5,
};

/** The scopes to ask for when signing in to Gmail: only those of the features that are on. */
export function gmailScopesFor(settings: GmailSettings): string[] {
  const scopes: string[] = [...GMAIL_BASE_SCOPES];
  if (settings.briefContext) scopes.push(GMAIL_SCOPE_READ);
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
