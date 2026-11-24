import { describe, expect, it } from "vitest";
import { meetingShare } from "./meeting-share";

const base = {
  title: "Budget review",
  startedAt: Date.UTC(2026, 10, 20, 9, 0),
  durationMs: 45 * 60_000,
  summary: {
    markdown: "## Decisions\n- Cut the spend [12:34](seg:abc) by **10%**",
    skillName: "Call recap",
  },
  tasks: [
    {
      title: "Send the numbers",
      status: "open" as const,
      owner: "Dana",
      ownerIsMe: false,
      dueOn: "2026-11-27",
    },
    { title: "Old thing", status: "archived" as const, owner: null, ownerIsMe: false, dueOn: null },
    { title: "Book the room", status: "open" as const, owner: "Me", ownerIsMe: true, dueOn: null },
  ],
};

describe("what a meeting shares into a team folder", () => {
  it("is the title, the summary and the open tasks, as Markdown", () => {
    const shared = meetingShare(base)!;
    expect(shared.title).toBe("Budget review");
    expect(shared.body).toContain("# Budget review");
    expect(shared.body).toContain("Summary: Call recap");
    expect(shared.body).toContain("## Decisions");
    expect(shared.body).toContain("by **10%**");
    expect(shared.body).toContain("## Tasks");
    expect(shared.body).toContain("Send the numbers (Dana), due 2026-11-27");
    expect(shared.body).toContain("Book the room (me)");
    expect(shared.body).not.toContain("Old thing");
  });

  it("keeps the words of a transcript link and drops the link, which means nothing to others", () => {
    const shared = meetingShare(base)!;
    expect(shared.body).toContain("Cut the spend 12:34 by");
    expect(shared.body).not.toContain("seg:");
  });

  it("has no summary section to share and returns nothing when there is no summary yet", () => {
    expect(meetingShare({ ...base, summary: null })).toBeNull();
    expect(meetingShare({ ...base, summary: { markdown: "  \n", skillName: "x" } })).toBeNull();
  });

  it("leaves out the tasks section when there are none", () => {
    expect(meetingShare({ ...base, tasks: [] })!.body).not.toContain("## Tasks");
  });

  it("cuts a long title to fit a note's title", () => {
    expect(meetingShare({ ...base, title: "x".repeat(300) })!.title).toHaveLength(200);
  });
});
