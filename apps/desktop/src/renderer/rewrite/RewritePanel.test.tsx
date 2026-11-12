// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MurmurRewriteApi, RewritePanelState } from "@murmur/shared";
import { changeSummary, filterItems, RewritePanel } from "./RewritePanel";

afterEach(cleanup);

const items = [
  { id: "builtin:clarify", name: "Clarify", detail: "Reword so the meaning is clearer." },
  { id: "builtin:concise", name: "Tighten", detail: "Make it shorter." },
  { id: "r1", name: "Customer reply", detail: "A short, warm reply." },
];

function api(initial: RewritePanelState) {
  let push: (state: RewritePanelState) => void = () => {};
  const mock: MurmurRewriteApi = {
    ready: vi.fn(async () => initial),
    onState: vi.fn((handler) => {
      push = handler;
      return () => {};
    }),
    choose: vi.fn(async () => {}),
    regenerate: vi.fn(async () => {}),
    back: vi.fn(async () => {}),
    replace: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  return { mock, push: (state: RewritePanelState) => act(() => push(state)) };
}

describe("filterItems", () => {
  it("matches every word, names first", () => {
    expect(filterItems(items, "").map((item) => item.name)).toHaveLength(3);
    expect(filterItems(items, "short").map((item) => item.name)).toEqual([
      "Tighten",
      "Customer reply",
    ]);
    expect(filterItems(items, "cust rep").map((item) => item.name)).toEqual(["Customer reply"]);
    expect(filterItems(items, "zzz")).toEqual([]);
  });
});

describe("Rewrite panel", () => {
  it("shows nothing while hidden", async () => {
    const { mock } = api({ stage: "hidden" });
    const { container } = render(<RewritePanel api={mock} />);
    await waitFor(() => expect(mock.ready).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("lists Rewrites, filters by typing and chooses with the keyboard", async () => {
    const { mock } = api({ stage: "list", items, selectionLength: 1234, appName: null });
    render(<RewritePanel api={mock} />);
    await waitFor(() => expect(screen.getByText("Rewrite 1,234 characters")).toBeTruthy());
    const filter = screen.getByLabelText("Find a Rewrite");
    expect(document.activeElement).toBe(filter);
    fireEvent.change(filter, { target: { value: "short" } });
    expect(screen.getAllByRole("option").map((option) => option.firstChild?.textContent)).toEqual([
      "Tighten",
      "Customer reply",
    ]);
    fireEvent.keyDown(filter, { key: "ArrowDown" });
    fireEvent.keyDown(filter, { key: "Enter" });
    expect(mock.choose).toHaveBeenCalledWith("r1");
    await act(async () => screen.getByRole("option", { name: /Tighten/ }).click());
    expect(mock.choose).toHaveBeenLastCalledWith("builtin:concise");
  });

  it("streams, then offers Replace, Copy, Regenerate, Try another and Discard", async () => {
    const { mock, push } = api({
      stage: "running",
      rewriteName: "Tighten",
      text: "",
      loading: true,
    });
    render(<RewritePanel api={mock} />);
    await waitFor(() => expect(screen.getByText("Loading model…")).toBeTruthy());
    push({ stage: "running", rewriteName: "Tighten", text: "Short", loading: false });
    expect(screen.getByText("Short")).toBeTruthy();
    push({ stage: "result", rewriteName: "Tighten", text: "Short text.", source: "long" });
    expect(screen.getByLabelText("Result").textContent).toBe("Short text.");
    expect(document.activeElement?.textContent).toBe("Replace");
    for (const [name, call] of [
      ["Replace", mock.replace],
      ["Copy", mock.copy],
      ["Regenerate", mock.regenerate],
      ["Try another Rewrite", mock.back],
      ["Discard", mock.close],
    ] as const) {
      await act(async () => screen.getByRole("button", { name }).click());
      expect(call).toHaveBeenCalledOnce();
    }
  });

  it("shows a message with only the actions it allows, and Escape closes", async () => {
    const { mock } = api({
      stage: "message",
      message: "Selection changed. Copy instead?",
      canCopy: true,
      canRetry: false,
    });
    render(<RewritePanel api={mock} />);
    await waitFor(() => expect(screen.getByText("Selection changed. Copy instead?")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(mock.close).toHaveBeenCalledOnce();
  });
});

describe("View changes", () => {
  const result: RewritePanelState = {
    stage: "result",
    rewriteName: "Tighten",
    text: "The meeting moved to Friday.",
    source: "So basically the meeting moved to Thursday.",
  };

  it("summarises counts in words", () => {
    expect(changeSummary(1, 2)).toBe("1 word removed, 2 added");
    expect(changeSummary(3, 0)).toBe("3 words removed, 0 added");
  });

  it("shows removed and added words, and goes back to the result", async () => {
    const { mock } = api(result);
    render(<RewritePanel api={mock} />);
    await waitFor(() => expect(screen.getByLabelText("Result")).toBeTruthy());
    await act(async () => screen.getByRole("button", { name: "View changes" }).click());
    const changes = screen.getByLabelText("Changes");
    expect([...changes.querySelectorAll("del")].map((node) => node.textContent)).toEqual([
      "So basically the ",
      "Thursday",
    ]);
    expect([...changes.querySelectorAll("ins")].map((node) => node.textContent)).toEqual([
      "The ",
      "Friday",
    ]);
    expect(screen.getByText("4 words removed, 2 added")).toBeTruthy();
    await act(async () => screen.getByRole("button", { name: "Show result" }).click());
    expect(screen.getByLabelText("Result")).toBeTruthy();
  });

  it("switches with Control+Option+D", async () => {
    const { mock } = api(result);
    render(<RewritePanel api={mock} />);
    await waitFor(() => expect(screen.getByLabelText("Result")).toBeTruthy());
    fireEvent.keyDown(window, { code: "KeyD", key: "∂", ctrlKey: true, altKey: true });
    expect(screen.getByLabelText("Changes")).toBeTruthy();
    fireEvent.keyDown(window, { code: "KeyD", key: "∂", ctrlKey: true, altKey: true });
    expect(screen.getByLabelText("Result")).toBeTruthy();
  });
});
