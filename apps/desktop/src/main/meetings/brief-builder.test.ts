import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRIEF_SETTINGS,
  DEFAULT_GMAIL_SETTINGS,
  GMAIL_SCOPE_READ,
  type BriefSettings,
  type CalendarEvent,
  type ConnectorAccount,
  type ConnectorItem,
  type GmailSettings,
  type GmailThread,
  type Meeting,
  type MeetingSummary,
  type Task,
} from "@murmur/shared";
import { cleanOpening, createBriefBuilder, eventKeyOf } from "./brief-builder";

const NOW = Date.UTC(2026, 10, 22, 12, 0);
const DAY = 86_400_000;

const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: "e1",
  accountId: "cal1",
  connector: "googleCalendar",
  title: "Budget review",
  startMs: NOW + 30 * 60_000,
  endMs: NOW + 90 * 60_000,
  allDay: false,
  location: null,
  attendees: [
    {
      name: "Dana Lee",
      email: "dana@example.com",
      response: "accepted",
      self: false,
      organizer: true,
    },
    { name: "Me", email: "me@example.com", response: "accepted", self: true, organizer: false },
  ],
  joinUrl: null,
  response: "accepted",
  isPrivate: false,
  ...over,
});

const meeting = (id: string, over: Partial<Meeting> = {}): Meeting =>
  ({
    id,
    title: "Budget review",
    startedAt: NOW - 7 * DAY,
    calendarEventId: null,
    attendees: [{ name: "Dana Lee", email: "dana@example.com" }],
    ...over,
  }) as Meeting;

const summary = (meetingId: string, markdown: string, version = 1): MeetingSummary => ({
  id: `s-${meetingId}-${version}`,
  meetingId,
  version,
  skillId: "k",
  skillName: "General",
  modelId: "x",
  quick: false,
  markdown,
  createdAt: 1,
  feedback: null,
});

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  notes: "",
  owner: "Dana Lee",
  ownerIsMe: false,
  dueOn: "2026-11-27",
  status: "open",
  source: "meeting",
  meetingId: null,
  meetingTitle: null,
  sourceSegmentId: null,
  sourceState: "none",
  position: 0,
  createdAt: 1,
  updatedAt: 5,
  completedAt: null,
  ...over,
});

const item = (
  connector: ConnectorItem["connector"],
  id: string,
  over: Partial<ConnectorItem> = {},
): ConnectorItem => ({
  id,
  connector,
  kind: "message",
  title: "#finance",
  text: "Dana asked about the budget numbers",
  truncated: false,
  updatedAt: NOW - DAY,
  url: null,
  tags: [],
  ...over,
});

const account = (connector: string, scopes: string[] = []): ConnectorAccount => ({
  id: `acct-${connector}`,
  connector,
  email: connector === "gmail" ? "me@example.com" : `me@${connector}`,
  scopes,
  status: "connected",
  statusReason: null,
  lastSyncAt: null,
  createdAt: 1,
});

function setup(
  options: {
    brief?: Partial<BriefSettings["sources"]>;
    gmail?: Partial<GmailSettings>;
    accounts?: ConnectorAccount[];
    meetings?: Meeting[];
    summaries?: Record<string, MeetingSummary[]>;
    tasks?: Task[];
    items?: Partial<Record<string, ConnectorItem[]>>;
    threads?: () => Promise<GmailThread[]>;
    generate?: (prompt: string) => Promise<string>;
  } = {},
) {
  const prompts: string[] = [];
  const taskFilters: unknown[] = [];
  const threadCalls: { emails: string[]; max: number }[] = [];
  const builder = createBriefBuilder({
    settings: () => ({
      brief: {
        ...DEFAULT_BRIEF_SETTINGS,
        sources: { ...DEFAULT_BRIEF_SETTINGS.sources, ...options.brief },
      },
      gmail: { ...DEFAULT_GMAIL_SETTINGS, ...options.gmail },
    }),
    accounts: () => options.accounts ?? [account("googleCalendar")],
    meetings: { list: () => options.meetings ?? [] },
    summaries: { list: (id) => options.summaries?.[id] ?? [] },
    tasks: {
      list: (filter) => {
        taskFilters.push(filter);
        return { tasks: options.tasks ?? [], undo: null };
      },
    },
    connectorItems: (connector) => options.items?.[connector] ?? [],
    gmailThreads: async (emails, max) => {
      threadCalls.push({ emails, max });
      return options.threads ? options.threads() : [];
    },
    generate: async (request) => {
      prompts.push(request.prompt);
      return options.generate ? options.generate(request.prompt) : "Nothing to add.";
    },
    now: () => NOW,
  });
  return { builder, prompts, taskFilters, threadCalls };
}

describe("meeting brief (NT-11)", () => {
  it("builds from earlier meetings with no connector at all, and cites them", async () => {
    const t = setup({
      meetings: [meeting("m1")],
      summaries: { m1: [summary("m1", "## Decisions\n- Cut the travel budget [3:12](seg:x)")] },
      generate: async () => "You settled the travel budget last time [1].",
    });
    const brief = await t.builder.build(event());
    expect(brief.eventKey).toBe("cal1:e1");
    expect(brief.items).toEqual([
      expect.objectContaining({
        n: 1,
        source: "meetings",
        title: "Budget review",
        meetingId: "m1",
      }),
    ]);
    expect(brief.items[0]!.text).toBe("Decisions\n- Cut the travel budget");
    expect(brief.markdown).toContain("## In short\nYou settled the travel budget last time [1].");
    expect(brief.markdown).toContain("## Who is coming\n- Dana Lee");
    expect(brief.markdown).toMatch(
      /## Last time\n- Budget review \(Nov 15\): Decisions - Cut the travel budget \[1\]/,
    );
    expect(brief.modelWrote).toBe(true);
    expect(brief.builtAt).toBe(NOW);
  });

  it("says which sources it used with their counts, and which are not connected", async () => {
    const t = setup({ meetings: [meeting("m1")], summaries: { m1: [summary("m1", "x")] } });
    const brief = await t.builder.build(event());
    const byId = Object.fromEntries(brief.sources.map((s) => [s.id, s]));
    expect(byId.meetings).toMatchObject({ state: "used", count: 1 });
    expect(byId.tasks).toMatchObject({ state: "empty", count: 0 });
    expect(byId.slack).toMatchObject({ state: "off" });
  });

  it("tells the owner what to connect for a source that is on but not connected", async () => {
    const t = setup({ brief: { slack: true, notion: true } });
    const brief = await t.builder.build(event());
    expect(brief.sources.find((s) => s.id === "slack")).toMatchObject({
      state: "not-connected",
      note: "Connect Slack on the Connectors page to add it.",
    });
    expect(brief.sources.find((s) => s.id === "notion")?.state).toBe("not-connected");
  });

  it("finds earlier meetings by the people, or by the title, but not later ones, its own, or more than three", async () => {
    const t = setup({
      meetings: [
        meeting("same-people", { title: "Something else", startedAt: NOW - 2 * DAY }),
        meeting("same-title", { title: "budget review", attendees: [], startedAt: NOW - 3 * DAY }),
        meeting("third", { title: "Budget review", attendees: [], startedAt: NOW - 4 * DAY }),
        meeting("older", { startedAt: NOW - 20 * DAY }),
        meeting("later", { startedAt: NOW + DAY }),
        meeting("own", { calendarEventId: "e1", startedAt: NOW - DAY }),
        meeting("stranger", { title: "Lunch", attendees: [{ name: "X", email: "x@example.com" }] }),
      ],
    });
    const brief = await t.builder.build(event());
    expect(brief.items.map((i) => i.meetingId)).toEqual(["same-people", "same-title", "third"]);
  });

  it("also finds a meeting that shares two words of a longer title", async () => {
    const t = setup({
      meetings: [
        meeting("a", { title: "Planning the budget for Q4", attendees: [] }),
        meeting("b", { title: "Budget lunch", attendees: [] }),
      ],
    });
    const brief = await t.builder.build(event({ title: "Budget planning offsite" }));
    expect(brief.items.map((i) => i.meetingId)).toEqual(["a"]);
  });

  it("uses the latest summary, and says when there is none", async () => {
    const t = setup({
      meetings: [meeting("m1"), meeting("m2", { startedAt: NOW - 8 * DAY })],
      summaries: { m1: [summary("m1", "Old", 1), summary("m1", "New", 2)] },
    });
    const brief = await t.builder.build(event());
    expect(brief.items.map((i) => i.text)).toEqual(["New", "No summary was written."]);
  });

  it("lists open tasks of the people invited or from those meetings, and asks only for open ones", async () => {
    const t = setup({
      meetings: [meeting("m1")],
      tasks: [
        task("1"),
        task("2", { owner: "Dana", dueOn: null }),
        task("3", { owner: "Pat", meetingId: "m1" }),
        task("4", { owner: "Pat", meetingId: "other" }),
        task("5", { owner: null, ownerIsMe: true }),
      ],
    });
    const brief = await t.builder.build(event());
    const tasks = brief.items.filter((i) => i.source === "tasks");
    expect(tasks.map((i) => i.title)).toEqual(["Task 1", "Task 2", "Task 3"]);
    expect(tasks[0]!.text).toBe("Task 1, owner Dana Lee, due 2026-11-27");
    expect(t.taskFilters).toEqual([{ status: "open", owner: "all" }]);
    expect(brief.markdown).toMatch(
      /## Open tasks\n- Task 1, owner Dana Lee, due 2026-11-27 \[\d\]/,
    );
  });

  it("removes a source from the brief when it is turned off", async () => {
    const meetings = [meeting("m1")];
    const on = await setup({ meetings }).builder.build(event());
    expect(on.items).toHaveLength(1);
    const off = await setup({ meetings, brief: { meetings: false } }).builder.build(event());
    expect(off.items).toHaveLength(0);
    expect(off.sources.find((s) => s.id === "meetings")?.state).toBe("off");
    expect(off.markdown).not.toContain("Last time");
  });

  it("adds what Slack, Notion, Linear and GitHub kept that mentions the people, and leaves out the rest", async () => {
    const t = setup({
      brief: { slack: true, notion: true, linear: true, github: true },
      accounts: ["slack", "notion", "linear", "github"].map((c) => account(c)),
      items: {
        slack: [item("slack", "s1"), item("slack", "s2", { text: "Lunch plans for Friday" })],
        notion: [
          item("notion", "n1", { kind: "page", title: "Budget review notes", text: "Agenda" }),
        ],
        linear: [
          item("linear", "l1", {
            kind: "issue",
            title: "ENG-1 Fix login",
            text: "Done: Fix login",
          }),
        ],
        github: [
          item("github", "g1", {
            kind: "pull_request",
            title: "acme/app#7 Dana's budget fix",
            text: "open: fix",
          }),
        ],
      },
    });
    const brief = await t.builder.build(event());
    expect(brief.items.map((i) => [i.source, i.title])).toEqual([
      ["slack", "#finance"],
      ["notion", "Budget review notes"],
      ["github", "acme/app#7 Dana's budget fix"],
    ]);
    expect(brief.items.map((i) => i.n)).toEqual([1, 2, 3]);
    const byId = Object.fromEntries(brief.sources.map((s) => [s.id, s]));
    expect(byId.slack).toMatchObject({ state: "used", count: 1 });
    expect(byId.linear).toMatchObject({
      state: "empty",
      count: 0,
      note: "Nothing about this meeting.",
    });
    expect(brief.markdown).toContain("## Recent context");
    expect(brief.markdown).toContain("- Slack, #finance: Dana asked about the budget numbers [1]");
  });

  it("keeps each source within its share of the budget", async () => {
    const long = "budget ".repeat(400);
    const t = setup({
      brief: { slack: true },
      accounts: [account("slack")],
      items: {
        slack: Array.from({ length: 5 }, (_, i) =>
          item("slack", `s${i}`, { text: long, title: `#c${i}` }),
        ),
      },
    });
    const brief = await t.builder.build(event());
    // Each item is cut to 600 characters, so five fit in the 6,000.
    expect(brief.items.length).toBe(5);
    expect(brief.items.every((i) => i.text.length <= 600)).toBe(true);
  });

  describe("Gmail", () => {
    const threads = async (): Promise<GmailThread[]> => [
      {
        id: "t1",
        subject: "Budget numbers",
        messages: [
          {
            id: "m",
            from: "dana@example.com",
            to: "me@example.com",
            dateMs: NOW - DAY,
            text: "Here are the numbers.",
          },
        ],
      },
    ];

    it("is off by default, and needs the permission before it reads anything", async () => {
      const off = setup({ accounts: [account("gmail", [GMAIL_SCOPE_READ])] });
      expect((await off.builder.build(event())).sources.find((s) => s.id === "gmail")?.state).toBe(
        "off",
      );
      const noPermission = setup({
        brief: { gmail: true },
        gmail: { briefContext: true },
        accounts: [account("gmail", ["openid"])],
        threads,
      });
      const brief = await noPermission.builder.build(event());
      expect(brief.sources.find((s) => s.id === "gmail")).toMatchObject({
        state: "needs-permission",
      });
      expect(noPermission.threadCalls).toEqual([]);
      const noSetting = setup({
        brief: { gmail: true },
        accounts: [account("gmail", [GMAIL_SCOPE_READ])],
        threads,
      });
      expect(
        (await noSetting.builder.build(event())).sources.find((s) => s.id === "gmail")?.state,
      ).toBe("needs-permission");
      expect(noSetting.threadCalls).toEqual([]);
    });

    it("reads the threads with the people invited, up to the limit, and cites them", async () => {
      const t = setup({
        brief: { gmail: true },
        gmail: { briefContext: true, maxThreadsPerBrief: 3 },
        accounts: [account("gmail", [GMAIL_SCOPE_READ])],
        threads,
      });
      const brief = await t.builder.build(event());
      expect(t.threadCalls).toEqual([{ emails: ["dana@example.com"], max: 3 }]);
      expect(brief.items).toEqual([
        expect.objectContaining({
          n: 1,
          source: "gmail",
          title: "Budget numbers",
          text: "Here are the numbers.",
        }),
      ]);
      expect(brief.markdown).toContain("- Gmail, Budget numbers: Here are the numbers. [1]");
    });

    it("reports a failure in the brief and builds the rest", async () => {
      const t = setup({
        brief: { gmail: true },
        gmail: { briefContext: true },
        accounts: [account("gmail", [GMAIL_SCOPE_READ])],
        meetings: [meeting("m1")],
        threads: async () => {
          throw new Error("Gmail answered 500.");
        },
      });
      const brief = await t.builder.build(event());
      expect(brief.sources.find((s) => s.id === "gmail")).toMatchObject({
        state: "failed",
        note: "Gmail answered 500.",
      });
      expect(brief.items.map((i) => i.source)).toEqual(["meetings"]);
    });
  });

  describe("the opening the model writes", () => {
    it("is left out when it cites a source that does not exist, or none, or the model fails", async () => {
      for (const generate of [
        async () => "Dana asked about money [7].",
        async () => "Dana asked about money.",
        async () => {
          throw new Error("no model");
        },
      ]) {
        const t = setup({ meetings: [meeting("m1")], generate });
        const brief = await t.builder.build(event());
        expect(brief.modelWrote).toBe(false);
        expect(brief.markdown).not.toContain("In short");
        expect(brief.markdown).toContain("## Last time");
      }
    });

    it("is not asked for when there is nothing to cite", async () => {
      const t = setup();
      const brief = await t.builder.build(event());
      expect(t.prompts).toEqual([]);
      expect(brief.markdown).toBe("## Who is coming\n- Dana Lee");
    });

    it("is given the sources numbered, and nothing the owner did not choose", async () => {
      const t = setup({
        meetings: [meeting("m1")],
        summaries: { m1: [summary("m1", "Cut travel")] },
        brief: { slack: false },
        items: { slack: [item("slack", "s1")] },
      });
      await t.builder.build(event());
      expect(t.prompts[0]).toContain("[1] Earlier meetings, Budget review: Cut travel");
      expect(t.prompts[0]).not.toContain("#finance");
    });
  });

  it("says nobody else is invited when there is nobody", async () => {
    const t = setup();
    const brief = await t.builder.build(
      event({
        attendees: [
          {
            name: "Me",
            email: "me@example.com",
            response: "accepted",
            self: true,
            organizer: true,
          },
        ],
      }),
    );
    expect(brief.markdown).toContain("- Nobody else is on the invitation.");
  });

  it("reports each source for the Brief tab without building anything", () => {
    const t = setup({ brief: { slack: true, gmail: true }, accounts: [account("slack")] });
    const states = Object.fromEntries(t.builder.availability().map((s) => [s.id, s.state]));
    expect(states).toEqual({
      meetings: "used",
      tasks: "used",
      gmail: "not-connected",
      slack: "used",
      notion: "off",
      linear: "off",
      github: "off",
    });
    expect(t.prompts).toEqual([]);
  });
});

describe("cleanOpening", () => {
  it("keeps plain text that cites real sources, flattened to one line", () => {
    expect(cleanOpening("**Hello** there [1].\n\nMore [2].", 2)).toBe("Hello there [1]. More [2].");
  });
  it("refuses a missing, impossible or runaway citation", () => {
    expect(cleanOpening("No citation.", 2)).toBeNull();
    expect(cleanOpening("Bad [0].", 2)).toBeNull();
    expect(cleanOpening("Bad [3].", 2)).toBeNull();
    expect(cleanOpening("", 2)).toBeNull();
    expect(cleanOpening(`${"x".repeat(800)} [1]`, 2)).toBeNull();
  });
});

describe("eventKeyOf", () => {
  it("joins the account and the event", () => {
    expect(eventKeyOf({ accountId: "a", id: "b" })).toBe("a:b");
  });
});
