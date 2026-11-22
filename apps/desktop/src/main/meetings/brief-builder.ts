import {
  BRIEF_LIMITS,
  BRIEF_SOURCE_IDS,
  BRIEF_SOURCE_TEXT,
  GMAIL_SCOPE_READ,
  type BriefItem,
  type BriefSettings,
  type BriefSourceId,
  type BriefSourceReport,
  type CalendarEvent,
  type ConnectorAccount,
  type ConnectorItem,
  type DataConnectorId,
  type GmailSettings,
  type GmailThread,
  type Meeting,
  type MeetingBrief,
  type MeetingSummary,
  type Task,
  type TaskFilter,
  type TasksView,
} from "@murmur/shared";
import { summaryText } from "../connectors/gmail/email-draft";

/**
 * Builds the brief of a calendar event (NT-11) from what is on this Mac and from the connectors
 * that are connected and turned on. The code gathers and numbers the sources and writes the lists,
 * so every line cites a source that exists; the local model is asked only for a short opening, and
 * it is used only if every number it cites is a real source.
 */
export interface BriefBuilder {
  /** Builds a brief for the event now. Never throws: a source that fails is reported in the brief. */
  build(event: CalendarEvent): Promise<MeetingBrief>;
  /** Each source's state for the Brief tab, without building anything. */
  availability(): BriefSourceReport[];
}

export interface BriefBuilderDeps {
  settings(): { brief: BriefSettings; gmail: GmailSettings };
  accounts(): ConnectorAccount[];
  meetings: { list(limit?: number): Meeting[] };
  summaries: { list(meetingId: string): MeetingSummary[] };
  tasks: { list(filter?: TaskFilter): TasksView };
  /** What a read connector has kept (Slack, Notion, Linear, GitHub). */
  connectorItems(connector: DataConnectorId): ConnectorItem[];
  /** Recent threads with these addresses, as plain text. May throw with a message for the owner. */
  gmailThreads(emails: string[], max: number): Promise<GmailThread[]>;
  /** One call of the local model. May reject when it cannot answer. */
  generate(request: { system: string; prompt: string; maxTokens: number }): Promise<string>;
  now(): number;
}

export const eventKeyOf = (event: Pick<CalendarEvent, "accountId" | "id">) =>
  `${event.accountId}:${event.id}`;

const STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "for",
  "meeting",
  "sync",
  "call",
  "weekly",
  "daily",
  "catch",
  "chat",
  "check",
  "standup",
  "review",
  "from",
  "about",
]);

/** The words of a title that can tell one meeting from another: lower case, no filler. */
const words = (text: string, min: number): string[] => [
  ...new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= min && !STOP_WORDS.has(word)),
  ),
];

const DAY = 86_400_000;
const date = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const oneLine = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

function system(): string {
  return [
    "You write a very short opening for a briefing before a meeting, for the person who owns these notes.",
    "Use only the numbered sources given. Write two or three plain sentences, and end every sentence with the number of the source it comes from in square brackets, like [2]. Never cite a number that is not in the list, and never invent names, dates or facts.",
    "Write plain text, with no markdown and no headings.",
  ].join("\n");
}

/** The model's opening if it is clean: plain, short, and every number it cites is a real source. */
export function cleanOpening(text: string, sourceCount: number): string | null {
  const flat = text
    .replace(/[#*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (flat === "" || flat.length > BRIEF_LIMITS.opening) return null;
  const cited = [...flat.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  if (cited.length === 0) return null;
  return cited.every((n) => n >= 1 && n <= sourceCount) ? flat : null;
}

export function createBriefBuilder(deps: BriefBuilderDeps): BriefBuilder {
  const connected = (connector: string) =>
    deps
      .accounts()
      .filter((account) => account.connector === connector && account.status === "connected");

  /** Whether a source can be used, apart from what it finds. */
  function availabilityOf(id: BriefSourceId): BriefSourceReport {
    const { label, connector } = BRIEF_SOURCE_TEXT[id];
    const { brief, gmail } = deps.settings();
    const report = (state: BriefSourceReport["state"], note: string | null): BriefSourceReport => ({
      id,
      label,
      state,
      count: 0,
      note,
    });
    if (!brief.sources[id]) return report("off", "Turned off for briefs in Settings.");
    if (connector === null) return report("used", null);
    const accounts = connected(connector);
    if (accounts.length === 0)
      return report("not-connected", `Connect ${label} on the Connectors page to add it.`);
    if (id === "gmail") {
      const allowed = accounts.some((account) => account.scopes.includes(GMAIL_SCOPE_READ));
      if (!gmail.briefContext || !allowed)
        return report(
          "needs-permission",
          "Turn on reading recent mail on the Connectors page and give Murmur permission.",
        );
    }
    return report("used", null);
  }

  const availability = () => BRIEF_SOURCE_IDS.map(availabilityOf);

  async function build(event: CalendarEvent): Promise<MeetingBrief> {
    const now = deps.now();
    const reports = new Map(availability().map((report) => [report.id, report]));
    const items: Omit<BriefItem, "n">[] = [];
    const bySource = new Map<BriefSourceId, Omit<BriefItem, "n">[]>();
    const add = (source: BriefSourceId, found: Omit<BriefItem, "n">[]) => {
      bySource.set(source, found);
    };

    const mine = new Set(deps.accounts().map((account) => account.email.toLowerCase()));
    const others = event.attendees.filter(
      (person) => !person.self && !mine.has(person.email.toLowerCase()),
    );
    const emails = others.map((person) => person.email.toLowerCase());
    const names = others
      .map((person) => person.name?.trim())
      .filter((name): name is string => !!name);
    const titleWords = words(event.title, 3);

    // Earlier meetings with the same people or the same title.
    let matched: Meeting[] = [];
    if (reports.get("meetings")!.state === "used") {
      matched = deps.meetings
        .list(200)
        .filter(
          (meeting) => meeting.startedAt < event.startMs && meeting.calendarEventId !== event.id,
        )
        .filter((meeting) => {
          const shared = (meeting.attendees ?? []).some((person) => emails.includes(person.email));
          const same = words(meeting.title, 3);
          const overlap = same.filter((word) => titleWords.includes(word)).length;
          return (
            shared ||
            meeting.title.trim().toLowerCase() === event.title.trim().toLowerCase() ||
            (titleWords.length >= 2 && overlap >= 2)
          );
        })
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, BRIEF_LIMITS.meetings);
      add(
        "meetings",
        matched.map((meeting) => {
          const latest = [...deps.summaries.list(meeting.id)].sort(
            (a, b) => b.version - a.version,
          )[0];
          return {
            source: "meetings" as const,
            title: meeting.title,
            text: latest ? summaryText(latest.markdown).slice(0, 1200) : "No summary was written.",
            at: meeting.startedAt,
            url: null,
            meetingId: meeting.id,
          };
        }),
      );
    }

    // Open tasks that involve the people, or that came from those meetings.
    if (reports.get("tasks")!.state === "used") {
      const first = new Set(names.map((name) => name.toLowerCase().split(/\s+/)[0]!));
      const wanted = new Set(matched.map((meeting) => meeting.id));
      const tasks = deps.tasks
        .list({ status: "open", owner: "all" })
        .tasks.filter((task: Task) => {
          const owner = task.owner?.toLowerCase() ?? "";
          const byOwner =
            owner !== "" &&
            (first.has(owner.split(/\s+/)[0]!) || names.some((n) => n.toLowerCase() === owner));
          return byOwner || (task.meetingId !== null && wanted.has(task.meetingId));
        })
        .slice(0, BRIEF_LIMITS.tasks);
      add(
        "tasks",
        tasks.map((task) => ({
          source: "tasks" as const,
          title: task.title,
          text: [
            task.title,
            task.owner ? `owner ${task.owner}` : task.ownerIsMe ? "mine" : null,
            task.dueOn ? `due ${task.dueOn}` : null,
          ]
            .filter(Boolean)
            .join(", "),
          at: task.updatedAt,
          url: null,
          meetingId: task.meetingId,
        })),
      );
    }

    // Mail with the people invited, read now and kept briefly by the caller.
    if (reports.get("gmail")!.state === "used") {
      try {
        const threads = await deps.gmailThreads(emails, deps.settings().gmail.maxThreadsPerBrief);
        add(
          "gmail",
          threads.map((thread) => {
            const last = thread.messages.at(-1);
            return {
              source: "gmail" as const,
              title: thread.subject,
              text: oneLine(last?.text ?? "", 600),
              at: last?.dateMs || null,
              url: null,
              meetingId: null,
            };
          }),
        );
      } catch (error) {
        reports.set("gmail", {
          ...reports.get("gmail")!,
          state: "failed",
          note:
            error instanceof Error && error.message ? error.message : "Gmail could not be read.",
        });
      }
    }

    // What Slack, Notion, Linear and GitHub kept that mentions these people or this meeting.
    const terms = [
      ...new Set([...names.flatMap((name) => words(name, 3)), ...words(event.title, 4)]),
    ];
    for (const source of ["slack", "notion", "linear", "github"] as const) {
      if (reports.get(source)!.state !== "used") continue;
      const scored = deps
        .connectorItems(source)
        .map((item) => {
          const hay = `${item.title} ${item.text}`.toLowerCase();
          return { item, score: terms.filter((term) => hay.includes(term)).length };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
        .slice(0, BRIEF_LIMITS.items);
      add(
        source,
        scored.map(({ item }) => ({
          source,
          title: item.title,
          text: oneLine(item.text, 600),
          at: item.updatedAt || null,
          url: item.url,
          meetingId: null,
        })),
      );
    }

    // Number the items in a fixed order, and keep each source within its share of the budget.
    for (const source of BRIEF_SOURCE_IDS) {
      let used = 0;
      for (const found of bySource.get(source) ?? []) {
        if (used >= BRIEF_LIMITS.charsPerSource) break;
        const text = found.text.slice(0, BRIEF_LIMITS.charsPerSource - used);
        used += text.length;
        items.push({ ...found, text });
      }
    }
    const numbered: BriefItem[] = items.map((item, index) => ({ ...item, n: index + 1 }));

    const sources: BriefSourceReport[] = BRIEF_SOURCE_IDS.map((id) => {
      const report = reports.get(id)!;
      const count = numbered.filter((item) => item.source === id).length;
      return report.state === "used"
        ? {
            ...report,
            state: count > 0 ? "used" : "empty",
            count,
            note: count > 0 ? null : "Nothing about this meeting.",
          }
        : report;
    });

    // The model writes only the opening, and only when there is something to say.
    let opening: string | null = null;
    if (numbered.length > 0) {
      const facts = numbered
        .map(
          (item) =>
            `[${item.n}] ${BRIEF_SOURCE_TEXT[item.source].label}, ${item.title}: ${item.text}`,
        )
        .join("\n");
      try {
        opening = cleanOpening(
          await deps.generate({
            system: system(),
            prompt: `Meeting: ${event.title}\nPeople: ${[...names, ...emails.filter((e) => !others.some((o) => o.name && o.email.toLowerCase() === e))].join(", ") || "not listed"}\n\nSources:\n${facts}`,
            maxTokens: 300,
          }),
          numbered.length,
        );
      } catch {
        opening = null;
      }
    }

    const lines: string[] = [];
    if (opening) lines.push("## In short", opening, "");
    lines.push("## Who is coming");
    lines.push(
      others.length === 0
        ? "- Nobody else is on the invitation."
        : `- ${others.map((person) => person.name || person.email).join(", ")}`,
    );
    const section = (title: string, source: BriefSourceId, line: (item: BriefItem) => string) => {
      const mineItems = numbered.filter((item) => item.source === source);
      if (mineItems.length === 0) return;
      lines.push("", `## ${title}`, ...mineItems.map(line));
    };
    section(
      "Last time",
      "meetings",
      (item) =>
        `- ${item.title} (${item.at ? date(item.at) : "earlier"}): ${oneLine(item.text, 260)} [${item.n}]`,
    );
    section("Open tasks", "tasks", (item) => `- ${oneLine(item.text, 200)} [${item.n}]`);
    const context = numbered.filter(
      (item) => item.source !== "meetings" && item.source !== "tasks",
    );
    if (context.length > 0) {
      lines.push("", "## Recent context");
      for (const item of context)
        lines.push(
          `- ${BRIEF_SOURCE_TEXT[item.source].label}, ${oneLine(item.title, 80)}: ${oneLine(item.text, 200)} [${item.n}]`,
        );
    }

    return {
      eventKey: eventKeyOf(event),
      title: event.title,
      startMs: event.startMs,
      builtAt: now,
      markdown: lines.join("\n"),
      sources,
      items: numbered,
      modelWrote: opening !== null,
    };
  }

  return { build, availability };
}

/** Days after a meeting that its brief is kept. */
export const BRIEF_KEEP_MS = 2 * DAY;
