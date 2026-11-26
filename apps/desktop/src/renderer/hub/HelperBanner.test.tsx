// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelperBanner } from "./HelperBanner";
import { createMockApi } from "./test-api";

afterEach(cleanup);

describe("the helper banner", () => {
  it("offers a retry only when the helper gave up", async () => {
    window.murmur = createMockApi();
    vi.mocked(window.murmur.getHelperStatus).mockResolvedValue({
      state: "error",
      helperVersion: null,
      message: "The helper stopped after 3 restarts.",
    });
    render(<HelperBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Start the helper again" }));
    await waitFor(() => expect(window.murmur.helperRetry).toHaveBeenCalled());
  });

  it("stays away while the helper works", async () => {
    window.murmur = createMockApi();
    vi.mocked(window.murmur.getHelperStatus).mockResolvedValue({
      state: "ready",
      helperVersion: "1",
      message: null,
    });
    render(<HelperBanner />);
    await waitFor(() => expect(window.murmur.getHelperStatus).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });
});
