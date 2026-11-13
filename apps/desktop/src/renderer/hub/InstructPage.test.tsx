// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstructThreadSummary } from "@murmur/shared";
import { InstructPage } from "./InstructPage";
import { createMockApi } from "./test-api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const summary = (fields: Partial<InstructThreadSummary>): InstructThreadSummary => ({
  id: "t1",
  createdAt: 1,
  updatedAt: 1_700_000_000_000,
  appBundleId: "com.apple.mail",
  title: "draft a reply saying Thursday",
  finalDraft: "Thursday works.",
  turnCount: 2,
  outcome: "inserted",
  textRemoved: false,
  ...fields,
});

function mount(threads: InstructThreadSummary[]) {
  const api = createMockApi({
    instructThreads: vi.fn().mockResolvedValue(threads),
    instructThread: vi.fn().mockResolvedValue({
      ...threads[0],
      turns: [
        {
          seq: 1,
          createdAt: 1,
          instruction: "draft a reply saying Thursday",
          draft: "Thursday works for me.",
        },
        { seq: 2, createdAt: 2, instruction: "shorter", draft: "Thursday works." },
      ],
    }),
  });
  vi.stubGlobal("murmur", api);
  window.murmur = api;
  render(<InstructPage />);
  return api;
}

describe("Instruct page", () => {
  it("lists threads, opens one with its turns, and reuses it", async () => {
    const api = mount([summary({}), summary({ id: "t2", textRemoved: true, title: "" })]);
    expect(await screen.findByText("draft a reply saying Thursday")).toBeTruthy();
    expect(screen.getByText("Text removed after 30 days")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Open “draft a reply saying Thursday”" }),
    );
    const turns = await screen.findByRole("list", { name: "Turns" });
    expect(turns.querySelectorAll("li")).toHaveLength(2);
    await userEvent.click(
      screen.getByRole("button", {
        name: "Start a new thread from “draft a reply saying Thursday”",
      }),
    );
    expect(api.instructReuse).toHaveBeenCalledWith("t1");
    expect(screen.queryByRole("button", { name: "Open “Text removed after 30 days”" })).toBeNull();
  });

  it("searches, and deletes one or all after confirming", async () => {
    const api = mount([summary({})]);
    await screen.findByText("draft a reply saying Thursday");
    await userEvent.type(screen.getByRole("textbox", { name: "Search threads" }), "thurs");
    await waitFor(() => expect(api.instructThreads).toHaveBeenLastCalledWith("thurs"));
    await userEvent.click(
      screen.getByRole("button", { name: "Delete “draft a reply saying Thursday”" }),
    );
    expect(api.instructDelete).toHaveBeenCalledWith("t1");
  });

  it("deletes every thread only after the second click", async () => {
    const api = mount([summary({})]);
    await userEvent.click(await screen.findByRole("button", { name: "Delete all threads" }));
    expect(api.instructDeleteAll).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Delete every thread" }));
    expect(api.instructDeleteAll).toHaveBeenCalled();
  });
});
