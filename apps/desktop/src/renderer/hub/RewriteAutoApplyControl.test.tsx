// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Rewrite } from "@murmur/shared";
import { RewriteAutoApplyControl } from "./RewriteAutoApplyControl";
import { createMockApi } from "./test-api";

afterEach(cleanup);

const structure: Rewrite = {
  id: "builtin:structure",
  name: "Structure",
  builtinKey: "structure",
  description: "Add headings, bullets or numbered steps.",
  instruction: "Lay the text out clearly.",
  example: null,
  enabled: true,
  sortOrder: 3,
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

describe("Rewrite auto-apply control", () => {
  it("turns auto-apply on with the current limits", async () => {
    const api = createMockApi();
    window.murmur = api;
    const onChanged = vi.fn();
    render(<RewriteAutoApplyControl rewrite={structure} shadowedBy={null} onChanged={onChanged} />);
    expect(screen.queryByLabelText(/Minimum words/)).toBeNull();
    await act(async () => screen.getByRole("switch", { name: /Apply to every dictation/ }).click());
    expect(api.rewritesSetAutoApply).toHaveBeenCalledWith("builtin:structure", {
      enabled: true,
      minWords: 0,
      categories: ["personal", "work", "email", "other"],
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("sets the minimum words and the categories, in their fixed order", async () => {
    const api = createMockApi();
    window.murmur = api;
    render(
      <RewriteAutoApplyControl
        rewrite={{ ...structure, autoApply: true }}
        shadowedBy={null}
        onChanged={vi.fn()}
      />,
    );
    const words = screen.getByLabelText(/Minimum words/);
    await act(async () => {
      fireEvent.change(words, { target: { value: "40" } });
      fireEvent.blur(words);
    });
    expect(api.rewritesSetAutoApply).toHaveBeenLastCalledWith(
      "builtin:structure",
      expect.objectContaining({ minWords: 40 }),
    );
    await act(async () => screen.getByRole("checkbox", { name: "Email" }).click());
    expect(api.rewritesSetAutoApply).toHaveBeenLastCalledWith("builtin:structure", {
      enabled: true,
      minWords: 0,
      categories: ["personal", "work", "other"],
    });
  });

  it("says which earlier Rewrite runs instead", () => {
    window.murmur = createMockApi();
    render(
      <RewriteAutoApplyControl
        rewrite={{ ...structure, autoApply: true }}
        shadowedBy="Tighten"
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText(/Tighten is earlier in the list/)).toBeTruthy();
  });
});
