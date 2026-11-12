// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Rewrite } from "@murmur/shared";
import { RewritesPage } from "./RewritesPage";
import { createMockApi } from "./test-api";

afterEach(cleanup);

const base = {
  example: null,
  enabled: true,
  shortcut: null,
  applyDirectly: true,
  autoApply: false,
  autoApplyMinWords: 0,
  autoApplyCategories: ["personal", "work", "email", "other"] as Rewrite["autoApplyCategories"],
  useCount: 0,
  createdAt: 1,
  updatedAt: 1,
};
const tighten: Rewrite = {
  ...base,
  id: "builtin:concise",
  name: "Tighten",
  builtinKey: "concise",
  description: "Make it shorter. Removes repeats and filler, keeps every fact.",
  instruction: "Make the text shorter.",
  sortOrder: 0,
};
const reply: Rewrite = {
  ...base,
  id: "r1",
  name: "Customer reply",
  builtinKey: null,
  description: "",
  instruction: "Turn this into a short, warm reply.",
  sortOrder: 1,
};

describe("Rewrites page", () => {
  it("lists built-ins with their description and custom ones with their instruction", async () => {
    window.murmur = createMockApi({ rewritesList: vi.fn().mockResolvedValue([tighten, reply]) });
    render(<RewritesPage />);
    await waitFor(() => expect(screen.getByText("Tighten")).toBeTruthy());
    expect(screen.getByText(tighten.description)).toBeTruthy();
    expect(screen.getByText(reply.instruction)).toBeTruthy();
    expect(screen.getByText("2 Rewrites · 1 of 50 of your own")).toBeTruthy();
    // Built-ins cannot be edited or deleted.
    expect(screen.queryByRole("button", { name: "Edit Tighten" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete Tighten" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete Customer reply" })).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Move Tighten up" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("adds a custom Rewrite and shows a refusal", async () => {
    const rewritesSave = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: "duplicate-name",
        message: "There is already a Rewrite called “Tighten”.",
      })
      .mockResolvedValue({ ok: true, rewrite: reply });
    window.murmur = createMockApi({
      rewritesList: vi.fn().mockResolvedValue([tighten]),
      rewritesSave,
    });
    render(<RewritesPage />);
    await waitFor(() => expect(screen.getByText("Tighten")).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Tighten" } });
    fireEvent.change(screen.getByLabelText(/^Instruction/), {
      target: { value: "Turn this into a short, warm reply." },
    });
    await act(async () => screen.getByRole("button", { name: "Add Rewrite" }).click());
    expect(screen.getByText("There is already a Rewrite called “Tighten”.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Customer reply" } });
    await act(async () => screen.getByRole("button", { name: "Add Rewrite" }).click());
    expect(rewritesSave).toHaveBeenLastCalledWith({
      name: "Customer reply",
      instruction: "Turn this into a short, warm reply.",
      example: null,
      enabled: true,
    });
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("");
  });

  it("blocks an instruction over 1,000 characters", async () => {
    window.murmur = createMockApi({ rewritesList: vi.fn().mockResolvedValue([]) });
    render(<RewritesPage />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Long" } });
    fireEvent.change(screen.getByLabelText(/^Instruction/), {
      target: { value: "x".repeat(1001) },
    });
    expect(
      (screen.getByRole("button", { name: "Add Rewrite" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("The instruction is over 1,000 characters.")).toBeTruthy();
  });

  it("switches, moves, duplicates, edits and deletes", async () => {
    const api = createMockApi({
      rewritesList: vi.fn().mockResolvedValue([tighten, reply]),
      rewritesDuplicate: vi.fn().mockResolvedValue({ ok: true, rewrite: reply }),
    });
    window.murmur = api;
    render(<RewritesPage />);
    await waitFor(() => expect(screen.getByText("Tighten")).toBeTruthy());
    await act(async () => screen.getByRole("switch", { name: "Use Tighten" }).click());
    expect(api.rewritesSetEnabled).toHaveBeenCalledWith("builtin:concise", false);
    await act(async () => screen.getByRole("button", { name: "Move Customer reply up" }).click());
    expect(api.rewritesMove).toHaveBeenCalledWith("r1", -1);
    await act(async () => screen.getByRole("button", { name: "Duplicate Tighten" }).click());
    expect(api.rewritesDuplicate).toHaveBeenCalledWith("builtin:concise");
    await act(async () => screen.getByRole("button", { name: "Edit Customer reply" }).click());
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("Customer reply");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    await act(async () => screen.getByRole("button", { name: "Delete Customer reply" }).click());
    expect(api.rewritesDelete).toHaveBeenCalledWith("r1");
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("");
  });
});
