// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyVoicePage } from "./MyVoicePage";
import { createMockApi, SAMPLE_PROFILE } from "./test-api";

afterEach(cleanup);

describe("My Voice page", () => {
  it("says when there is not enough data, and resets only after confirming", async () => {
    const voiceProfileReset = vi.fn().mockResolvedValue(SAMPLE_PROFILE);
    window.murmur = createMockApi({ voiceProfileReset });
    render(<MyVoicePage />);
    await waitFor(() =>
      expect(screen.getByText(/Not enough data yet: a summary needs 20/)).toBeTruthy(),
    );
    await act(async () => screen.getByRole("button", { name: "Reset voice profile" }).click());
    expect(voiceProfileReset).not.toHaveBeenCalled();
    await act(async () =>
      screen.getByRole("button", { name: "Confirm resetting the voice profile" }).click(),
    );
    expect(voiceProfileReset).toHaveBeenCalledOnce();
  });
});
