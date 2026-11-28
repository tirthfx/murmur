// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BRIEF_SETTINGS,
  type BriefOverview,
  type BriefSourceReport,
  type MeetingBrief,
} from "@murmur/shared";
import { BriefBody, BriefPanel, MeetingBriefTab } from "./BriefPanel";
import { createMockApi } from "./test-api";

const START = Date.UTC(2026, 10, 22, 14, 0);

const sources = (
  over: Partial<Record<string, Partial<BriefSourceReport>>> = {},
): BriefSourceReport[] =>
  (
    [
      ["meetings", "Earlier meetings", "used", null],
      ["tasks", "Open tasks", "used", null],
      ["gmail", "Gmail", "not-connected", "Connect Gmail on the Connectors page to add it."],
      ["slack", "Slack", "off", "Turned off for briefs in Settings."],
      ["notion", "Notion", "off", null],
      ["linear", "Linear", "off", null],
      ["github", "GitHub", "off", null],
    ] as const
  ).map(([id, label, state, note]) => ({ id, label, state, count: 0, note, ...over[id] }));

const overview = (over: Partial<BriefOverview> = {}): BriefOverview => ({
  calendarConnected: true,
  events: [
    {
      eventKey: "c:e1",
      title: "Budget review",
      startMs: START,
      endMs: START + 3_600_000,
      people: ["Dana Lee"],
      builtAt: null,
    },
    {
      eventKey: "c:e2",
      title: "Design sync",
      startMs: START + 7_200_000,
      endMs: START + 9_000_000,
      people: [],
      builtAt: 5,
    },
  ],
  sources: sources(),
  settings: DEFAULT_BRIEF_SETTINGS,
  ...over,
});

const brief = (over: Partial<MeetingBrief> = {}): MeetingBrief => ({
  eventKey: "c:e1",
  title: "Budget review",
  startMs: START,
  builtAt: START - 1_800_000,
  markdown:
    "## In short\nYou cut travel [1].\n\n## Who is coming\n- Dana Lee\n\n## Last time\n- Budget review (Nov 15): Cut travel [1]",
  sources: sources({ meetings: { count: 1 } }),
  items: [
    {
      n: 1,
      source: "meetings",
      title: "Budget review",
      text: "Cut travel",
      at: START - 7 * 86_400_000,
      url: null,
      meetingId: "m1",
    },
    {
      n: 2,
      source: "linear",
      title: "ENG-1 Fix",
      text: "Done",
      at: null,
      url: "https://linear.app/acme/issue/ENG-1",
      meetingId: null,
    },
  ],
  modelWrote: true,
  ...over,
});

let api: ReturnType<typeof createMockApi>;
const openMeeting = vi.fn();

beforeEach(() => {
  api = createMockApi();
  api.briefOverview = vi.fn().mockResolvedValue(overview());
  openMeeting.mockClear();
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

describe("Brief tab (NT-11)", () => {
  it("says what to connect when there is no calendar and no connector, and still lists the sources", async () => {
    api.briefOverview = vi
      .fn()
      .mockResolvedValue(overview({ calendarConnected: false, events: [] }));
    render(<BriefPanel onOpenMeeting={openMeeting} />);
    expect(await screen.findByText("Connect a calendar to see your meetings here")).toBeTruthy();
    const list = within(screen.getByRole("list", { name: "Sources used for briefs" }));
    expect(list.getByText("Earlier meetings")).toBeTruthy();
    expect(list.getByText("Not connected")).toBeTruthy();
    expect(list.getByText("Connect Gmail on the Connectors page to add it.")).toBeTruthy();
    expect(screen.getByText("Add more to your briefs")).toBeTruthy();
    expect(screen.getByText(/Connect Gmail on the Connectors page, and turn it on/)).toBeTruthy();
  });

  it("lists the meetings, says there is no brief yet and builds one on request", async () => {
    api.briefBuild = vi.fn().mockResolvedValue({ ok: true, brief: brief() });
    render(<BriefPanel onOpenMeeting={openMeeting} />);
    expect(
      await screen.findByText(/No brief for “Budget review” yet/, undefined, { timeout: 5000 }),
    ).toBeTruthy();
    expect(screen.getByText(/With Dana Lee/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Build the brief" }));
    await waitFor(() => expect(api.briefBuild).toHaveBeenCalledWith("c:e1"), { timeout: 5000 });
    // A busy CI machine can take longer than the default second.
    const view = await screen.findByLabelText("Brief for Budget review", undefined, {
      timeout: 5000,
    });
    expect(within(view).getByText("In short")).toBeTruthy();
    expect(within(view).getAllByLabelText("Source 1").length).toBeGreaterThan(0);
    expect(
      await screen.findByRole("button", { name: "Build the brief again" }, { timeout: 5000 }),
    ).toBeTruthy();
  }, 20_000);

  it("keeps a brief just built when the first, empty answer arrives late", async () => {
    let answer: (found: null) => void = () => {};
    api.briefGet = vi.fn(() => new Promise<null>((resolve) => (answer = resolve)));
    api.briefBuild = vi.fn().mockResolvedValue({ ok: true, brief: brief() });
    render(<BriefPanel onOpenMeeting={openMeeting} />);
    fireEvent.click(await screen.findByRole("button", { name: "Build the brief" }));
    expect(await screen.findByLabelText("Brief for Budget review")).toBeTruthy();
    answer(null);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Build the brief again" })).toBeTruthy(),
    );
    expect(screen.getByLabelText("Brief for Budget review")).toBeTruthy();
  });

  it("cites its sources, with a way to open the meeting or the item", async () => {
    api.briefGet = vi.fn().mockResolvedValue(brief());
    render(<BriefPanel onOpenMeeting={openMeeting} />);
    const sourcesList = within(await screen.findByRole("list", { name: "Sources of the brief" }));
    expect(sourcesList.getByText(/\[1\] Earlier meetings: Budget review/)).toBeTruthy();
    expect(sourcesList.getByText(/\[2\] Linear: ENG-1 Fix/)).toBeTruthy();
    fireEvent.click(sourcesList.getByRole("button", { name: "Open the meeting “Budget review”" }));
    expect(openMeeting).toHaveBeenCalledWith("m1");
    fireEvent.click(sourcesList.getByRole("button", { name: "Open “ENG-1 Fix” in Linear" }));
    expect(api.briefOpen).toHaveBeenCalledWith("https://linear.app/acme/issue/ENG-1");
  });

  it("shows each source's state with the count of items it gave", async () => {
    api.briefGet = vi.fn().mockResolvedValue(brief());
    render(<BriefPanel onOpenMeeting={openMeeting} />);
    const list = within(await screen.findByRole("list", { name: "Sources used for briefs" }));
    await waitFor(() => expect(list.getByText("1 item")).toBeTruthy());
    expect(list.getAllByText("Off").length).toBeGreaterThan(0);
  });

  it("says when the local model wrote no opening", async () => {
    api.briefGet = vi.fn().mockResolvedValue(brief({ modelWrote: false }));
    render(<BriefPanel onOpenMeeting={openMeeting} />);
    expect(await screen.findByText(/the local model did not write one/)).toBeTruthy();
  });

  it("shows why a brief could not be built", async () => {
    api.briefBuild = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "The brief could not be built just now." });
    render(<BriefPanel onOpenMeeting={openMeeting} />);
    fireEvent.click(await screen.findByRole("button", { name: "Build the brief" }));
    expect(await screen.findByText("The brief could not be built just now.")).toBeTruthy();
  });

  it("opens on the meeting the menu bar asked for", async () => {
    api.briefGet = vi
      .fn()
      .mockImplementation(async (key: string) =>
        key === "c:e2" ? brief({ eventKey: "c:e2", title: "Design sync" }) : null,
      );
    render(<BriefPanel focus="c:e2" onOpenMeeting={openMeeting} />);
    expect(await screen.findByLabelText("Brief for Design sync")).toBeTruthy();
    expect(api.briefGet).toHaveBeenCalledWith("c:e2");
  });

  it("says there are no meetings when a calendar is connected and nothing is coming", async () => {
    api.briefOverview = vi.fn().mockResolvedValue(overview({ events: [] }));
    render(<BriefPanel onOpenMeeting={openMeeting} />);
    expect(await screen.findByText("No meetings in the next day.")).toBeTruthy();
  });
});

describe("BriefBody", () => {
  it("shows headings, bullets and citation marks, and renders nothing as markup", () => {
    const { container } = render(
      <BriefBody
        markdown={"## Last time\n- Cut <b>travel</b> [2]\n\nA line <script>alert(1)</script> [1]"}
      />,
    );
    expect(screen.getByText("Last time")).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/Cut <b>travel<\/b>/)).toBeTruthy();
    expect(screen.getByLabelText("Source 2")).toBeTruthy();
    expect(screen.getByLabelText("Source 1")).toBeTruthy();
  });
});

describe("the Brief tab of a meeting (NT-11)", () => {
  it("shows the brief built for the calendar event the meeting started from, with its sources", async () => {
    api.briefForMeeting = vi.fn().mockResolvedValue(brief());
    render(<MeetingBriefTab meetingId="m9" onOpenMeeting={openMeeting} />);
    expect(await screen.findByLabelText("Brief for Budget review")).toBeTruthy();
    expect(api.briefForMeeting).toHaveBeenCalledWith("m9");
    fireEvent.click(screen.getByRole("button", { name: "Open the meeting “Budget review”" }));
    expect(openMeeting).toHaveBeenCalledWith("m1");
  });

  it("offers to build one when none was built, and shows it", async () => {
    api.briefBuild = vi.fn().mockResolvedValue({ ok: true, brief: brief() });
    render(<MeetingBriefTab meetingId="m9" onOpenMeeting={openMeeting} />);
    expect(await screen.findByText(/No brief was built before this meeting/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Build a brief for this meeting" }));
    expect(await screen.findByLabelText("Brief for Budget review")).toBeTruthy();
    expect(api.briefBuild).toHaveBeenCalledWith("meeting:m9");
  });

  it("says why a brief could not be built", async () => {
    api.briefBuild = vi.fn().mockResolvedValue({ ok: false, message: "That meeting is gone." });
    render(<MeetingBriefTab meetingId="m9" onOpenMeeting={openMeeting} />);
    fireEvent.click(await screen.findByRole("button", { name: "Build a brief for this meeting" }));
    expect(await screen.findByText("That meeting is gone.")).toBeTruthy();
  });
});
