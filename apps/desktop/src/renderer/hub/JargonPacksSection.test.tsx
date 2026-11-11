// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { JargonPacksSection } from "./JargonPacksSection";
import { createMockApi } from "./test-api";

afterEach(cleanup);

describe("Developer word packs", () => {
  it("shows Git, package managers and web on, and turns a pack on alone", async () => {
    const api = createMockApi();
    window.murmur = api;
    render(<JargonPacksSection />);
    const cloud = await screen.findByRole("switch", { name: /Cloud CLIs and tools/ });
    expect(
      (screen.getByRole("switch", { name: /Git and GitHub/ }) as HTMLInputElement).checked,
    ).toBe(true);
    expect((cloud as HTMLInputElement).checked).toBe(false);
    await act(async () => cloud.click());
    expect(api.updateSettings).toHaveBeenCalledWith({
      jargonPacks: { git: true, packages: true, web: true, cloud: true, databases: false },
    });
  });
});
