import { z } from "zod";
import {
  GMAIL_BASE_SCOPES,
  GMAIL_ID,
  GMAIL_LIMITS,
  isEmailAddress,
  type GmailMessage,
  type GmailThread,
} from "@murmur/shared";
import type { ConnectorProvider } from "../providers";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
/** The only place a Gmail account's token is sent. */
export const GMAIL_ORIGIN = "https://gmail.googleapis.com";

/**
 * Gmail (CN-04): the owner's own Google OAuth client, authorization code with PKCE in the system
 * browser. Signing in asks only for who the account is; the read and the compose scopes are added
 * by the caller when the feature that needs them is on (`gmailScopesFor`), and
 * `include_granted_scopes` keeps the ones given before.
 */
export const gmailProvider: ConnectorProvider = {
  id: GMAIL_ID,
  name: "Gmail",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  scopes: [...GMAIL_BASE_SCOPES],
  authorizeParams: {
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  },
  loopbackPort: null,
  needsClientSecret: true,
  async accountLabel({ token, http }) {
    const response = await http("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${token.accessToken}` },
    });
    if (!response.ok) throw new Error("userinfo failed");
    const body = z.object({ email: z.string().min(3) }).parse(await response.json());
    return body.email;
  },
};

export class GmailError extends Error {}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

// ------------------------------------------------------------------ text

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** HTML as plain text. Nothing is rendered and no link or image is followed. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
      if (name.startsWith("#")) {
        const code =
          name[1]?.toLowerCase() === "x"
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : "";
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const decodeBase64Url = (data: string): string =>
  Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

const encodeBase64Url = (data: Buffer): string =>
  data.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ------------------------------------------------------------------ messages (reads)

interface Part {
  mimeType?: string | undefined;
  filename?: string | undefined;
  headers?: { name: string; value: string }[] | undefined;
  body?: { data?: string | undefined; attachmentId?: string | undefined } | undefined;
  parts?: Part[] | undefined;
}

const partSchema: z.ZodType<Part> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z.object({ data: z.string().optional(), attachmentId: z.string().optional() }).optional(),
    parts: z.array(partSchema).optional(),
  }),
);

const messageSchema = z.object({
  id: z.string().min(1),
  internalDate: z.string().optional(),
  payload: partSchema.optional(),
});

const threadSchema = z.object({
  id: z.string().min(1),
  messages: z.array(messageSchema).optional(),
});

/**
 * The readable text of a message: the plain part when there is one, else the HTML part as text.
 * A part that is an attachment (it has a file name or an attachment id) is skipped, never fetched.
 */
function textOf(part: Part | undefined): string {
  if (!part) return "";
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (node: Part) => {
    if (node.filename || node.body?.attachmentId) return;
    if (node.parts) node.parts.forEach(walk);
    const data = node.body?.data;
    if (!data) return;
    if (node.mimeType === "text/plain") plain.push(decodeBase64Url(data));
    else if (node.mimeType === "text/html") html.push(htmlToText(decodeBase64Url(data)));
  };
  walk(part);
  return (plain.length > 0 ? plain : html).join("\n").trim();
}

const header = (part: Part | undefined, name: string): string =>
  part?.headers?.find((entry) => entry.name.toLowerCase() === name)?.value ?? "";

const clean = (text: string, max: number) =>
  text
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, max);

/** One thread of Gmail's answer, as plain text. Null when it cannot be read. */
export function parseThread(value: unknown): GmailThread | null {
  const parsed = threadSchema.safeParse(value);
  if (!parsed.success) return null;
  const messages: GmailMessage[] = (parsed.data.messages ?? [])
    .slice(-GMAIL_LIMITS.messagesPerThread)
    .map((message) => ({
      id: message.id,
      from: clean(header(message.payload, "from"), 200),
      to: clean(header(message.payload, "to"), 400),
      dateMs: Number(message.internalDate ?? 0) || 0,
      text: textOf(message.payload).slice(0, GMAIL_LIMITS.messageText),
    }));
  const first = parsed.data.messages?.[0];
  return {
    id: parsed.data.id,
    subject: clean(header(first?.payload, "subject"), GMAIL_LIMITS.subject) || "(No subject)",
    messages,
  };
}

const listSchema = z.object({ threads: z.array(z.object({ id: z.string().min(1) })).optional() });

/**
 * The most recent threads with any of these people, newest first, as plain text (CN-04). Only
 * addresses that look like addresses go into the search. An attachment is never fetched.
 */
export async function recentThreadsWith(options: {
  fetch: Fetch;
  emails: readonly string[];
  max: number;
  /** How far back to look. */
  days?: number;
}): Promise<GmailThread[]> {
  const emails = [...new Set(options.emails.map((email) => email.trim().toLowerCase()))].filter(
    isEmailAddress,
  );
  if (emails.length === 0 || options.max < 1) return [];
  const group = `(${emails.join(" OR ")})`;
  const query = `(from:${group} OR to:${group}) newer_than:${options.days ?? 90}d`;
  const list = await options.fetch(
    `${API}/threads?${new URLSearchParams({ q: query, maxResults: String(options.max) })}`,
  );
  if (!list.ok) throw new GmailError(`Gmail answered ${list.status}.`);
  const ids = listSchema.safeParse(await list.json().catch(() => null));
  if (!ids.success) throw new GmailError("Gmail sent an answer Murmur cannot read.");
  const threads: GmailThread[] = [];
  for (const { id } of (ids.data.threads ?? []).slice(0, options.max)) {
    const response = await options.fetch(`${API}/threads/${encodeURIComponent(id)}?format=full`);
    if (!response.ok) throw new GmailError(`Gmail answered ${response.status}.`);
    const thread = parseThread(await response.json().catch(() => null));
    if (thread) threads.push(thread);
  }
  return threads;
}

// ------------------------------------------------------------------ drafts

const ascii = (text: string) => /^[\x20-\x7e]*$/.test(text);

/** A subject as a header: plain when it is ASCII, else encoded, on one line either way. */
export function encodeSubject(subject: string): string {
  const line = subject.replace(/[\r\n]+/g, " ").trim();
  return ascii(line) ? line : `=?UTF-8?B?${Buffer.from(line, "utf8").toString("base64")}?=`;
}

/**
 * The message of a draft, as Gmail wants it (RFC 2822). A recipient that is not one plain address
 * is refused, so nothing the model or the owner typed can add a header or another recipient.
 */
export function buildMime(input: { to: string; subject: string; body: string }): string {
  const to = input.to.trim();
  if (to !== "" && !isEmailAddress(to)) throw new GmailError("That is not an email address.");
  const body = Buffer.from(input.body.replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
  return [
    ...(to ? [`To: ${to}`] : []),
    `Subject: ${encodeSubject(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

const draftSchema = z.object({
  id: z.string().min(1),
  message: z.object({ id: z.string().min(1) }),
});

/**
 * Creates a draft in the Drafts folder. This is the only call that writes: there is no call that
 * sends, and no address that sends is ever built, so a draft is only ever a draft.
 */
export async function createDraft(options: {
  fetch: Fetch;
  to: string;
  subject: string;
  body: string;
}): Promise<{ draftId: string; messageId: string }> {
  const raw = encodeBase64Url(Buffer.from(buildMime(options), "utf8"));
  const response = await options.fetch(`${API}/drafts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });
  if (response.status === 403)
    throw new GmailError(
      "Google did not allow a draft. Give Murmur permission to create drafts and try again.",
    );
  if (!response.ok) throw new GmailError(`Gmail answered ${response.status}.`);
  const parsed = draftSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new GmailError("Gmail sent an answer Murmur cannot read.");
  return { draftId: parsed.data.id, messageId: parsed.data.message.id };
}

/** Where the draft is in Gmail, to open it in the browser. */
export function draftUrl(accountEmail: string, messageId: string): string {
  return `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#drafts?compose=${encodeURIComponent(messageId)}`;
}
