import { describe, expect, it, vi } from "vitest";
import { formatSkillFile } from "@murmur/shared";
import { openDatabase } from "../db/database";
import { createSkillsService } from "./skills-service";
import { createSkillsStore } from "./summaries-store";

function setup() {
  const files = new Map<string, string>();
  let n = 0;
  const onRemoved = vi.fn();
  const onChanged = vi.fn();
  const service = createSkillsService({
    store: createSkillsStore(openDatabase(":memory:")),
    newId: () => `${String(++n).padStart(6, "0")}-id`,
    now: () => 100 + n,
    folder: {
      write: (name, text) => void files.set(name, text),
      remove: (name) => void files.delete(name),
    },
    onRemoved,
    onChanged,
  });
  return { service, files, onRemoved, onChanged };
}

const draft = {
  name: "Retro",
  description: "d",
  sections: ["Good", "Bad"],
  length: "short",
  model: "fast" as const,
  prompt: "Write.",
};

describe("skills service", () => {
  it("creates a Skill and writes its file", () => {
    const t = setup();
    const result = t.service.save(null, draft);
    expect(result).toMatchObject({ ok: true, skill: { name: "Retro", version: 1 } });
    expect([...t.files.keys()]).toEqual(["retro-000001.md"]);
    expect(t.files.get("retro-000001.md")).toContain("name: Retro");
    expect(t.onChanged).toHaveBeenCalled();
  });

  it("refuses an invalid draft with a message", () => {
    const t = setup();
    expect(t.service.save(null, { ...draft, sections: [] })).toMatchObject({ ok: false });
    expect(t.service.save(null, { ...draft, name: " " })).toMatchObject({ ok: false });
    expect(t.files.size).toBe(0);
  });

  it("edits into a new version, moves the file when the name changes, and can undo", () => {
    const t = setup();
    const created = t.service.save(null, draft);
    if (!created.ok) throw new Error("not created");
    const id = created.skill.id;
    const edited = t.service.save(id, { ...draft, name: "Sprint retro", prompt: "Write more." });
    expect(edited).toMatchObject({ ok: true, skill: { version: 2 } });
    expect([...t.files.keys()]).toEqual(["sprint-retro-000001.md"]);
    expect(t.service.versions(id)).toHaveLength(1);
    expect(t.service.restore(id, 1)).toMatchObject({
      ok: true,
      skill: { version: 3, name: "Retro" },
    });
    expect([...t.files.keys()]).toEqual(["retro-000001.md"]);
    expect(t.service.versions(id).map((v) => v.version)).toEqual([2, 1]);
    expect(t.service.restore(id, 99)).toMatchObject({ ok: false });
  });

  it("does not edit or delete a built-in", () => {
    const t = setup();
    expect(t.service.save("meeting-summary", draft)).toMatchObject({ ok: false });
    expect(t.service.remove("meeting-summary")).toMatchObject({ ok: false });
    expect(t.service.save("nope", draft)).toMatchObject({ ok: false });
    expect(t.service.remove("nope")).toMatchObject({ ok: false });
    expect(t.service.versions("meeting-summary")).toEqual([]);
  });

  it("duplicates, and gives files of two Skills with one name different names", () => {
    const t = setup();
    t.service.save(null, draft);
    t.service.save(null, draft);
    expect([...t.files.keys()].sort()).toEqual(["retro-000001.md", "retro-000002.md"]);
    expect(t.files.size).toBe(2);
    const copy = t.service.duplicate("meeting-summary");
    expect(copy).toMatchObject({ ok: true, skill: { basedOn: "meeting-summary" } });
    expect(t.files.size).toBe(3);
    expect(t.service.duplicate("nope")).toMatchObject({ ok: false });
  });

  it("deletes a Skill, its file, and tells the setting", () => {
    const t = setup();
    const created = t.service.save(null, draft);
    if (!created.ok) throw new Error("not created");
    expect(t.service.remove(created.skill.id)).toEqual({ ok: true });
    expect(t.files.size).toBe(0);
    expect(t.onRemoved).toHaveBeenCalledWith(created.skill.id);
    expect(t.service.list().every((s) => s.builtIn)).toBe(true);
  });

  it("exports a Skill and imports it back", () => {
    const t = setup();
    const exported = t.service.exportFile("meeting-summary")!;
    expect(exported.fileName).toBe("meeting-summary.md");
    const result = t.service.importFile(exported.text);
    expect(result).toMatchObject({ ok: true, skill: { name: "Meeting summary", builtIn: false } });
    expect(t.service.exportFile("nope")).toBeNull();
  });

  it("names the line of a bad import and creates nothing", () => {
    const t = setup();
    const bad = formatSkillFile({ ...draft, length: "short", version: 1 }).replace(
      "length: short",
      "length: huge",
    );
    const result = t.service.importFile(bad);
    expect(result).toMatchObject({
      ok: false,
      line: 4,
      message: expect.stringContaining("Line 4:"),
    });
    expect(t.service.list().every((s) => s.builtIn)).toBe(true);
  });

  it("still saves when the folder cannot be written", () => {
    const t = setup();
    const service = createSkillsService({
      store: createSkillsStore(openDatabase(":memory:")),
      newId: () => "id-1",
      now: () => 1,
      folder: {
        write: () => {
          throw new Error("disk full");
        },
        remove: () => {
          throw new Error("nope");
        },
      },
    });
    expect(service.save(null, draft)).toMatchObject({ ok: true });
    expect(service.remove("id-1")).toEqual({ ok: true });
    expect(t.files.size).toBe(0);
  });
});
