// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DictionaryEntry } from "@murmur/shared";
import { DictionaryPage, filterEntries, sortEntries } from "./DictionaryPage";
import { createMockApi } from "./test-api";

const entry = (term: string, extra: Partial<DictionaryEntry> = {}): DictionaryEntry => ({
  id: `id-${term}`,
  term,
  replacement: null,
  caseSensitive: false,
  source: "manual",
  starred: false,
  useCount: 0,
  kind: "term",
  hasClip: false,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

afterEach(cleanup);

describe("dictionary list helpers", () => {
  it("sorts starred first, then by the chosen order", () => {
    const list = [
      entry("beta", { useCount: 5, updatedAt: 1 }),
      entry("Alpha", { updatedAt: 3 }),
      entry("zulu", { starred: true }),
    ];
    expect(sortEntries(list, "az").map((item) => item.term)).toEqual(["zulu", "Alpha", "beta"]);
    expect(sortEntries(list, "used").map((item) => item.term)).toEqual(["zulu", "beta", "Alpha"]);
    expect(sortEntries(list, "recent").map((item) => item.term)).toEqual(["zulu", "Alpha", "beta"]);
  });

  it("finds by term or replacement, and filters to starred", () => {
    const list = [entry("k8s", { replacement: "Kubernetes" }), entry("Priya", { starred: true })];
    expect(filterEntries(list, "kube", false).map((item) => item.term)).toEqual(["k8s"]);
    expect(filterEntries(list, "", true).map((item) => item.term)).toEqual(["Priya"]);
  });
});

describe("Dictionary page", () => {
  it("adds a word and shows a refusal with its reason", async () => {
    const saved = entry("Kubernetes");
    const dictionaryList = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([saved]);
    const dictionarySave = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, entry: saved })
      .mockResolvedValueOnce({
        ok: false,
        reason: "duplicate",
        message: '"Kubernetes" is already in the dictionary.',
        existing: saved,
      });
    window.murmur = createMockApi({ dictionaryList, dictionarySave });
    render(<DictionaryPage />);
    await waitFor(() => expect(screen.getByText("No words saved yet.")).toBeTruthy());

    const word = screen.getByLabelText("Word or phrase");
    fireEvent.change(word, { target: { value: "Kubernetes" } });
    await act(async () => screen.getByRole("button", { name: "Add" }).click());
    expect(dictionarySave).toHaveBeenCalledWith({
      term: "Kubernetes",
      replacement: null,
      caseSensitive: false,
      starred: false,
    });
    await waitFor(() => expect(screen.getByText("1 entry")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Word or phrase"), { target: { value: "kubernetes" } });
    await act(async () => screen.getByRole("button", { name: "Add" }).click());
    await waitFor(() =>
      expect(screen.getByText('"Kubernetes" is already in the dictionary.')).toBeTruthy(),
    );
  });

  it("asks before deleting an entry used more than 20 times", async () => {
    const used = entry("GitHub", { useCount: 21 });
    const dictionaryDelete = vi.fn().mockResolvedValue(undefined);
    window.murmur = createMockApi({
      dictionaryList: vi.fn().mockResolvedValue([used]),
      dictionaryDelete,
    });
    render(<DictionaryPage />);
    await waitFor(() => expect(screen.getByText("GitHub")).toBeTruthy());
    await act(async () => screen.getByRole("button", { name: "Delete GitHub" }).click());
    expect(dictionaryDelete).not.toHaveBeenCalled();
    await act(async () => screen.getByRole("button", { name: "Confirm deleting GitHub" }).click());
    expect(dictionaryDelete).toHaveBeenCalledWith("id-GitHub");
  });

  it("keeps a learned entry and filters to learned ones", async () => {
    const learned = entry("Kube net is", { replacement: "Kubernetes", source: "auto" });
    const dictionaryKeep = vi.fn().mockResolvedValue(undefined);
    window.murmur = createMockApi({
      dictionaryList: vi.fn().mockResolvedValue([learned, entry("Priya")]),
      dictionaryKeep,
    });
    render(<DictionaryPage />);
    await waitFor(() => expect(screen.getByText("Learned")).toBeTruthy());
    await act(async () => screen.getByRole("switch", { name: "Learned only" }).click());
    expect(screen.queryByText("Priya")).toBeNull();
    await act(async () => screen.getByRole("button", { name: "Keep Kube net is" }).click());
    expect(dictionaryKeep).toHaveBeenCalledWith("id-Kube net is");
    expect(screen.getByRole("switch", { name: /Learn from my corrections/ })).toBeTruthy();
  });

  it("stars an entry by saving it with the star on", async () => {
    const plain = entry("Priya");
    const dictionarySave = vi.fn().mockResolvedValue({ ok: true, entry: plain });
    window.murmur = createMockApi({
      dictionaryList: vi.fn().mockResolvedValue([plain]),
      dictionarySave,
    });
    render(<DictionaryPage />);
    await waitFor(() => expect(screen.getByText("Priya")).toBeTruthy());
    await act(async () => screen.getByRole("button", { name: "Star Priya" }).click());
    expect(dictionarySave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "id-Priya", starred: true }),
    );
  });
});
