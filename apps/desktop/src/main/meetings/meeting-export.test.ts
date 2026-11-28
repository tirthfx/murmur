import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_OPTIONS } from "@murmur/shared";
import { exportFileName, renderMeetingHtml, summaryHtml, type ExportInput } from "./meeting-export";

const input = (over: Partial<ExportInput> = {}): ExportInput => ({
  title: "Design sync",
  startedAt: new Date(2026, 10, 21, 10, 0).getTime(),
  durationMs: 1_800_000,
  folderName: "Customer calls",
  segments: [
    { id: "m-1:mic:1:0", startMs: 2_000, speaker: "You", text: "Shall we start?" },
    { id: "m-1:system:1:0", startMs: 65_000, speaker: "Dana", text: "Yes, the roadmap first." },
  ],
  summary: {
    markdown:
      "## Decisions\n- Start with the roadmap [1:05](seg:m-1:system:1:0)\n- Ship on **Thursday** (No source)\n\n## Risks\nNot discussed",
    skillName: "Meeting summary",
    createdAt: 1,
  },
  tasks: [
    { title: "Send the budget", status: "open", owner: null, ownerIsMe: true, dueOn: "2026-11-27" },
    { title: "Book the room", status: "suggested", owner: "Priya", ownerIsMe: false, dueOn: null },
  ],
  notes: "My private notes",
  options: DEFAULT_EXPORT_OPTIONS,
  exportedAt: new Date(2026, 10, 22).getTime(),
  ...over,
});

describe("shareable file (NT-18)", () => {
  it("holds the summary, the transcript and the tasks, and says the audio is not in it", () => {
    const html = renderMeetingHtml(input());
    expect(html).toContain("<h1>Design sync</h1>");
    expect(html).toContain("Saturday, 21 November 2026");
    expect(html).toContain("Folder: Customer calls");
    expect(html).toContain("<h3>Decisions</h3>");
    expect(html).toContain("<strong>Thursday</strong>");
    expect(html).toContain("Send the budget");
    expect(html).toContain("Open, owner: me, due 2026-11-27");
    expect(html).toContain("Suggested, owner: Priya");
    expect(html).toContain('<span class="who">Dana</span>Yes, the roadmap first.');
    expect(html).toContain("The audio is not included.");
    expect(html).not.toContain("My private notes");
  });

  it("opens offline: no scripts, fonts, images or links to the web", () => {
    const html = renderMeetingHtml(input());
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/<iframe|<object|<embed/i);
    expect(html).not.toMatch(/@import|url\(/i);
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).toContain("default-src 'none'");
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("links a summary bullet to the transcript line it came from", () => {
    const html = renderMeetingHtml(input());
    const link = /<a href="#(seg-[^"]+)">1:05<\/a>/.exec(html);
    expect(link).not.toBeNull();
    expect(html).toContain(`id="${link![1]}"`);
  });

  it("escapes every piece of text", () => {
    const html = renderMeetingHtml(
      input({
        title: '<script>alert("x")</script>',
        folderName: "<b>f</b>",
        segments: [
          {
            id: "a",
            startMs: 0,
            speaker: "<i>Eve</i>",
            text: "<img src=x onerror=alert(1)> & more",
          },
        ],
        summary: {
          markdown: "## <u>Head</u>\n- <script>bad()</script> [0:00](seg:a)",
          skillName: "<s>",
          createdAt: 1,
        },
        tasks: [
          {
            title: "<a href='x'>t</a>",
            status: "open",
            owner: "<o>",
            ownerIsMe: false,
            dueOn: null,
          },
        ],
        options: { ...DEFAULT_EXPORT_OPTIONS, notes: true },
        notes: "<style>body{display:none}</style>",
      }),
    );
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain("<b>f</b>");
    expect(html).not.toContain("<style>body");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; more");
  });

  it("leaves out what was not asked for", () => {
    const only = (options: Partial<typeof DEFAULT_EXPORT_OPTIONS>) =>
      renderMeetingHtml(
        input({
          options: {
            summary: false,
            transcript: false,
            tasks: false,
            notes: false,
            audio: false,
            ...options,
          },
        }),
      );
    const none = only({});
    expect(none).not.toContain("Decisions");
    expect(none).not.toContain("Shall we start?");
    expect(none).not.toContain("Send the budget");
    expect(only({ summary: true })).toContain("Decisions");
    expect(only({ summary: true })).not.toContain("Transcript</h2>");
    expect(only({ transcript: true })).toContain("Transcript</h2>");
    expect(only({ tasks: true })).toContain("Tasks</h2>");
    const notes = only({ notes: true });
    expect(notes).toContain("My private notes");
  });

  it("shows summary links as plain times when the transcript is left out", () => {
    const html = renderMeetingHtml(
      input({ options: { ...DEFAULT_EXPORT_OPTIONS, transcript: false } }),
    );
    expect(html).not.toContain('<a href="#seg-');
    expect(html).toContain('<span class="time">1:05</span>');
  });

  it("says what is missing instead of an empty section", () => {
    const html = renderMeetingHtml(input({ summary: null, tasks: [], segments: [] }));
    expect(html).toContain("This meeting has no summary yet.");
    expect(html).toContain("No tasks.");
    expect(html).toContain("No speech was found.");
  });

  it("renders only the limited Markdown of a summary", () => {
    expect(summaryHtml("## A\n- one\n- two\n\nplain **b**", true)).toBe(
      "<h3>A</h3>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<p>plain <strong>b</strong></p>",
    );
  });
});

describe("exportFileName", () => {
  it("is dated, and has no character a file name cannot hold", () => {
    const at = new Date(2026, 10, 21).getTime();
    expect(exportFileName("Design sync", at)).toBe("2026-11-21 Design sync.html");
    expect(exportFileName("Q4/Q1: plan?*", at)).toBe("2026-11-21 Q4 Q1 plan.html");
    expect(exportFileName("  ..hidden ", at)).toBe("2026-11-21 hidden.html");
    expect(exportFileName("???", at)).toBe("2026-11-21 Meeting.html");
    expect(exportFileName("x".repeat(200), at).length).toBeLessThanOrEqual(11 + 80 + 5);
  });
});

describe("audio in an export (NT-18)", () => {
  const input = {
    title: "Sync",
    startedAt: 0,
    durationMs: 1000,
    folderName: null,
    segments: [],
    summary: null,
    tasks: [],
    notes: "",
    audio: [{ name: "audio/mic-1.m4a", label: "You, from 00:00" }],
    exportedAt: 0,
  };

  it("plays the files beside the page when asked", () => {
    const html = renderMeetingHtml({
      ...input,
      options: { ...DEFAULT_EXPORT_OPTIONS, audio: true },
    });
    expect(html).toContain('src="audio/mic-1.m4a"');
    expect(html).not.toContain("The audio is not included");
  });

  it("says the audio is not included otherwise", () => {
    const html = renderMeetingHtml({ ...input, options: DEFAULT_EXPORT_OPTIONS });
    expect(html).not.toContain("audio/mic-1.m4a");
    expect(html).toContain("The audio is not included");
  });
});
