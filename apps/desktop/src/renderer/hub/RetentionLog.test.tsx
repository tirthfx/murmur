// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetentionLog } from "./RetentionLog";
import { createMockApi } from "./test-api";

afterEach(cleanup);

describe("the retention log (NT-22)", () => {
  it("lists what was deleted", async () => {
    window.murmur = createMockApi({
      meetingRetentionLog: vi
        .fn()
        .mockResolvedValue([{ meetingId: "m1", title: "Sync", kind: "audio", at: 0 }]),
    });
    render(<RetentionLog />);
    const list = await screen.findByRole("list", { name: "Deleted by retention" });
    expect(list.textContent).toContain("Recording of “Sync”");
  });

  it("shows nothing when nothing was deleted", () => {
    window.murmur = createMockApi();
    const { container } = render(<RetentionLog />);
    expect(container.textContent).toBe("");
  });
});
