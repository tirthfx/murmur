// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FailureBanner } from "./FailureBanner";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** What the page raises when a request nobody caught fails. */
function fail(): void {
  const event = new Event("unhandledrejection");
  Object.assign(event, { reason: new Error("IPC rejected") });
  act(() => {
    window.dispatchEvent(event);
  });
}

describe("a failed action", () => {
  it("shows nothing until something fails, then says so until dismissed", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<FailureBanner />);
    expect(screen.queryByText("That did not work")).toBeNull();
    fail();
    expect(screen.getByText("That did not work")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss the error" }));
    expect(screen.queryByText("That did not work")).toBeNull();
  });

  it("keeps the reason out of the page", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { container } = render(<FailureBanner />);
    fail();
    expect(container.textContent).not.toContain("IPC rejected");
  });
});
