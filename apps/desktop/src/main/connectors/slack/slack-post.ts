import {
  SLACK_ID,
  SLACK_POST_LIMITS,
  SLACK_SCOPE_WRITE,
  CONNECTOR_CATALOGUE,
  connectorChoice,
  hasScope,
  slackPrepareInputSchema,
  slackSendInputSchema,
  type ConnectorAccount,
  type ConnectorSettings,
  type Meeting,
  type MeetingSummary,
  type SlackPostSource,
  type SlackPrepareResult,
  type SlackSendResult,
  type SlackStartResult,
  type Task,
} from "@murmur/shared";
import { summaryText } from "../gmail/email-draft";
import { ConnectorError, type ConnectorService } from "../connector-service";
import { ReadError, defaultSleep, type Fetch } from "../data/http";
import {
  SLACK_ORIGIN,
  listChannels,
  listSlackUsers,
  postSlackMessage,
  resolveMentions,
} from "./slack";

/**
 * "Send to Slack" (CN-05) and tagging (CN-14). The owner writes or edits the message and picks a
 * channel; `prepare` builds exactly what would be posted (tags only if the tagging option is on,
 * every one listed) and holds it; `send` posts that held message and nothing else. A message is
 * never posted by `prepare`, and the text cannot change between the preview and the post, because
 * the post takes only the preview's token.
 */
export interface SlackPostService {
  /** Whether sending works now, and why not. */
  state(): { available: boolean; reason: string | null };
  /** A starting message for a task or a meeting's summary, and the channels to send to. */
  start(source: SlackPostSource): Promise<SlackStartResult>;
  /** The preview of a message: nothing is sent. */
  prepare(input: unknown): Promise<SlackPrepareResult>;
  /** Posts the message of a preview, once. */
  send(input: unknown): Promise<SlackSendResult>;
}

export interface SlackPostDeps {
  connectors: Pick<ConnectorService, "list" | "authorizedFetch">;
  settings(): { connectors: ConnectorSettings; tagging: boolean };
  tasks: { get(id: string): Task | null };
  meetings: { get(id: string): Meeting | null };
  summaries: { list(meetingId: string): MeetingSummary[] };
  now(): number;
  newId(): string;
  sleep?(ms: number): Promise<void>;
}

interface Pending {
  accountId: string;
  channelId: string;
  channelLabel: string;
  /** Exactly what is posted. */
  posted: string;
  createdAt: number;
}

/** A preview is forgotten after this long. */
export const PREVIEW_MS = 15 * 60_000;

export function createSlackPost(deps: SlackPostDeps): SlackPostService {
  const limits = { sleep: deps.sleep ?? defaultSleep };
  const pending = new Map<string, Pending>();

  const entry = CONNECTOR_CATALOGUE.find((candidate) => candidate.id === SLACK_ID)!;
  const accounts = (): ConnectorAccount[] =>
    deps.connectors.list().filter((account) => account.connector === SLACK_ID);
  /** The accounts a message can be posted from: connected, not read only, with the permission. */
  const usable = (): ConnectorAccount[] =>
    accounts().filter(
      (account) =>
        account.status === "connected" &&
        !connectorChoice(deps.settings().connectors, entry).readOnly &&
        hasScope(account.scopes, SLACK_SCOPE_WRITE),
    );

  const state = () => {
    const all = accounts();
    if (all.length === 0)
      return { available: false, reason: "Connect Slack on the Connectors page first." };
    if (!all.some((account) => account.status === "connected"))
      return { available: false, reason: "Slack needs to be connected again." };
    if (connectorChoice(deps.settings().connectors, entry).readOnly)
      return {
        available: false,
        reason: "Slack is set to read only. Turn that off on the Connectors page to send messages.",
      };
    if (usable().length === 0)
      return {
        available: false,
        reason:
          "Murmur does not have permission to post in Slack yet. Give it on the Connectors page.",
      };
    return { available: true, reason: null };
  };

  const forget = () => {
    const cutoff = deps.now() - PREVIEW_MS;
    for (const [token, item] of pending) if (item.createdAt < cutoff) pending.delete(token);
  };

  /** A request with the account's token, only to Slack's own address. */
  const fetchFor =
    (account: ConnectorAccount): Fetch =>
    (url, init) => {
      if (new URL(url).origin !== SLACK_ORIGIN)
        throw new ReadError("Refused a request to another address.");
      return deps.connectors.authorizedFetch(account.id, url, init);
    };

  const failure = (error: unknown) =>
    error instanceof ReadError || error instanceof ConnectorError
      ? { ok: false as const, message: error.message }
      : { ok: false as const, message: "Slack could not be reached. Nothing was sent." };

  function startText(source: SlackPostSource): string | null {
    if (source.kind === "ask") return "";
    if (source.kind === "task") {
      const task = deps.tasks.get(source.id);
      if (!task) return null;
      const meeting = task.meetingId ? deps.meetings.get(task.meetingId) : null;
      return [
        `Task: ${task.title}${task.owner ? ` (${task.owner})` : ""}${task.dueOn ? `, due ${task.dueOn}` : ""}`,
        task.notes.trim(),
        meeting ? `From the meeting “${meeting.title}”` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, SLACK_POST_LIMITS.text);
    }
    const meeting = deps.meetings.get(source.id);
    if (!meeting) return null;
    const latest = [...deps.summaries.list(meeting.id)].sort((a, b) => b.version - a.version)[0];
    return `${meeting.title}\n\n${latest ? summaryText(latest.markdown) : "No summary yet."}`.slice(
      0,
      SLACK_POST_LIMITS.text,
    );
  }

  return {
    state,

    async start(source) {
      const current = state();
      if (!current.available)
        return { ok: false, message: current.reason ?? "Slack is not available." };
      const text = startText(source);
      if (text === null)
        return {
          ok: false,
          message: source.kind === "task" ? "That task is gone." : "That meeting is gone.",
        };
      const account = usable()[0]!;
      try {
        const channels = await listChannels({ fetch: fetchFor(account), limits });
        return { ok: true, start: { text, channels, accountEmail: account.email } };
      } catch (error) {
        return failure(error);
      }
    },

    async prepare(raw) {
      forget();
      const parsed = slackPrepareInputSchema.safeParse(raw);
      if (!parsed.success)
        return {
          ok: false,
          message: "A message needs some text and a channel, within the limits.",
        };
      const input = parsed.data;
      const current = state();
      if (!current.available)
        return { ok: false, message: current.reason ?? "Slack is not available." };
      const account = usable()[0]!;
      try {
        const fetch = fetchFor(account);
        const channel = (await listChannels({ fetch, limits })).find(
          (c) => c.id === input.channelId,
        );
        if (!channel)
          return { ok: false, message: "That channel is not there any more. Choose another." };
        // People are looked up only when the tagging option is on; otherwise the text is only escaped.
        const tagging = deps.settings().tagging;
        const users = tagging ? await listSlackUsers({ fetch, limits }) : null;
        const result = resolveMentions(input.text, users, SLACK_POST_LIMITS.mentions);
        const token = deps.newId();
        pending.set(token, {
          accountId: account.id,
          channelId: channel.id,
          channelLabel: channel.label,
          posted: result.posted,
          createdAt: deps.now(),
        });
        return {
          ok: true,
          preview: {
            token,
            channelLabel: channel.label,
            accountEmail: account.email,
            shown: result.shown,
            tags: result.tags,
            unresolved: result.unresolved,
            taggingOn: tagging,
          },
        };
      } catch (error) {
        return failure(error);
      }
    },

    async send(raw) {
      forget();
      const parsed = slackSendInputSchema.safeParse(raw);
      if (!parsed.success) return { ok: false, message: "Preview the message first." };
      const held = pending.get(parsed.data.token);
      if (!held)
        return { ok: false, message: "That preview has expired. Preview the message again." };
      const current = state();
      if (!current.available)
        return { ok: false, message: current.reason ?? "Slack is not available." };
      const account = usable().find((candidate) => candidate.id === held.accountId);
      if (!account) return { ok: false, message: "That Slack account cannot post now." };
      try {
        await postSlackMessage({
          fetch: fetchFor(account),
          limits,
          channelId: held.channelId,
          text: held.posted,
        });
        // Sent once: the preview cannot be sent again.
        pending.delete(parsed.data.token);
        return { ok: true, channelLabel: held.channelLabel };
      } catch (error) {
        // The preview is kept, so a failure can be tried again without writing the message again.
        return failure(error);
      }
    },
  };
}
