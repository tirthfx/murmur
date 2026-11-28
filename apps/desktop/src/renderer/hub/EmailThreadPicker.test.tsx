// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_CONNECTOR_SETTINGS } from "@murmur/shared";
import { EmailThreadPicker } from "./EmailThreadPicker";
import { createMockApi, SAMPLE_SETTINGS } from "./test-api";

afterEach(cleanup);

const withReply = (replyContext: boolean) =>
  vi.fn().mockResolvedValue({
    ...SAMPLE_SETTINGS,
    settings: {
      ...SAMPLE_SETTINGS.settings,
      connectors: {
        ...DEFAULT_CONNECTOR_SETTINGS,
        gmail: { ...DEFAULT_CONNECTOR_SETTINGS.gmail, replyContext },
      },
    },
  });

describe("adding an email thread to the notes (CN-04)", () => {
  it("is not offered while reply context is off", async () => {
    window.murmur = createMockApi({ getSettings: withReply(false) });
    render(<EmailThreadPicker onPick={() => {}} />);
    await waitFor(() => expect(window.murmur.getSettings).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
    expect(window.murmur.gmailThreads).not.toHaveBeenCalled();
  });

  it("reads Gmail when asked and hands over the chosen thread", async () => {
    const user = userEvent.setup();
    window.murmur = createMockApi({
      getSettings: withReply(true),
      gmailThreads: vi.fn().mockResolvedValue({
        ok: true,
        threads: [{ id: "t1", subject: "Budget", from: "Dana", text: "Email thread: Budget" }],
      }),
    });
    const onPick = vi.fn();
    render(<EmailThreadPicker onPick={onPick} />);
    await user.click(
      await screen.findByRole("button", { name: "Add an email thread to the notes" }),
    );
    await user.click(await screen.findByRole("combobox", { name: "Email thread to reply to" }));
    await user.click(await screen.findByRole("option", { name: "Budget · Dana" }));
    expect(onPick).toHaveBeenCalledWith("Email thread: Budget");
  });

  it("says why Gmail could not be read", async () => {
    const user = userEvent.setup();
    window.murmur = createMockApi({
      getSettings: withReply(true),
      gmailThreads: vi.fn().mockResolvedValue({ ok: false, message: "Gmail answered 500." }),
    });
    render(<EmailThreadPicker onPick={() => {}} />);
    await user.click(
      await screen.findByRole("button", { name: "Add an email thread to the notes" }),
    );
    expect(await screen.findByText("Gmail answered 500.")).toBeTruthy();
  });
});
