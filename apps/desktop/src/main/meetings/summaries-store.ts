import type { DatabaseSync } from "node:sqlite";
import {
  BUILT_IN_SKILLS,
  type MeetingSummary,
  type Skill,
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

/** The built-in Skills and the owner's custom copies of them (NT-15). */
export interface SkillsStore {
  /** Built-ins first, in their order, then custom Skills by name. */
  list(): Skill[];
  get(id: string): Skill | null;
  /** A custom copy of a Skill ("Name (copy)"); null when there is no such Skill. */
  duplicate(id: string, newId: string, at: number): Skill | null;
}

interface SkillRow {
  id: string;
  name: string;
  description: string;
  sections_json: string;
  length: Skill["length"];
  prompt: string;
}

const toSkill = (row: SkillRow): Skill => ({
  id: row.id,
  name: row.name,
  description: row.description,
  sections: JSON.parse(row.sections_json) as string[],
  length: row.length,
  prompt: row.prompt,
  builtIn: false,
  version: 1,
});

export function createSkillsStore(db: DatabaseSync): SkillsStore {
  const custom = () =>
    (
      db
        .prepare(
          "SELECT id, name, description, sections_json, length, prompt FROM skills ORDER BY name",
        )
        .all() as unknown as SkillRow[]
    ).map(toSkill);
  const get = (id: string): Skill | null => {
    const built = BUILT_IN_SKILLS.find((skill) => skill.id === id);
    if (built) return built;
    const row = db
      .prepare(
        "SELECT id, name, description, sections_json, length, prompt FROM skills WHERE id = ?",
      )
      .get(id) as SkillRow | undefined;
    return row ? toSkill(row) : null;
  };
  return {
    list: () => [...BUILT_IN_SKILLS, ...custom()],
    get,
    duplicate(id, newId, at) {
      const source = get(id);
      if (!source) return null;
      const name = `${source.name} (copy)`.slice(0, 80);
      db.prepare(
        `INSERT INTO skills (id, name, description, sections_json, length, prompt, based_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId,
        name,
        source.description,
        JSON.stringify(source.sections),
        source.length,
        source.prompt,
        source.id,
        at,
        at,
      );
      return get(newId);
    },
  };
}
