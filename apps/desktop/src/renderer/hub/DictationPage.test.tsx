// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DictationState } from "@murmur/shared";
import { DictationPage } from "./DictationPage";
import { createMockApi, SAMPLE_HISTORY } from "./test-api";

beforeEach(() => {
  window.murmur = createMockApi();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Dictation page", () => {
  it("shows the state, microphone, language and the recent dictations", async () => {
    render(<DictationPage />);
    const list = await screen.findByRole("list", { name: "Recent dictations" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByTestId("dictation-state").textContent).toBe("Ready");
    expect(screen.getByRole("group", { name: "Microphone" }).textContent).toContain("Automatic");
  });

  it("follows the dictation state as it changes, and reads again when idle", async () => {
    let push: (state: DictationState) => void = () => {};
    window.murmur = createMockApi({
      onDictationState: vi.fn((handler: (state: DictationState) => void) => {
        push = handler;
        return () => {};
      }),
    });
    render(<DictationPage />);
    await screen.findByRole("list", { name: "Recent dictations" });
    act(() => push("listening"));
    expect(screen.getByTestId("dictation-state").textContent).toBe("Listening");
    act(() => push("idle"));
    expect(window.murmur.historyPage).toHaveBeenCalledTimes(2);
  });

  it("retries a failed dictation that still has its recording", async () => {
    const page = structuredClone(SAMPLE_HISTORY);
    page.rows[1] = { ...page.rows[1]!, hasAudio: true };
    window.murmur = createMockApi({ historyPage: vi.fn().mockResolvedValue(page) });
    const user = userEvent.setup();
    render(<DictationPage />);
    const list = await screen.findByRole("list", { name: "Recent dictations" });
    const [done, failed] = within(list).getAllByRole("listitem");
    expect(
      within(done!).queryByRole("button", { name: "Transcribe this recording again" }),
    ).toBeNull();
    await user.click(
      within(failed!).getByRole("button", { name: "Transcribe this recording again" }),
    );
    expect(window.murmur.historyRetry).toHaveBeenCalledWith("h1");
    expect(await screen.findByText("Transcribed again and copied to the clipboard.")).toBeTruthy();
  });

  it("asks before deleting", async () => {
    const user = userEvent.setup();
    render(<DictationPage />);
    const list = await screen.findByRole("list", { name: "Recent dictations" });
    const [first] = within(list).getAllByRole("listitem");
    await user.click(within(first!).getByRole("button", { name: "Delete this dictation" }));
    expect(window.murmur.historyDelete).not.toHaveBeenCalled();
    await user.click(
      within(first!).getByRole("button", { name: "Confirm deleting this dictation" }),
    );
    expect(window.murmur.historyDelete).toHaveBeenCalledWith(["h2"]);
  });
});
