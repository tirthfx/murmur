// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SlackPreview, SlackStart } from "@murmur/shared";
import { SlackPost } from "./SlackPost";
import { createMockApi } from "./test-api";

const start: SlackStart = {
  text: "Task: Send the budget",
  channels: [
    { id: "C2", label: "#finance" },
    { id: "C1", label: "#general" },
  ],
  accountEmail: "acme/dana",
};

const preview = (over: Partial<SlackPreview> = {}): SlackPreview => ({
  token: "tok-1",
  channelLabel: "#finance",
  accountEmail: "acme/dana",
  shown: "Hi @Dana Lee, the budget is ready",
  tags: [],
  unresolved: [],
  taggingOn: false,
  ...over,
});

let api: ReturnType<typeof createMockApi>;
const source = { kind: "task" as const, id: "t1" };

beforeEach(() => {
  api = createMockApi();
  api.slackPostState = vi.fn().mockResolvedValue({ available: true, reason: null });
  api.slackPostStart = vi.fn().mockResolvedValue({ ok: true, start });
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

async function toPreview(over: Partial<SlackPreview> = {}) {
  api.slackPostPrepare = vi.fn().mockResolvedValue({ ok: true, preview: preview(over) });
  render(<SlackPost source={source} />);
  fireEvent.click(await screen.findByRole("button", { name: "Send to Slack" }));
  await screen.findByLabelText("Message");
  fireEvent.click(screen.getByRole("button", { name: "Preview the message" }));
  return screen.findByLabelText("The message that will be sent");
}

describe("Send to Slack (CN-05, CN-14)", () => {
  it("is not offered when the action is off or Slack is not connected, and is switched off with the reason otherwise", async () => {
    api.slackPostState = vi
      .fn()
      .mockResolvedValue({ available: false, reason: "Turn it on.", hidden: true });
    const { container } = render(<SlackPost source={source} />);
    await waitFor(() => expect(api.slackPostState).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    cleanup();
    api.slackPostState = vi
      .fn()
      .mockResolvedValue({ available: false, reason: "Slack is set to read only.", hidden: false });
    render(<SlackPost source={source} />);
    expect(await screen.findByText("Slack is set to read only.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Send to Slack" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(api.slackPostStart).not.toHaveBeenCalled();
  });

  it("writes the message first, with the channel to pick, and sends nothing before the preview and the click", async () => {
    render(<SlackPost source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "Send to Slack" }));
    expect(await screen.findByDisplayValue("Task: Send the budget")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Channel" })).toBeTruthy();
    expect(api.slackPostSend).not.toHaveBeenCalled();
    expect(api.slackPostPrepare).not.toHaveBeenCalled();
  });

  it("previews the exact message and the channel, and sends only the preview's token", async () => {
    api.slackPostSend = vi.fn().mockResolvedValue({ ok: true, channelLabel: "#finance" });
    const view = await toPreview();
    expect(within(view).getByText("Hi @Dana Lee, the budget is ready")).toBeTruthy();
    expect(screen.getByText(/posted to #finance as you \(acme\/dana\)/)).toBeTruthy();
    expect(api.slackPostPrepare).toHaveBeenCalledWith({
      source,
      channelId: "C2",
      text: "Task: Send the budget",
    });
    expect(api.slackPostSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send this message to Slack" }));
    await waitFor(() => expect(api.slackPostSend).toHaveBeenCalledWith({ token: "tok-1" }));
    expect(await screen.findByText("Sent to #finance.")).toBeTruthy();
  });

  it("lists every tag before sending, and the mentions that stay plain text", async () => {
    await toPreview({
      taggingOn: true,
      tags: [{ mention: "@dana", userId: "U1", name: "Dana Lee" }],
      unresolved: [
        { mention: "@sam", reason: "several" },
        { mention: "@ghost", reason: "none" },
      ],
    });
    const tags = within(screen.getByRole("list", { name: "Tags" }));
    expect(tags.getByText("@dana is Dana Lee")).toBeTruthy();
    const plain = within(screen.getByRole("list", { name: "Not tagged" }));
    expect(plain.getByText(/@sam: more than one person has that name/)).toBeTruthy();
    expect(plain.getByText(/@ghost: no one in Slack has that name/)).toBeTruthy();
  });

  it("says no one is tagged, and why", async () => {
    await toPreview({ taggingOn: false });
    expect(screen.getByText("No one will be tagged: tagging is off.")).toBeTruthy();
    cleanup();
    await toPreview({ taggingOn: true });
    expect(screen.getByText("No one will be tagged.")).toBeTruthy();
  });

  it("goes back to edit, and Cancel sends nothing", async () => {
    await toPreview();
    fireEvent.click(screen.getByRole("button", { name: "Change the message" }));
    expect(await screen.findByLabelText("Message")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Do not send" }));
    expect(screen.queryByLabelText("Message")).toBeNull();
    expect(api.slackPostSend).not.toHaveBeenCalled();
  });

  it("shows why a message could not be previewed or sent, and keeps the preview to try again", async () => {
    api.slackPostPrepare = vi.fn().mockResolvedValue({
      ok: false,
      message: "That channel is not there any more. Choose another.",
    });
    render(<SlackPost source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "Send to Slack" }));
    await screen.findByLabelText("Message");
    fireEvent.click(screen.getByRole("button", { name: "Preview the message" }));
    expect(
      await screen.findByText("That channel is not there any more. Choose another."),
    ).toBeTruthy();
    cleanup();
    api.slackPostSend = vi
      .fn()
      .mockResolvedValue({ ok: false, message: "That Slack channel cannot be used." });
    await toPreview();
    fireEvent.click(screen.getByRole("button", { name: "Send this message to Slack" }));
    expect(await screen.findByText("That Slack channel cannot be used.")).toBeTruthy();
    expect(screen.getByLabelText("The message that will be sent")).toBeTruthy();
  });
});
