// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_POLICY_VIEW, type PolicyView } from "@murmur/shared";
import { PolicyFeatureNotice, RetentionPolicyNote } from "./PolicyNotice";
import { createMockApi } from "./test-api";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(patch: Partial<PolicyView>, ui: React.ReactElement) {
  window.murmur = createMockApi({
    policyView: vi.fn().mockResolvedValue({ ...EMPTY_POLICY_VIEW, ...patch }),
  });
  render(ui);
}

describe("policy notices", () => {
  it("says a feature is turned off, and whom to ask", async () => {
    mount(
      { active: true, featuresOff: ["mcp"], adminContact: "it@acme.test" },
      <PolicyFeatureNotice feature="mcp" />,
    );
    const note = await screen.findByTestId("policy-off-mcp");
    expect(note.textContent).toBe("Turned off by your organization. Ask it@acme.test.");
  });

  it("shows nothing for a feature that is on", async () => {
    mount({ active: true, featuresOff: ["scratchpad"] }, <PolicyFeatureNotice feature="mcp" />);
    await Promise.resolve();
    expect(screen.queryByTestId("policy-off-mcp")).toBeNull();
  });

  it("says what retention the organization allows", async () => {
    mount(
      {
        active: true,
        retention: { audio: { max: 7, min: null }, transcript: { max: 365, min: 30 } },
      },
      <RetentionPolicyNote />,
    );
    const note = await screen.findByTestId("policy-retention");
    expect(note.textContent).toContain("Set by your organization");
    expect(note.textContent).toContain("Recordings: no longer than 7 days");
    expect(note.textContent).toContain(
      "Text and transcripts: no longer than 365 days, no shorter than 30 days",
    );
  });

  it("shows no retention note when no limit is set", async () => {
    mount({ active: true }, <RetentionPolicyNote />);
    await Promise.resolve();
    expect(screen.queryByTestId("policy-retention")).toBeNull();
  });
});
