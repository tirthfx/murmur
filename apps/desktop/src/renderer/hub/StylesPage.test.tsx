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

  it("keeps an edit made right after the page opens, and follows a later save", async () => {
    let finish: (view: typeof SAMPLE_STYLES) => void = () => {};
    const stylesView = vi.fn(
      () =>
        new Promise<typeof SAMPLE_STYLES>((resolve) => {
          finish = resolve;
        }),
    );
    const saved = {
      ...SAMPLE_STYLES,
      styles: SAMPLE_STYLES.styles.map((style) =>
        style.category === "work" ? { ...style, instructions: "Use British spelling." } : style,
      ),
    };
    const stylesUpdate = vi.fn().mockResolvedValue(saved);
    window.murmur = createMockApi({ stylesView, stylesUpdate });
    render(<StylesPage />);
    // The view arrives outside act, as it does in the app.
    finish(SAMPLE_STYLES);
    const field = await screen.findByLabelText(/Your own instructions for Work/);
    fireEvent.change(field, { target: { value: "Use British spelling." } });
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
    expect((field as HTMLTextAreaElement).value).toBe("Use British spelling.");
    await act(async () => screen.getByRole("button", { name: "Save Work instructions" }).click());
    expect(stylesUpdate).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole("button", { name: "Save Work instructions" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
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
