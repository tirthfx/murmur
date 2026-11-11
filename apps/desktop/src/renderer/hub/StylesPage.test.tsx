// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { presetExample, StylesPage } from "./StylesPage";
import { createMockApi, SAMPLE_STYLES } from "./test-api";

afterEach(cleanup);

describe("Styles page", () => {
  it("shows each preset's example as the pipeline's rules would write it", () => {
    expect(presetExample("caps")).toBe(
      "Sounds good. I'll send the notes tonight. Can you check them tomorrow?",
    );
    expect(presetExample("no-caps-no-stop")).toBe(
      "sounds good I'll send the notes tonight can you check them tomorrow?",
    );
  });

  it("lists the four styles and saves an instruction", async () => {
    const stylesUpdate = vi.fn().mockResolvedValue(SAMPLE_STYLES);
    window.murmur = createMockApi({ stylesUpdate });
    render(<StylesPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Email" })).toBeTruthy());
    expect(screen.getByTestId("example-personal").textContent).toBe(
      `Example: ${presetExample("no-caps-less")}`,
    );
    fireEvent.change(screen.getByLabelText(/Your own instructions for Work/), {
      target: { value: "Use British spelling." },
    });
    await act(async () => screen.getByRole("button", { name: "Save Work instructions" }).click());
    expect(stylesUpdate).toHaveBeenCalledWith({
      category: "work",
      preset: "caps",
      instructions: "Use British spelling.",
    });
  });

  it("adds an app by bundle id", async () => {
    const stylesSetOverride = vi.fn().mockResolvedValue(SAMPLE_STYLES);
    window.murmur = createMockApi({ stylesSetOverride });
    render(<StylesPage />);
    await waitFor(() => expect(screen.getByLabelText(/App bundle id/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/App bundle id/), {
      target: { value: "com.example.chat" },
    });
    await act(async () => screen.getByRole("button", { name: "Add app" }).click());
    expect(stylesSetOverride).toHaveBeenCalledWith({
      bundleId: "com.example.chat",
      appName: null,
      category: "work",
    });
  });
});
