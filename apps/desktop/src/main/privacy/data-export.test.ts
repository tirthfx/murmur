import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HistoryRow } from "@murmur/shared";
import { writeExport, type ExportSources } from "./data-export";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "export-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function row(i: number): HistoryRow {
  return {
    id: `h${i}`,
    createdAt: Date.UTC(2026, 10, 18, 9, i),
    appName: "Notes",
    appBundleId: "com.apple.Notes",
    status: "done",
    language: "en",
    durationMs: 1000,
    wordCount: 2,
    rawText: `um hello ${i}`,
    finalText: `Hello ${i}.`,
    archived: false,
    feedback: null,
    feedbackNote: null,
    hasAudio: false,
  };
}

function sources(audio: string[] = []): ExportSources {
  return {
    dictations: () => Array.from({ length: 1000 }, (_, i) => row(i)),
    dictionary: () => [
      {
        id: "d",
        term: "Kubernetes, k8s",
        replacement: null,
        caseSensitive: false,
        source: "manual",
        starred: true,
        useCount: 3,
        kind: "term",
        hasClip: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    snippets: () => [
      {
        id: "s",
        trigger: "my address",
        format: "plain",
        plain: "1 Main St",
        rich: null,
        useCount: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    styles: () => ({ styles: [], overrides: [], recentApps: [] }),
    customRewrites: () => [],
    memory: () => [],
    notes: () => [
      {
        id: "n",
        title: "Plan",
        body: { blocks: [{ type: "paragraph", inlines: [{ text: "Go" }] }] },
        plain: "Go",
        createdAt: 1,
        updatedAt: 1,
        pinned: false,
      },
    ],
    noteImages: { file: () => null, dataUrl: () => null },
    instructThreads: () => [],
    insights: () => [],
    meetings: () => [],
    tasks: () => [],
    contacts: () => [],
    audioFiles: () => audio,
  };
}

describe("data export (HB-46)", () => {
  it("writes the ticked categories and an index whose counts match", () => {
    const counts = writeExport(
      dir,
      ["dictations", "dictionary", "snippets", "notes"],
      sources(),
      0,
    );
    expect(counts).toEqual({ dictations: 1000, dictionary: 1, snippets: 1, notes: 1 });
    expect(JSON.parse(readFileSync(path.join(dir, "dictations.json"), "utf8"))).toHaveLength(1000);
    expect(readFileSync(path.join(dir, "dictionary.csv"), "utf8")).toContain('"Kubernetes, k8s"');
    expect(readFileSync(path.join(dir, "notes", "Plan.md"), "utf8")).toContain("# Plan");
    const index = readFileSync(path.join(dir, "README.md"), "utf8");
    expect(index).toContain("| Dictations (final and raw text) | dictations.json | 1000 | 1 |");
    expect(existsSync(path.join(dir, "memory.json"))).toBe(false);
  });

  it("leaves audio out unless ticked", () => {
    const recording = path.join(dir, "rec.pcm");
    writeFileSync(recording, "pcm");
    const out = path.join(dir, "out");
    writeExport(out, ["dictionary"], sources([recording]), 0);
    expect(existsSync(path.join(out, "audio"))).toBe(false);
    const withAudio = path.join(dir, "with");
    expect(writeExport(withAudio, ["audio"], sources([recording]), 0)).toEqual({ audio: 1 });
    expect(existsSync(path.join(withAudio, "audio", "rec.pcm"))).toBe(true);
  });
});

describe("exporting meetings (HB-46)", () => {
  it("writes one file per meeting, with tasks and contacts, never mixing up names", () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), "export-meetings-"));
    const meeting = {
      title: "Plan: Q1/Q2",
      startedAt: Date.UTC(2026, 0, 5),
      endedAt: null,
      attendees: [],
      notes: "Hello",
      summaries: [],
      transcript: [],
    };
    const counts = writeExport(
      folder,
      ["meetings"],
      { ...sources(), meetings: () => [meeting, meeting], tasks: () => [{ title: "t" }] },
      0,
    );
    expect(counts.meetings).toBe(2);
    expect(readdirSync(path.join(folder, "meetings")).sort()).toEqual([
      "2026-01-05 Plan Q1 Q2 2.json",
      "2026-01-05 Plan Q1 Q2.json",
    ]);
    expect(readFileSync(path.join(folder, "tasks.json"), "utf8")).toContain('"t"');
    rmSync(folder, { recursive: true, force: true });
  });
});
