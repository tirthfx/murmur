import { z } from "zod";

/**
 * Sending a summary or a task to Slack (CN-05) and tagging people in it (CN-14). The owner sees the
 * exact message, the channel and every tag before anything is sent, and nothing is sent without a
 * click on that preview.
 */

/** The one extra permission: posting as the owner. Asked for only when the owner turns off read only. */
export const SLACK_SCOPE_WRITE = "chat:write";

export const SLACK_POST_LIMITS = { text: 3000, mentions: 20 } as const;

/** What a message is made from: a task, a meeting's summary, or a request typed in Ask. */
export const slackPostSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("task"), id: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("meeting"), id: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("ask"), id: z.string().min(1).max(64) }),
]);
export type SlackPostSource = z.infer<typeof slackPostSourceSchema>;

/** The message as the owner wrote or edited it, and where it goes. */
export const slackPrepareInputSchema = z.strictObject({
  source: slackPostSourceSchema,
  channelId: z.string().min(1).max(64),
  text: z.string().trim().min(1).max(SLACK_POST_LIMITS.text),
});
export type SlackPrepareInput = z.infer<typeof slackPrepareInputSchema>;

/** What a draft message starts as, from a task or a summary; the owner edits it. */
export interface SlackStart {
  text: string;
  /** The public channels the owner can send to. */
  channels: { id: string; label: string }[];
  accountEmail: string;
}
export type SlackStartResult = { ok: true; start: SlackStart } | { ok: false; message: string };

/** A person a mention was matched to. */
export interface SlackTag {
  /** What was written, like `@dana`. */
  mention: string;
  userId: string;
  name: string;
}

/** A mention that was not turned into a tag, sent as plain text, and why. */
export interface SlackUnresolved {
  mention: string;
  /** No one in Slack has that name, or more than one does. */
  reason: "none" | "several";
}

/** Exactly what will be posted. Held in Murmur until the owner sends it or it is forgotten. */
export interface SlackPreview {
  token: string;
  channelLabel: string;
  accountEmail: string;
  /** The message as the owner will see it in Slack, with tags written as @names. */
  shown: string;
  tags: SlackTag[];
  unresolved: SlackUnresolved[];
  /** Whether mentions were looked up at all (the Slack tagging option). */
  taggingOn: boolean;
}
export type SlackPrepareResult =
  { ok: true; preview: SlackPreview } | { ok: false; message: string };

/** What the owner confirmed: the preview's token and nothing else, so the message cannot change after it was shown. */
export const slackSendInputSchema = z.strictObject({ token: z.string().min(1).max(64) });
export type SlackSendInput = z.infer<typeof slackSendInputSchema>;

export type SlackSendResult = { ok: true; channelLabel: string } | { ok: false; message: string };

export interface SlackUser {
  id: string;
  /** The handle (`dana`). */
  name: string;
  realName: string | null;
  displayName: string | null;
  email: string | null;
}
