import type { DatabaseSync } from "node:sqlite";
import {
  BUILT_IN_SKILLS,
  type MeetingSummary,
  type Skill,
  type SkillDraft,
  type SkillVersion,
  type SummaryFeedback,
  type SummaryFeedbackReason,
} from "@murmur/shared";

/** A meeting's summaries, one per version (NT-09). */
export interface SummariesStore {
  /**
   * Adds a summary as the next version. A final summary (not quick) replaces the quick ones
   * of the meeting; older final versions stay.
   */
  add(input: {
    id: string;
    meetingId: string;
    skill: Pick<Skill, "id" | "name">;
    modelId: string;
    quick: boolean;
    markdown: string;
    at: number;
  }): MeetingSummary;
  /** Oldest version first. */
  list(meetingId: string): MeetingSummary[];
  setFeedback(id: string, feedback: SummaryFeedback | null): boolean;
}

interface Row {
  id: string;
  meeting_id: string;
  version: number;
  skill_id: string;
  skill_name: string;
  model_id: string;
  quick: number;
  markdown: string;
  created_at: number;
  feedback: "up" | "down" | null;
  feedback_reason: SummaryFeedbackReason | null;
}

const COLUMNS =
  "id, meeting_id, version, skill_id, skill_name, model_id, quick, markdown, created_at, feedback, feedback_reason";

function toSummary(row: Row): MeetingSummary {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    version: row.version,
    skillId: row.skill_id,
    skillName: row.skill_name,
    modelId: row.model_id,
    quick: row.quick === 1,
    markdown: row.markdown,
    createdAt: row.created_at,
    feedback: row.feedback ? { rating: row.feedback, reason: row.feedback_reason } : null,
  };
}

export function createSummariesStore(db: DatabaseSync): SummariesStore {
  return {
    add(input) {
      db.exec("BEGIN IMMEDIATE");
      try {
        if (!input.quick) {
          db.prepare("DELETE FROM meeting_summaries WHERE meeting_id = ? AND quick = 1").run(
            input.meetingId,
          );
        }
        const top = db
          .prepare(
            "SELECT COALESCE(MAX(version), 0) AS v FROM meeting_summaries WHERE meeting_id = ?",
          )
          .get(input.meetingId) as { v: number };
        db.prepare(
          `INSERT INTO meeting_summaries
             (id, meeting_id, version, skill_id, skill_name, model_id, quick, markdown, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          input.id,
          input.meetingId,
          top.v + 1,
          input.skill.id,
          input.skill.name,
          input.modelId,
          input.quick ? 1 : 0,
          input.markdown,
          input.at,
        );
        db.exec("COMMIT");
        return {
          id: input.id,
          meetingId: input.meetingId,
          version: top.v + 1,
          skillId: input.skill.id,
          skillName: input.skill.name,
          modelId: input.modelId,
          quick: input.quick,
          markdown: input.markdown,
          createdAt: input.at,
          feedback: null,
        };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    list(meetingId) {
      return (
        db
          .prepare(`SELECT ${COLUMNS} FROM meeting_summaries WHERE meeting_id = ? ORDER BY version`)
          .all(meetingId) as unknown as Row[]
      ).map(toSummary);
    },
    setFeedback(id, feedback) {
      return (
        Number(
          db
            .prepare("UPDATE meeting_summaries SET feedback = ?, feedback_reason = ? WHERE id = ?")
            .run(
              feedback?.rating ?? null,
              feedback?.rating === "down" ? (feedback.reason ?? null) : null,
              id,
            ).changes,
        ) > 0
      );
    },
  };
}

// -------------------------------------------------------------------- skills

/** The built-in Skills and the owner's custom Skills (NT-15, NT-16). */
export interface SkillsStore {
  /** Built-ins first, in their order, then custom Skills by name. */
  list(): Skill[];
  get(id: string): Skill | null;
  /** A new custom Skill. */
  create(id: string, draft: SkillDraft, at: number): Skill;
  /** A custom copy of a Skill ("Name (copy)"); null when there is no such Skill. */
  duplicate(id: string, newId: string, at: number): Skill | null;
  /**
   * Edits a custom Skill into its next version and keeps the one it had. Null when there is
   * no such custom Skill. Saving what is already there changes nothing.
   */
  update(id: string, draft: SkillDraft, at: number): Skill | null;
  /** The versions a custom Skill had before the current one, newest first. */
  versions(id: string): SkillVersion[];
  /** Makes an earlier version the current content, as a new version. */
  restore(id: string, version: number, at: number): Skill | null;
  /** Deletes a custom Skill and its versions. False when there is no such custom Skill. */
  remove(id: string): boolean;
}

interface SkillRow {
  id: string;
  name: string;
  description: string;
  sections_json: string;
  length: Skill["length"];
  prompt: string;
  model: Skill["model"];
  version: number;
  based_on: string | null;
  based_on_version: number | null;
}

const SKILL_COLUMNS =
  "id, name, description, sections_json, length, prompt, model, version, based_on, based_on_version";

const toSkill = (row: SkillRow): Skill => ({
  id: row.id,
  name: row.name,
  description: row.description,
  sections: JSON.parse(row.sections_json) as string[],
  length: row.length,
  prompt: row.prompt,
  model: row.model,
  builtIn: false,
  version: row.version,
  basedOn: row.based_on,
  basedOnVersion: row.based_on_version,
});

const sameDraft = (a: SkillDraft, b: SkillDraft) =>
  a.name === b.name &&
  a.description === b.description &&
  a.length === b.length &&
  a.prompt === b.prompt &&
  a.model === b.model &&
  a.sections.length === b.sections.length &&
  a.sections.every((section, i) => section === b.sections[i]);

export function createSkillsStore(db: DatabaseSync): SkillsStore {
  const custom = () =>
    (
      db.prepare(`SELECT ${SKILL_COLUMNS} FROM skills ORDER BY name`).all() as unknown as SkillRow[]
    ).map(toSkill);
  const get = (id: string): Skill | null => {
    const built = BUILT_IN_SKILLS.find((skill) => skill.id === id);
    if (built) return built;
    const row = db.prepare(`SELECT ${SKILL_COLUMNS} FROM skills WHERE id = ?`).get(id) as
      SkillRow | undefined;
    return row ? toSkill(row) : null;
  };
  const insert = (
    id: string,
    draft: SkillDraft,
    basedOn: { id: string; version: number } | null,
    at: number,
  ) =>
    db
      .prepare(
        `INSERT INTO skills (id, name, description, sections_json, length, prompt, model, based_on, based_on_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        draft.name,
        draft.description,
        JSON.stringify(draft.sections),
        draft.length,
        draft.prompt,
        draft.model,
        basedOn?.id ?? null,
        basedOn?.version ?? null,
        at,
        at,
      );
  const update = (id: string, draft: SkillDraft, at: number): Skill | null => {
    const current = db.prepare(`SELECT ${SKILL_COLUMNS} FROM skills WHERE id = ?`).get(id) as
      SkillRow | undefined;
    if (!current) return null;
    const before = toSkill(current);
    if (sameDraft(before, draft)) return before;
    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT INTO skill_versions (skill_id, version, name, description, sections_json, length, prompt, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        before.version,
        before.name,
        before.description,
        current.sections_json,
        before.length,
        before.prompt,
        before.model,
        at,
      );
      db.prepare(
        `UPDATE skills SET name = ?, description = ?, sections_json = ?, length = ?, prompt = ?,
           model = ?, version = version + 1, updated_at = ? WHERE id = ?`,
      ).run(
        draft.name,
        draft.description,
        JSON.stringify(draft.sections),
        draft.length,
        draft.prompt,
        draft.model,
        at,
        id,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return get(id);
  };
  return {
    list: () => [...BUILT_IN_SKILLS, ...custom()],
    get,
    create(id, draft, at) {
      insert(id, draft, null, at);
      return get(id)!;
    },
    duplicate(id, newId, at) {
      const source = get(id);
      if (!source) return null;
      const draft: SkillDraft = {
        name: `${source.name} (copy)`.slice(0, 80),
        description: source.description,
        sections: source.sections,
        length: source.length,
        prompt: source.prompt,
        model: source.model,
      };
      // A copy of a built-in remembers its version; a copy of a copy stays tied to the built-in.
      const basedOn = source.builtIn
        ? { id: source.id, version: source.version }
        : source.basedOn !== null && source.basedOnVersion !== null
          ? { id: source.basedOn, version: source.basedOnVersion }
          : null;
      insert(newId, draft, basedOn, at);
      return get(newId);
    },
    update,
    versions(id) {
      return (
        db
          .prepare(
            `SELECT skill_id, version, name, description, sections_json, length, prompt, model, created_at
             FROM skill_versions WHERE skill_id = ? ORDER BY version DESC`,
          )
          .all(id) as unknown as {
          skill_id: string;
          version: number;
          name: string;
          description: string;
          sections_json: string;
          length: Skill["length"];
          prompt: string;
          model: Skill["model"];
          created_at: number;
        }[]
      ).map((row) => ({
        skillId: row.skill_id,
        version: row.version,
        name: row.name,
        description: row.description,
        sections: JSON.parse(row.sections_json) as string[],
        length: row.length,
        prompt: row.prompt,
        model: row.model,
        createdAt: row.created_at,
      }));
    },
    restore(id, version, at) {
      const row = db
        .prepare(
          `SELECT name, description, sections_json, length, prompt, model FROM skill_versions
           WHERE skill_id = ? AND version = ?`,
        )
        .get(id, version) as
        | Pick<SkillRow, "name" | "description" | "sections_json" | "length" | "prompt" | "model">
        | undefined;
      if (!row) return null;
      return update(
        id,
        {
          name: row.name,
          description: row.description,
          sections: JSON.parse(row.sections_json) as string[],
          length: row.length,
          prompt: row.prompt,
          model: row.model,
        },
        at,
      );
    },
    remove(id) {
      return db.prepare("DELETE FROM skills WHERE id = ?").run(id).changes > 0;
    },
  };
}
