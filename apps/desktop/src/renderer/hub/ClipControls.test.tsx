// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DictionaryEntry } from "@murmur/shared";
import { ClipControls, CLIP_SECONDS } from "./ClipControls";
import { createMockApi } from "./test-api";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const entry: DictionaryEntry = {
  id: "e1",
  term: "Kubernetes",
  replacement: null,
  caseSensitive: false,
  source: "manual",
  starred: false,
  useCount: 0,
  kind: "term",
  hasClip: false,
  createdAt: 1,
  updatedAt: 1,
};

describe("pronunciation clip controls", () => {
  it("records, counts down and stops by itself after 3 seconds", async () => {
    vi.useFakeTimers();
    const api = createMockApi();
    window.murmur = api;
    const onChanged = vi.fn();
    render(<ClipControls entry={entry} onChanged={onChanged} />);
    await act(async () =>
      screen.getByRole("button", { name: "Record how you say Kubernetes" }).click(),
    );
    expect(api.dictionaryClipStart).toHaveBeenCalledWith("e1");
    expect(screen.getByText(`Stop (${CLIP_SECONDS} s)`)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(CLIP_SECONDS * 1000);
    });
    expect(api.dictionaryClipStop).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalled();
  });

  it("offers play and delete once a clip exists", async () => {
    const api = createMockApi();
    window.murmur = api;
    render(<ClipControls entry={{ ...entry, hasClip: true }} onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Record how you say Kubernetes" }).textContent).toBe(
      "Record again",
    );
    await act(async () =>
      screen.getByRole("button", { name: "Delete the clip for Kubernetes" }).click(),
    );
    expect(api.dictionaryClipDelete).toHaveBeenCalledWith("e1");
  });
});
