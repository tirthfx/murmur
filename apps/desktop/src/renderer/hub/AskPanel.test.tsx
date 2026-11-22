// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskActionProposal, AskThread } from "@murmur/shared";
import { AskPanel } from "./AskPanel";
import { createMockApi } from "./test-api";

const answered: AskThread = {
  id: "th1",
  title: "When do we ship?",
  scope: { kind: "all" },
  createdAt: 1,
  updatedAt: 2,
  messages: [
    {
      id: "u1",
      role: "user",
      text: "When do we ship?",
      citations: [],
      supported: null,
      closest: [],
      createdAt: 1,
    },
    {
      id: "a1",
      role: "assistant",
      text: "They ship on Thursday [1]. The load test comes first [2].",
      citations: [
        {
          n: 1,
          meetingId: "m-1",
          meetingTitle: "Launch review",
          gone: false,
          source: "transcript",
          ref: "m-1:s2",
          startMs: 754_000,
          excerpt: "We ship on Thursday",
        },
        {
          n: 2,
          meetingId: "m-1",
          meetingTitle: "Launch review",
          gone: false,
          source: "summary",
          ref: "sum-1",
          startMs: null,
          excerpt: "Decisions",
        },
      ],
      supported: true,
      closest: [],
      createdAt: 2,
    },
  ],
};

const unsupported: AskThread = {
  ...answered,
  id: "th2",
  title: "Zebras?",
  messages: [
    {
      id: "u2",
      role: "user",
      text: "Zebras?",
      citations: [],
      supported: null,
      closest: [],
      createdAt: 1,
    },
    {
      id: "a2",
      role: "assistant",
      text: "I could not find an answer to that in your meetings. These are the closest ones I checked.",
      citations: [],
      supported: false,
      closest: [{ meetingId: "m-2", title: "Budget call", startedAt: Date.UTC(2026, 10, 10) }],
      createdAt: 2,
    },
  ],
};

let api: ReturnType<typeof createMockApi>;
const open = vi.fn();

beforeEach(() => {
  api = createMockApi();
  open.mockClear();
  api.askThreads = vi.fn().mockResolvedValue([]);
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

const ask = async (text: string) => {
  fireEvent.change(await screen.findByLabelText("Your question"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
};

describe("Ask (NT-14)", () => {
  it("sends a question with its scope and shows the answer with a chip for each source", async () => {
    api.askSend = vi.fn().mockResolvedValue({ ok: true, thread: answered });
    render(<AskPanel onOpen={open} />);
    await ask("When do we ship?");
    await waitFor(() =>
      expect(api.askSend).toHaveBeenCalledWith({
        threadId: null,
        question: "When do we ship?",
        scope: { kind: "all" },
      }),
    );
    const messages = within(await screen.findByRole("list", { name: "Messages" }));
    expect(messages.getByText(/They ship on Thursday/)).toBeTruthy();
    const chip = messages.getByRole("button", { name: "Open Launch review · 12:34" });
    fireEvent.click(chip);
    expect(open).toHaveBeenCalledWith({ meetingId: "m-1", tab: "transcript", segmentId: "m-1:s2" });
    fireEvent.click(messages.getByRole("button", { name: "Open Launch review · Summary" }));
    expect(open).toHaveBeenLastCalledWith({ meetingId: "m-1", tab: "summary", segmentId: null });
    // The question box is empty again, ready for a follow-up in the same thread.
    expect((screen.getByLabelText("Your question") as HTMLTextAreaElement).value).toBe("");
  });

  it("carries on in the same conversation", async () => {
    api.askSend = vi.fn().mockResolvedValue({ ok: true, thread: answered });
    render(<AskPanel onOpen={open} />);
    await ask("When do we ship?");
    await screen.findByRole("list", { name: "Messages" });
    await ask("And the test?");
    await waitFor(() =>
      expect(api.askSend).toHaveBeenLastCalledWith(expect.objectContaining({ threadId: "th1" })),
    );
  });

  it("says when the meetings do not support an answer, and offers the closest ones", async () => {
    api.askSend = vi.fn().mockResolvedValue({ ok: true, thread: unsupported });
    render(<AskPanel onOpen={open} />);
    await ask("Zebras?");
    expect(await screen.findByText(/could not find an answer/)).toBeTruthy();
    const closest = within(screen.getByRole("list", { name: "Closest meetings" }));
    fireEvent.click(closest.getByRole("button", { name: "Open Budget call" }));
    expect(open).toHaveBeenCalledWith({ meetingId: "m-2", tab: "summary", segmentId: null });
  });

  it("shows a chip for a deleted meeting that opens nothing", async () => {
    const gone: AskThread = {
      ...answered,
      messages: [
        answered.messages[0]!,
        {
          ...answered.messages[1]!,
          citations: [{ ...answered.messages[1]!.citations[0]!, gone: true }],
        },
      ],
    };
    api.askThreads = vi
      .fn()
      .mockResolvedValue([{ id: "th1", title: "When do we ship?", updatedAt: 2 }]);
    api.askThread = vi.fn().mockResolvedValue(gone);
    render(<AskPanel onOpen={open} />);
    fireEvent.click(await screen.findByRole("button", { name: "When do we ship?" }));
    expect(await screen.findByText(/meeting deleted/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Launch review · 12:34" })).toBeNull();
  });

  it("only renders text: markup in an answer is shown as text", async () => {
    const odd: AskThread = {
      ...answered,
      messages: [{ ...answered.messages[1]!, text: "<img src=x onerror=alert(1)> Thursday [1]" }],
    };
    api.askSend = vi.fn().mockResolvedValue({ ok: true, thread: odd });
    render(<AskPanel onOpen={open} />);
    await ask("When?");
    await screen.findByText(/<img src=x/);
    expect(document.querySelector("img")).toBeNull();
  });

  it("opens a saved conversation in its own scope, and deletes it", async () => {
    const dated: AskThread = {
      ...answered,
      scope: { kind: "range", from: "2026-11-01", to: "2026-11-30" },
    };
    api.askThreads = vi
      .fn()
      .mockResolvedValue([{ id: "th1", title: "When do we ship?", updatedAt: 2 }]);
    api.askThread = vi.fn().mockResolvedValue(dated);
    render(<AskPanel onOpen={open} />);
    fireEvent.click(await screen.findByRole("button", { name: "When do we ship?" }));
    expect(await screen.findByLabelText("From")).toHaveProperty("value", "2026-11-01");
    expect(screen.getByLabelText("To")).toHaveProperty("value", "2026-11-30");
    api.askThreads = vi.fn().mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Delete this conversation" }));
    await waitFor(() => expect(api.askDelete).toHaveBeenCalledWith("th1"));
    await waitFor(() => expect(screen.queryByRole("list", { name: "Messages" })).toBeNull());
  });

  it("checks chosen dates before sending", async () => {
    api.askSend = vi.fn().mockResolvedValue({ ok: true, thread: answered });
    render(<AskPanel onOpen={open} />);
    fireEvent.click(await screen.findByRole("combobox", { name: "Look in" }));
    fireEvent.click(await screen.findByRole("option", { name: "Choose dates" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-30" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-01" } });
    await ask("When?");
    expect(await screen.findByText("The first date comes after the last.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "soon" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("Write both dates as YYYY-MM-DD.")).toBeTruthy();
    expect(api.askSend).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() =>
      expect(api.askSend).toHaveBeenCalledWith({
        threadId: null,
        question: "When?",
        scope: { kind: "range", from: "2026-11-01", to: "2026-11-30" },
      }),
    );
  });

  it("starts a question about one meeting, limited to it", async () => {
    api.askSend = vi.fn().mockResolvedValue({ ok: true, thread: answered });
    render(<AskPanel about={{ id: "m-1", title: "Launch review", n: 1 }} onOpen={open} />);
    expect(await screen.findByText("Launch review")).toBeTruthy();
    await ask("When do we ship?");
    await waitFor(() =>
      expect(api.askSend).toHaveBeenCalledWith({
        threadId: null,
        question: "When do we ship?",
        scope: { kind: "meetings", ids: ["m-1"] },
      }),
    );
  });

  it("asks about the meetings of a folder, or of the Inbox (NT-17)", async () => {
    api.foldersList = vi.fn().mockResolvedValue([
      {
        id: "f1",
        name: "Customer calls",
        meetings: 2,
        defaultSkillId: null,
        autoExportPath: null,
      },
    ]);
    api.askSend = vi.fn().mockResolvedValue({ ok: true, thread: answered });
    render(<AskPanel onOpen={open} />);
    fireEvent.click(await screen.findByRole("combobox", { name: "Look in" }));
    fireEvent.click(await screen.findByRole("option", { name: "A folder" }));
    fireEvent.click(await screen.findByRole("combobox", { name: "Folder" }));
    fireEvent.click(await screen.findByRole("option", { name: "Customer calls" }));
    await ask("When?");
    await waitFor(() =>
      expect(api.askSend).toHaveBeenCalledWith({
        threadId: null,
        question: "When?",
        scope: { kind: "folder", folderId: "f1" },
      }),
    );
    // The Inbox is the folder with no id.
    fireEvent.click(screen.getByRole("combobox", { name: "Folder" }));
    fireEvent.click(await screen.findByRole("option", { name: "Inbox" }));
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "And now?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() =>
      expect(api.askSend).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: { kind: "folder", folderId: null } }),
      ),
    );
  });

  it("opens a conversation in its folder scope", async () => {
    api.foldersList = vi.fn().mockResolvedValue([
      {
        id: "f1",
        name: "Customer calls",
        meetings: 2,
        defaultSkillId: null,
        autoExportPath: null,
      },
    ]);
    api.askThreads = vi
      .fn()
      .mockResolvedValue([{ id: "th1", title: "When do we ship?", updatedAt: 2 }]);
    api.askThread = vi
      .fn()
      .mockResolvedValue({ ...answered, scope: { kind: "folder", folderId: "f1" } });
    render(<AskPanel onOpen={open} />);
    fireEvent.click(await screen.findByRole("button", { name: "When do we ship?" }));
    expect(await screen.findByRole("combobox", { name: "Folder" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Folder" }).textContent).toContain(
      "Customer calls",
    );
  });

  it("shows why a question failed, and keeps the question", async () => {
    api.askSend = vi.fn().mockResolvedValue({
      ok: false,
      message: "The language model is not downloaded. Get it in Settings.",
    });
    render(<AskPanel onOpen={open} />);
    await ask("When?");
    expect(await screen.findByText(/language model is not downloaded/)).toBeTruthy();
    expect((screen.getByLabelText("Your question") as HTMLTextAreaElement).value).toBe("When?");
  });

  it("will not send an empty question", async () => {
    render(<AskPanel onOpen={open} />);
    expect(await screen.findByRole("button", { name: "Ask" })).toHaveProperty("disabled", true);
  });
});

describe("Ask connector actions (CN-13)", () => {
  /** The settings of a profile with the experimental option on or off. */
  const withFlag = async (on: boolean) => {
    const base = await api.getSettings();
    api.getSettings = vi.fn().mockResolvedValue({
      ...base,
      settings: {
        ...base.settings,
        experimental: { ...base.settings.experimental, askConnectorActions: on },
      },
    });
  };

  const draft: AskActionProposal = {
    action: "draft_email",
    line: "Draft an email to Priya: Timeline",
    note: null,
    form: {
      candidates: [{ name: "Priya Rao", email: "priya@example.com" }],
      to: "priya@example.com",
      subject: "Timeline",
      body: "Hi Priya, here is the timeline.",
      accountId: "g1",
      accountEmail: "me@gmail.test",
    },
  };

  it("never asks about actions, and shows nothing about them, while the option is off", async () => {
    await withFlag(false);
    api.askSend = vi.fn().mockResolvedValue({ ok: true, thread: answered });
    render(<AskPanel onOpen={open} />);
    await ask("Draft a follow-up to Priya about the timeline");
    await waitFor(() => expect(api.askSend).toHaveBeenCalled());
    expect(api.askActionPropose).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Proposed action")).toBeNull();
  });

  it("shows a proposal first instead of answering, and creates nothing until the click", async () => {
    await withFlag(true);
    api.askActionPropose = vi.fn().mockResolvedValue({ ok: true, proposal: draft });
    api.emailDraftCreate = vi.fn().mockResolvedValue({
      ok: true,
      automationId: "a",
      draftId: "d",
      openUrl: "https://mail.google.com/mail/u/me%40gmail.test/#drafts?compose=m",
    });
    render(<AskPanel onOpen={open} />);
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    await ask("Draft a follow-up to Priya about the timeline");
    const card = await screen.findByLabelText("Proposed action");
    expect(within(card).getByText("Draft an email to Priya: Timeline")).toBeTruthy();
    expect(within(card).getByText(/Nothing has been sent or created/)).toBeTruthy();
    expect(within(card).getByDisplayValue("Timeline")).toBeTruthy();
    expect(api.askActionPropose).toHaveBeenCalledWith({
      question: "Draft a follow-up to Priya about the timeline",
      meetingId: null,
    });
    // No question was sent to the model for an answer, and nothing was created.
    expect(api.askSend).not.toHaveBeenCalled();
    expect(api.emailDraftCreate).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole("button", { name: "Create the draft in Gmail" }));
    await waitFor(() => expect(api.emailDraftCreate).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.emailDraftCreate).mock.calls[0]![0]).toMatchObject({
      source: { kind: "ask" },
      to: "priya@example.com",
      subject: "Timeline",
    });
    expect(await screen.findByText("The draft is in Gmail’s Drafts folder.")).toBeTruthy();
    expect(screen.queryByLabelText("Proposed action")).toBeNull();
  });

  it("goes on to answer a question that is not a request, and creates nothing", async () => {
    await withFlag(true);
    api.askActionPropose = vi.fn().mockResolvedValue({ ok: true, proposal: null });
    api.askSend = vi.fn().mockResolvedValue({ ok: true, thread: answered });
    render(<AskPanel onOpen={open} />);
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    await ask("Did we draft the email to Priya?");
    await waitFor(() => expect(api.askSend).toHaveBeenCalled());
    expect(screen.queryByLabelText("Proposed action")).toBeNull();
    expect(api.emailDraftCreate).not.toHaveBeenCalled();
  });

  it("can be cancelled without creating anything", async () => {
    await withFlag(true);
    api.askActionPropose = vi.fn().mockResolvedValue({ ok: true, proposal: draft });
    render(<AskPanel onOpen={open} />);
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    await ask("Draft a follow-up to Priya");
    const card = await screen.findByLabelText("Proposed action");
    fireEvent.click(within(card).getByRole("button", { name: "Do not create a draft" }));
    expect(screen.queryByLabelText("Proposed action")).toBeNull();
    expect(api.emailDraftCreate).not.toHaveBeenCalled();
  });

  it("says when no one was found for the name, so the owner chooses", async () => {
    await withFlag(true);
    api.askActionPropose = vi.fn().mockResolvedValue({
      ok: true,
      proposal: {
        ...draft,
        note: "No one called “Zed” was found. Choose a contact or type an address.",
      },
    });
    render(<AskPanel onOpen={open} />);
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    await ask("Draft an email to Zed");
    expect(await screen.findByText(/No one called “Zed” was found/)).toBeTruthy();
  });

  it("reads Slack's channels only after the owner goes on, and sends nothing before the preview is confirmed", async () => {
    await withFlag(true);
    api.askActionPropose = vi.fn().mockResolvedValue({
      ok: true,
      proposal: {
        action: "post_to_slack",
        line: "Send a message to Slack",
        note: null,
        text: "Budget is ready",
      },
    });
    api.slackPostStart = vi.fn().mockResolvedValue({
      ok: true,
      start: {
        text: "ignored",
        channels: [{ id: "C1", label: "#general" }],
        accountEmail: "acme/dana",
      },
    });
    render(<AskPanel onOpen={open} />);
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled());
    await ask("Post to Slack that the budget is ready");
    const card = await screen.findByLabelText("Proposed action");
    expect(within(card).getByText("Budget is ready")).toBeTruthy();
    expect(api.slackPostStart).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole("button", { name: "Choose a channel and preview" }));
    expect(await within(card).findByDisplayValue("Budget is ready")).toBeTruthy();
    expect(api.slackPostStart).toHaveBeenCalledWith({
      kind: "ask",
      id: expect.stringMatching(/^ask-/),
    });
    expect(api.slackPostPrepare).not.toHaveBeenCalled();
    expect(api.slackPostSend).not.toHaveBeenCalled();
  });
});
