// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryItem } from "@murmur/shared";
import { MemoryPage, parseKeywords } from "./MemoryPage";
import { createMockApi, SAMPLE_SETTINGS } from "./test-api";

afterEach(cleanup);

const item: MemoryItem = {
  id: "m1",
  text: "Sign emails as Tirth.",
  keywords: ["sign off"],
  autoKeywords: false,
  source: "dictation",
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

describe("Memory page", () => {
  it("reads keywords from a comma list", () => {
    expect(parseKeywords(" sign off, email ,")).toEqual(["sign off", "email"]);
    expect(parseKeywords("  ")).toBeNull();
  });

  it("adds a fact and lists saved ones", async () => {
    const memorySave = vi.fn().mockResolvedValue({ ok: true, item });
    window.murmur = createMockApi({
      memoryList: vi.fn().mockResolvedValueOnce([]).mockResolvedValue([item]),
      memorySave,
    });
    render(<MemoryPage />);
    await waitFor(() => expect(screen.getByText("No facts saved yet.")).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/^Fact/), {
      target: { value: "Sign emails as Tirth." },
    });
    fireEvent.change(screen.getByLabelText(/^Keywords/), { target: { value: "sign off" } });
    await act(async () => screen.getByRole("button", { name: "Add fact" }).click());
    expect(memorySave).toHaveBeenCalledWith({
      text: "Sign emails as Tirth.",
      keywords: ["sign off"],
      enabled: true,
    });
    await waitFor(() => expect(screen.getByText("By voice")).toBeTruthy());
  });

  it("turns saving by voice off in the settings", async () => {
    const updateSettings = vi.fn().mockResolvedValue(SAMPLE_SETTINGS);
    window.murmur = createMockApi({ updateSettings });
    render(<MemoryPage />);
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: /Save facts by voice/ })).toBeTruthy(),
    );
    await act(async () => screen.getByRole("switch", { name: /Save facts by voice/ }).click());
    expect(updateSettings).toHaveBeenCalledWith({
      memory: { enabled: true, fromDictation: false },
    });
  });
});
