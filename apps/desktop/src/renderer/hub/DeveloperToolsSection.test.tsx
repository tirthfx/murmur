// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeveloperToolsSection, parseCliNames, parseFolders } from "./DeveloperToolsSection";
import { createMockApi } from "./test-api";

afterEach(cleanup);

describe("developer tools", () => {
  it("reads folders and tool names", () => {
    expect(parseFolders(" ~/Developer \n\n/Users/me/work\n")).toEqual([
      "~/Developer",
      "/Users/me/work",
    ]);
    expect(parseCliNames("Claude, codex  aider, bad name!, claude")).toEqual([
      "claude",
      "codex",
      "aider",
      "bad",
    ]);
  });

  it("starts with all three off and turns one on alone", async () => {
    const api = createMockApi();
    window.murmur = api;
    render(<DeveloperToolsSection />);
    const tags = (await screen.findByRole("switch", { name: /File tags/ })) as HTMLInputElement;
    expect(tags.checked).toBe(false);
    expect((screen.getByRole("switch", { name: /Match names/ }) as HTMLInputElement).checked).toBe(
      false,
    );
    await act(async () => tags.click());
    expect(api.updateSettings).toHaveBeenCalledWith({
      developerTools: {
        fileTags: true,
        codeFolders: [],
        variables: false,
        cliDetection: false,
        cliNames: ["claude"],
      },
    });
    expect(screen.queryByLabelText(/^Coding tools/)).toBeNull();
  });
});
