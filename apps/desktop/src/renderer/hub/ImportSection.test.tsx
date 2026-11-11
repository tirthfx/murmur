// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportSection } from "./ImportSection";
import { createMockApi } from "./test-api";

afterEach(cleanup);

describe("Import section", () => {
  it("previews a file, names bad lines, and imports on confirm", async () => {
    const importPreview = vi.fn().mockResolvedValue({
      kind: "dictionary",
      added: 2,
      sample: [
        { line: 1, text: "Kubernetes" },
        { line: 2, text: "k8s → Kubernetes" },
      ],
      duplicates: [{ line: 3, text: "GitHub" }],
      invalid: [{ line: 4, text: "more than two columns" }],
      blocked: null,
    });
    const importApply = vi.fn().mockResolvedValue({ ok: true, added: 2 });
    const onImported = vi.fn();
    window.murmur = createMockApi({ importPreview, importApply });
    render(<ImportSection kind="dictionary" onImported={onImported} />);
    const file = new File(["Kubernetes\nk8s,Kubernetes\nGitHub\na,b,c"], "words.csv", {
      type: "text/csv",
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Choose a file/), { target: { files: [file] } });
    });
    await waitFor(() =>
      expect(screen.getByText(/2 new, 1 already there \(skipped\), 1 not readable/)).toBeTruthy(),
    );
    expect(importPreview).toHaveBeenCalledWith({
      kind: "dictionary",
      fileName: "words.csv",
      text: "Kubernetes\nk8s,Kubernetes\nGitHub\na,b,c",
    });
    expect(screen.getByText("Line 4: more than two columns")).toBeTruthy();
    await act(async () => screen.getByRole("button", { name: "Import 2" }).click());
    expect(importApply).toHaveBeenCalledOnce();
    expect(onImported).toHaveBeenCalledOnce();
    expect(screen.getByText("Imported 2.")).toBeTruthy();
  });
});
