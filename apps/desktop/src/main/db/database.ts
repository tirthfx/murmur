import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import m0001 from "./migrations/0001_core_settings_dictation.sql?raw";
import m0002 from "./migrations/0002_pending_sessions.sql?raw";
import m0003 from "./migrations/0003_dictionary.sql?raw";
import m0004 from "./migrations/0004_snippets.sql?raw";
import m0005 from "./migrations/0005_styles.sql?raw";
import m0006 from "./migrations/0006_memory.sql?raw";
import m0007 from "./migrations/0007_learn_candidates.sql?raw";
import m0008 from "./migrations/0008_voice_profile.sql?raw";
import m0009 from "./migrations/0009_writing_samples.sql?raw";
import m0010 from "./migrations/0010_phrases_and_clips.sql?raw";
import m0011 from "./migrations/0011_rewrites.sql?raw";
import m0012 from "./migrations/0012_rewrite_runs.sql?raw";
import m0013 from "./migrations/0013_history_auto_rewrite.sql?raw";
import m0014 from "./migrations/0014_command_runs.sql?raw";
import m0015 from "./migrations/0015_instruct_threads.sql?raw";
import m0016 from "./migrations/0016_focus.sql?raw";
import m0017 from "./migrations/0017_history_search.sql?raw";
import m0018 from "./migrations/0018_insights_daily.sql?raw";
import m0019 from "./migrations/0019_milestones.sql?raw";
import m0020 from "./migrations/0020_notes.sql?raw";
import m0021 from "./migrations/0021_note_versions.sql?raw";
import m0022 from "./migrations/0022_note_images.sql?raw";
import m0023 from "./migrations/0023_note_rewrites.sql?raw";
import m0024 from "./migrations/0024_retention_jobs.sql?raw";
import m0025 from "./migrations/0025_meetings.sql?raw";
import m0026 from "./migrations/0026_meeting_jobs_segments.sql?raw";
import m0027 from "./migrations/0027_meeting_notes_docs.sql?raw";
import m0028 from "./migrations/0028_meeting_consent.sql?raw";
import m0029 from "./migrations/0029_meeting_summaries.sql?raw";
import m0030 from "./migrations/0030_skill_versions.sql?raw";
import m0031 from "./migrations/0031_tasks.sql?raw";
import m0032 from "./migrations/0032_ask.sql?raw";
import m0033 from "./migrations/0033_meeting_speakers.sql?raw";
import m0034 from "./migrations/0034_transcript_corrections.sql?raw";
import m0035 from "./migrations/0035_transcript_versions.sql?raw";
import m0036 from "./migrations/0036_folders.sql?raw";
import m0037 from "./migrations/0037_meeting_retention.sql?raw";
import m0038 from "./migrations/0038_meeting_import.sql?raw";
import m0039 from "./migrations/0039_dictation_recaps.sql?raw";
import m0040 from "./migrations/0040_connectors.sql?raw";
import m0041 from "./migrations/0041_mcp_setup.sql?raw";
import m0042 from "./migrations/0042_calendar_events.sql?raw";
import m0043 from "./migrations/0043_meeting_attendees.sql?raw";
import m0044 from "./migrations/0044_automations.sql?raw";
import m0045 from "./migrations/0045_meeting_briefs.sql?raw";
import { migrateUp, parseMigration, type Migration } from "./migrate";

/** Every migration, in the order the files are numbered. */
export const MIGRATIONS: Migration[] = [
  parseMigration("0001_core_settings_dictation.sql", m0001),
  parseMigration("0002_pending_sessions.sql", m0002),
  parseMigration("0003_dictionary.sql", m0003),
  parseMigration("0004_snippets.sql", m0004),
  parseMigration("0005_styles.sql", m0005),
  parseMigration("0006_memory.sql", m0006),
  parseMigration("0007_learn_candidates.sql", m0007),
  parseMigration("0008_voice_profile.sql", m0008),
  parseMigration("0009_writing_samples.sql", m0009),
  parseMigration("0010_phrases_and_clips.sql", m0010),
  parseMigration("0011_rewrites.sql", m0011),
  parseMigration("0012_rewrite_runs.sql", m0012),
  parseMigration("0013_history_auto_rewrite.sql", m0013),
  parseMigration("0014_command_runs.sql", m0014),
  parseMigration("0015_instruct_threads.sql", m0015),
  parseMigration("0016_focus.sql", m0016),
  parseMigration("0017_history_search.sql", m0017),
  parseMigration("0018_insights_daily.sql", m0018),
  parseMigration("0019_milestones.sql", m0019),
  parseMigration("0020_notes.sql", m0020),
  parseMigration("0021_note_versions.sql", m0021),
  parseMigration("0022_note_images.sql", m0022),
  parseMigration("0023_note_rewrites.sql", m0023),
  parseMigration("0024_retention_jobs.sql", m0024),
  parseMigration("0025_meetings.sql", m0025),
  parseMigration("0026_meeting_jobs_segments.sql", m0026),
  parseMigration("0027_meeting_notes_docs.sql", m0027),
  parseMigration("0028_meeting_consent.sql", m0028),
  parseMigration("0029_meeting_summaries.sql", m0029),
  parseMigration("0030_skill_versions.sql", m0030),
  parseMigration("0031_tasks.sql", m0031),
  parseMigration("0032_ask.sql", m0032),
  parseMigration("0033_meeting_speakers.sql", m0033),
  parseMigration("0034_transcript_corrections.sql", m0034),
  parseMigration("0035_transcript_versions.sql", m0035),
  parseMigration("0036_folders.sql", m0036),
  parseMigration("0037_meeting_retention.sql", m0037),
  parseMigration("0038_meeting_import.sql", m0038),
  parseMigration("0039_dictation_recaps.sql", m0039),
  parseMigration("0040_connectors.sql", m0040),
  parseMigration("0041_mcp_setup.sql", m0041),
  parseMigration("0042_calendar_events.sql", m0042),
  parseMigration("0043_meeting_attendees.sql", m0043),
  parseMigration("0044_automations.sql", m0044),
  parseMigration("0045_meeting_briefs.sql", m0045),
];

/** `<appData>/Murmur/murmur.db`, shared by the dev build and the packaged app. */
export function databasePath(appData: string): string {
  return path.join(appData, "Murmur", "murmur.db");
}

/**
 * Opens the database with the house pragmas and brings the schema up to date. Uses Node's
 * built-in SQLite, so there is no native module to rebuild for Electron.
 */
export function openDatabase(file: string, migrations: Migration[] = MIGRATIONS): DatabaseSync {
  // A first run has no data folder yet.
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  migrateUp(db, migrations);
  return db;
}
