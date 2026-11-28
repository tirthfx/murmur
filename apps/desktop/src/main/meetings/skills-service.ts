import {
  formatSkillFile,
  parseSkillFile,
  skillDraftSchema,
  skillFileName,
  type Skill,
  type SkillDraft,
  type SkillImportResult,
  type SkillResult,
  type SkillVersion,
} from "@murmur/shared";
import type { SkillsStore } from "./summaries-store";

/** Where custom Skills are also kept as `.md` files, so the owner can version-control them. */
export interface SkillFolder {
  write(fileName: string, text: string): void;
  remove(fileName: string): void;
}

export interface SkillsServiceDeps {
  store: SkillsStore;
  newId(): string;
  now(): number;
  folder?: SkillFolder | null;
  /** A custom Skill was deleted: the setting that names it must fall back. */
  onRemoved?(id: string): void;
  /** Something changed (the lists need loading again). */
  onChanged?(): void;
}

export interface SkillsService {
  list(): Skill[];
  /** `id` null makes a new Skill; otherwise the custom Skill is edited into its next version. */
  save(id: string | null, draft: unknown): SkillResult;
  duplicate(id: string): SkillResult;
  remove(id: string): { ok: true } | { ok: false; message: string };
  versions(id: string): SkillVersion[];
  restore(id: string, version: number): SkillResult;
  /** The text of the Skill's `.md` file and a name for it. */
  exportFile(id: string): { fileName: string; text: string } | null;
  /** Makes a new custom Skill from the text of a `.md` file. */
  importFile(text: string): SkillImportResult;
  /** Imports several files; a bad one is named with its line and the rest still come in. */
  importFolder(files: readonly { name: string; text: string }[]): {
    imported: number;
    failed: string[];
  };
}

const BUILT_IN = "Built-in Skills cannot be changed. Duplicate one to make your own copy.";

export function createSkillsService(deps: SkillsServiceDeps): SkillsService {
  const { store } = deps;

  /** The name of a Skill's file in the folder: its name and the start of its id, so it is stable. */
  const fileNameOf = (skill: Skill): string =>
    skillFileName(skill.name).replace(/\.md$/, `-${skill.id.slice(0, 6)}.md`);
  const writeFile = (skill: Skill) => {
    try {
      deps.folder?.write(fileNameOf(skill), formatSkillFile(skill));
    } catch {
      // The file is a copy. The Skill is saved either way.
    }
  };
  const removeFile = (skill: Skill) => {
    try {
      deps.folder?.remove(fileNameOf(skill));
    } catch {
      // Nothing to remove, or it cannot be removed; the Skill is deleted either way.
    }
  };
  const changed = (before: Skill | null, after: Skill): Skill => {
    if (before && fileNameOf(before) !== fileNameOf(after)) removeFile(before);
    writeFile(after);
    deps.onChanged?.();
    return after;
  };
  const checked = (
    draft: unknown,
  ): { ok: true; draft: SkillDraft } | { ok: false; message: string } => {
    const parsed = skillDraftSchema.safeParse(draft);
    if (parsed.success) return { ok: true, draft: parsed.data };
    const issue = parsed.error.issues[0]!;
    const where = String(issue.path[0] ?? "Skill");
    return { ok: false, message: `The ${where} is not valid: ${issue.message}.` };
  };
  const custom = (id: string): Skill | null => {
    const skill = store.get(id);
    return skill && !skill.builtIn ? skill : null;
  };

  return {
    list: () => store.list(),

    save(id, input) {
      const result = checked(input);
      if (!result.ok) return result;
      if (id === null) {
        return {
          ok: true,
          skill: changed(null, store.create(deps.newId(), result.draft, deps.now())),
        };
      }
      if (store.get(id)?.builtIn) return { ok: false, message: BUILT_IN };
      const before = custom(id);
      if (!before) return { ok: false, message: "That Skill was not found." };
      const after = store.update(id, result.draft, deps.now());
      return after
        ? { ok: true, skill: changed(before, after) }
        : { ok: false, message: "That Skill was not found." };
    },

    duplicate(id) {
      const copy = store.duplicate(id, deps.newId(), deps.now());
      return copy
        ? { ok: true, skill: changed(null, copy) }
        : { ok: false, message: "That Skill was not found." };
    },

    remove(id) {
      if (store.get(id)?.builtIn) return { ok: false, message: BUILT_IN };
      const before = custom(id);
      if (!before) return { ok: false, message: "That Skill was not found." };
      removeFile(before);
      store.remove(id);
      deps.onRemoved?.(id);
      deps.onChanged?.();
      return { ok: true };
    },

    versions: (id) => (custom(id) ? store.versions(id) : []),

    restore(id, version) {
      const before = custom(id);
      if (!before) return { ok: false, message: "That Skill was not found." };
      const after = store.restore(id, version, deps.now());
      return after
        ? { ok: true, skill: changed(before, after) }
        : { ok: false, message: "That version was not found." };
    },

    exportFile(id) {
      const skill = store.get(id);
      if (!skill) return null;
      return {
        fileName: skillFileName(skill.name),
        text: formatSkillFile(skill),
      };
    },

    importFolder(files) {
      const failed: string[] = [];
      let imported = 0;
      for (const file of files) {
        const result = this.importFile(file.text);
        if (result.ok) imported++;
        else if ("message" in result) failed.push(`${file.name}: ${result.message}`);
      }
      return { imported, failed };
    },

    importFile(text) {
      const parsed = parseSkillFile(text);
      if (!parsed.ok)
        return { ok: false, message: `Line ${parsed.line}: ${parsed.message}`, line: parsed.line };
      const skill = store.create(deps.newId(), parsed.draft, deps.now());
      return { ok: true, skill: changed(null, skill) };
    },
  };
}
