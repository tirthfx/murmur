// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguagesField, moveUp } from "./LanguagesField";

afterEach(() => cleanup());

describe("Languages field", () => {
  it("moves a language up one place", () => {
    expect(moveUp(["en", "hi", "fr"], 2)).toEqual(["en", "fr", "hi"]);
    expect(moveUp(["en", "hi"], 0)).toEqual(["en", "hi"]);
  });

  it("marks the primary, reorders and removes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LanguagesField languages={["en", "hi"]} onChange={onChange} />);
    expect(screen.getByText("English (primary)")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Move Hindi up" }));
    expect(onChange).toHaveBeenLastCalledWith(["hi", "en"]);
    await user.click(screen.getByRole("button", { name: "Remove English" }));
    expect(onChange).toHaveBeenLastCalledWith(["hi"]);
  });

  it("says detection is automatic with none, and blocks a sixth language", () => {
    const { rerender } = render(<LanguagesField languages={[]} onChange={vi.fn()} />);
    expect(screen.getByText(/Detected automatically/)).toBeTruthy();
    rerender(<LanguagesField languages={["en", "hi", "mr", "fr", "de"]} onChange={vi.fn()} />);
    expect(screen.getByText(/at most five languages/)).toBeTruthy();
    expect(screen.queryByText("Add a language")).toBeNull();
  });
});
