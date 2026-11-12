// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Rewrite } from "@murmur/shared";
import { RewriteShortcutControl } from "./RewriteShortcutControl";
import { createMockApi } from "./test-api";

afterEach(cleanup);

const tighten: Rewrite = {
  id: "builtin:concise",
  name: "Tighten",
  builtinKey: "concise",
  description: "Make it shorter.",
  instruction: "Make the text shorter.",
  example: null,
  enabled: true,
  sortOrder: 1,
  shortcut: null,
  shortcutLabel: null,
  applyDirectly: true,
  autoApply: false,
  autoApplyMinWords: 0,
  autoApplyCategories: ["personal", "work", "email", "other"],
  useCount: 0,
  createdAt: 1,
  updatedAt: 1,
};

describe("Rewrite shortcut control", () => {
  it("records a chord and saves it, pausing shortcuts meanwhile", async () => {
    const api = createMockApi();
    window.murmur = api;
    const onChanged = vi.fn();
    render(<RewriteShortcutControl rewrite={tighten} onChanged={onChanged} />);
    expect(screen.getByText("No shortcut")).toBeTruthy();
    await act(async () =>
      screen.getByRole("button", { name: "Set the shortcut for Tighten" }).click(),
    );
    expect(api.captureShortcut).toHaveBeenCalledWith(true);
    fireEvent.keyDown(window, { code: "ControlLeft", key: "Control", ctrlKey: true });
    fireEvent.keyDown(window, { code: "AltLeft", key: "Alt", ctrlKey: true, altKey: true });
    fireEvent.keyDown(window, { code: "KeyT", key: "t", ctrlKey: true, altKey: true });
    await waitFor(() =>
      expect(api.rewritesSetShortcut).toHaveBeenCalledWith("builtin:concise", {
        code: "KeyT",
        modifiers: expect.arrayContaining(["control", "option"]),
      }),
    );
    expect(api.captureShortcut).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("shows a refusal", async () => {
    const api = createMockApi({
      rewritesSetShortcut: vi.fn().mockResolvedValue({
        ok: false,
        message: "Control+Option+R is already used for Rewrite.",
      }),
    });
    window.murmur = api;
    render(<RewriteShortcutControl rewrite={tighten} onChanged={vi.fn()} />);
    await act(async () =>
      screen.getByRole("button", { name: "Set the shortcut for Tighten" }).click(),
    );
    fireEvent.keyDown(window, { code: "KeyR", key: "r", ctrlKey: true, altKey: true });
    expect(await screen.findByText("Control+Option+R is already used for Rewrite.")).toBeTruthy();
  });

  it("removes a shortcut and switches Apply directly", async () => {
    const api = createMockApi();
    window.murmur = api;
    const onChanged = vi.fn();
    render(
      <RewriteShortcutControl
        rewrite={{ ...tighten, shortcut: "{}", shortcutLabel: "Control+Option+T" }}
        onChanged={onChanged}
      />,
    );
    await act(async () =>
      screen.getByRole("button", { name: "Remove the shortcut for Tighten" }).click(),
    );
    expect(api.rewritesSetShortcut).toHaveBeenCalledWith("builtin:concise", null);
    await act(async () => screen.getByRole("switch", { name: /Apply directly/ }).click());
    expect(api.rewritesSetApplyDirectly).toHaveBeenCalledWith("builtin:concise", false);
  });
});
