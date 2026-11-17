// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanField } from "./PlanField";

afterEach(cleanup);

describe("Plan field", () => {
  it("says nothing is charged and shows the current plan", () => {
    render(<PlanField plan="free" onChange={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Plan" })).toBeTruthy();
    expect(screen.getByText(/Nothing is charged/)).toBeTruthy();
    expect(screen.getByRole("combobox").textContent).toContain("Free");
  });
});
