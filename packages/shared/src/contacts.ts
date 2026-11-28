import { z } from "zod";

/**
 * Contacts and mentions (NT-12). A mention is written in the text as
 * `@[contact:<id>|<name>]`, so notes stay readable anywhere, and renaming a contact rewrites
 * the name inside every mention of it.
 */

export const CONTACT_LIMITS = { name: 120, email: 254, count: 5000, suggestions: 8 } as const;

export const CONTACT_SOURCES = ["manual", "calendar", "speaker"] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export const contactSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  source: z.enum(CONTACT_SOURCES),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Contact = z.infer<typeof contactSchema>;

export const contactDraftSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(CONTACT_LIMITS.name)
    // These would break a mention written into text.
    .regex(/^[^[\]|\n\r]+$/, "A name cannot hold [ ] | or a line break"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(CONTACT_LIMITS.email)
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "That is not an email address")
    .nullable(),
});
export type ContactDraft = z.infer<typeof contactDraftSchema>;

export const contactResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), contact: contactSchema }),
  z.strictObject({ ok: z.literal(false), message: z.string() }),
]);
export type ContactResult = z.infer<typeof contactResultSchema>;

export const contactCardSchema = z.strictObject({
  contact: contactSchema,
  /** Meetings they were invited to, spoke in or are mentioned in, newest first. */
  meetings: z.array(
    z.strictObject({ id: z.string(), title: z.string(), startedAt: z.number().int() }),
  ),
  /** Open tasks they own or are mentioned in. */
  tasks: z.array(z.strictObject({ id: z.string(), title: z.string() })),
});
export type ContactCard = z.infer<typeof contactCardSchema>;

const MENTION = /@\[contact:([A-Za-z0-9-]{1,64})\|([^[\]|\n]{1,120})\]/g;

export const mentionToken = (contact: Pick<Contact, "id" | "name">): string =>
  `@[contact:${contact.id}|${contact.name}]`;

export function mentionedIds(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION)].map((match) => match[1]!))];
}

/** The text with every mention of this contact showing the new name. */
export function renameMentions(text: string, id: string, name: string): string {
  return text.replace(MENTION, (whole, found: string) =>
    found === id ? mentionToken({ id, name }) : whole,
  );
}

/** The text with mentions of this contact turned back into the plain name. */
export function removeMentions(text: string, id: string): string {
  return text.replace(MENTION, (whole, found: string, name: string) =>
    found === id ? name : whole,
  );
}

/** Mentions written the short way, "@Name", for anything a person reads. */
export const readableMentions = (text: string): string => text.replace(MENTION, "@$2");

/** The "@name" being typed just before the caret, or null. Up to three words. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|[\s(])@([\p{L}\p{N}'.-]*(?: [\p{L}\p{N}'.-]+){0,2})$/u.exec(before);
  if (!match) return null;
  return { start: caret - match[1]!.length - 1, query: match[1]! };
}
