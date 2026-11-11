// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Snippet } from "@murmur/shared";
import { filterSnippets, SnippetsPage } from "./SnippetsPage";
import { createMockApi } from "./test-api";

const snippet = (trigger: string, plain: string): Snippet => ({
  id: `id-${trigger}`,
  trigger,
  format: "plain",
  plain,
  rich: null,
  useCount: 3,
  createdAt: 1,
  updatedAt: 1,
});

afterEach(cleanup);

describe("Snippets page", () => {
  it("finds snippets by trigger or text", () => {
    const list = [snippet("my address", "12 Hill Road"), snippet("sign off", "Best")];
    expect(filterSnippets(list, "hill").map((item) => item.trigger)).toEqual(["my address"]);
    expect(filterSnippets(list, "")).toHaveLength(2);
  });

  it("adds a rich snippet from the editor", async () => {
    const snippetsSave = vi.fn().mockResolvedValue({ ok: true, snippet: snippet("sig", "Best") });
    window.murmur = createMockApi({ snippetsSave });
    render(<SnippetsPage />);
    await waitFor(() => expect(screen.getByText("No snippets yet.")).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/Trigger phrase/), { target: { value: "sign off" } });
    const editor = screen.getByTestId("snippet-editor");
    editor.innerHTML = "Best, <b>Tirth</b>";
    fireEvent.input(editor);
    await act(async () => screen.getByRole("button", { name: "Add snippet" }).click());
    expect(snippetsSave).toHaveBeenCalledWith({
      trigger: "sign off",
      plain: "",
      rich: {
        blocks: [
          { type: "paragraph", inlines: [{ text: "Best, " }, { text: "Tirth", bold: true }] },
        ],
      },
    });
  });

  it("shows a refusal and lists saved snippets with a preview", async () => {
    window.murmur = createMockApi({
      snippetsList: vi.fn().mockResolvedValue([snippet("my address", "12 Hill Road\nPune\nIndia")]),
      snippetsSave: vi.fn().mockResolvedValue({
        ok: false,
        reason: "duplicate",
        message: '"my address" is already a trigger.',
      }),
    });
    render(<SnippetsPage />);
    await waitFor(() => expect(screen.getByText("12 Hill Road / Pune …")).toBeTruthy());
    await act(async () => screen.getByRole("button", { name: "Edit my address" }).click());
    await act(async () => screen.getByRole("button", { name: "Save changes" }).click());
    await waitFor(() =>
      expect(screen.getByText('"my address" is already a trigger.')).toBeTruthy(),
    );
  });
});
