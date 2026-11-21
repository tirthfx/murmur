// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_SKILLS, type Skill, type SkillVersion } from "@murmur/shared";
import { SkillsManager } from "./SkillsManager";
import { createMockApi } from "./test-api";

const mine: Skill = {
  id: "s-1",
  name: "Retro",
  description: "What went well.",
  sections: ["Went well", "To change"],
  length: "short",
  prompt: "Write a retro.",
  builtIn: false,
  version: 2,
  basedOn: null,
  basedOnVersion: null,
};
const earlier: SkillVersion = {
  skillId: "s-1",
  version: 1,
  name: "Retro v1",
  description: "",
  sections: ["Went well"],
  length: "short",
  prompt: "Old prompt.",
  createdAt: Date.UTC(2026, 10, 20, 9, 0),
};

let api: ReturnType<typeof createMockApi>;
beforeEach(() => {
  api = createMockApi();
  api.skillsList = vi.fn().mockResolvedValue([...BUILT_IN_SKILLS, mine]);
  api.skillVersions = vi.fn().mockResolvedValue([earlier]);
  (window as unknown as { murmur: unknown }).murmur = api;
});
afterEach(cleanup);

const pick = async (name: string) => {
  const list = await screen.findByRole("list", { name: "Skills" });
  fireEvent.click(within(list).getByText(name));
};

describe("Skills manager (NT-16)", () => {
  it("lists built-ins and custom Skills and shows a built-in as read-only", async () => {
    render(<SkillsManager />);
    await pick("Action review");
    expect(await screen.findByText(/read-only/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("button", { name: "Duplicate to edit" })).toBeTruthy();
  });

  it("duplicates a built-in and opens the copy", async () => {
    const copy: Skill = { ...mine, id: "c-1", name: "Action review (copy)", version: 1 };
    api.skillDuplicate = vi.fn().mockResolvedValue({ ok: true, skill: copy });
    api.skillsList = vi
      .fn()
      .mockResolvedValueOnce([...BUILT_IN_SKILLS])
      .mockResolvedValue([...BUILT_IN_SKILLS, copy]);
    render(<SkillsManager />);
    await pick("Action review");
    fireEvent.click(screen.getByRole("button", { name: "Duplicate to edit" }));
    await waitFor(() => expect(api.skillDuplicate).toHaveBeenCalledWith("action-review"));
    expect(await screen.findByDisplayValue("Action review (copy)")).toBeTruthy();
  });

  it("edits a custom Skill and shows the version it kept", async () => {
    api.skillSave = vi.fn().mockResolvedValue({ ok: true, skill: { ...mine, version: 3 } });
    render(<SkillsManager />);
    await pick("Retro");
    expect(await screen.findByDisplayValue("Write a retro.")).toBeTruthy();
    expect(screen.getByText(/Version 1: Retro v1/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("What to write"), {
      target: { value: "Write a better retro." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.skillSave).toHaveBeenCalledWith("s-1", {
        name: "Retro",
        description: "What went well.",
        length: "short",
        sections: ["Went well", "To change"],
        prompt: "Write a better retro.",
      }),
    );
  });

  it("goes back to an earlier version", async () => {
    api.skillRestore = vi.fn().mockResolvedValue({ ok: true, skill: { ...mine, version: 3 } });
    render(<SkillsManager />);
    await pick("Retro");
    fireEvent.click(await screen.findByRole("button", { name: "Go back to version 1" }));
    await waitFor(() => expect(api.skillRestore).toHaveBeenCalledWith("s-1", 1));
  });

  it("makes a new Skill, and says what is wrong before sending a bad one", async () => {
    const made: Skill = { ...mine, id: "n-1", name: "Standup", version: 1 };
    api.skillSave = vi.fn().mockResolvedValue({ ok: true, skill: made });
    render(<SkillsManager />);
    fireEvent.click(await screen.findByRole("button", { name: "New Skill" }));
    fireEvent.click(screen.getByRole("button", { name: "Create the Skill" }));
    expect(await screen.findByText("Give the Skill a name of up to 80 characters.")).toBeTruthy();
    expect(api.skillSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Standup" } });
    fireEvent.click(screen.getByRole("button", { name: "Create the Skill" }));
    expect(await screen.findByText(/one to twelve sections/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Sections"), { target: { value: "Done\n\nNext\n" } });
    fireEvent.change(screen.getByLabelText("What to write"), { target: { value: "Write it." } });
    fireEvent.click(screen.getByRole("button", { name: "Create the Skill" }));
    await waitFor(() =>
      expect(api.skillSave).toHaveBeenCalledWith(null, {
        name: "Standup",
        description: "",
        length: "medium",
        sections: ["Done", "Next"],
        prompt: "Write it.",
      }),
    );
  });

  it("deletes only after a second click", async () => {
    render(<SkillsManager />);
    await pick("Retro");
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(api.skillDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete the Skill for good" }));
    await waitFor(() => expect(api.skillDelete).toHaveBeenCalledWith("s-1"));
  });

  it("shows the failing line of a bad import", async () => {
    api.skillImport = vi.fn().mockResolvedValue({
      ok: false,
      message: "Line 4: The length must be one of: short, medium, long.",
      line: 4,
    });
    render(<SkillsManager />);
    fireEvent.click(await screen.findByRole("button", { name: "Import a Skill" }));
    expect(await screen.findByText(/^Line 4:/)).toBeTruthy();
  });

  it("opens an imported Skill, and says nothing when the file chooser is cancelled", async () => {
    api.skillImport = vi.fn().mockResolvedValueOnce({ ok: false, cancelled: true });
    render(<SkillsManager />);
    fireEvent.click(await screen.findByRole("button", { name: "Import a Skill" }));
    await waitFor(() => expect(api.skillImport).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("badges a copy whose built-in has a new version", async () => {
    // The built-ins are at version 1 today, so nothing is badged.
    api.skillsList = vi
      .fn()
      .mockResolvedValue([
        ...BUILT_IN_SKILLS,
        { ...mine, basedOn: "meeting-summary", basedOnVersion: 1 },
      ]);
    render(<SkillsManager />);
    await screen.findByRole("list", { name: "Skills" });
    expect(screen.queryByText("New version")).toBeNull();
  });
});
