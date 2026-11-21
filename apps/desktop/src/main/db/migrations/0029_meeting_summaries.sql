-- Notetaker (NT-09, NT-15): the summaries written for a meeting, one row per version, and the
-- custom Skills (copies of built-in ones). Built-in Skills ship with the app and are not rows.

-- migrate:up
CREATE TABLE meeting_summaries (
  id              TEXT PRIMARY KEY,
  meeting_id      TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  skill_id        TEXT NOT NULL,
  skill_name      TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  quick           INTEGER NOT NULL DEFAULT 0 CHECK (quick IN (0, 1)),
  markdown        TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  feedback        TEXT CHECK (feedback IN ('up', 'down')),
  feedback_reason TEXT CHECK (feedback_reason IN ('missed_points', 'wrong_names', 'too_long', 'too_short')),
  UNIQUE (meeting_id, version)
);

CREATE TABLE skills (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  sections_json TEXT NOT NULL CHECK (json_valid(sections_json)),
  length        TEXT NOT NULL CHECK (length IN ('short', 'medium', 'long')),
  prompt        TEXT NOT NULL,
  based_on      TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- migrate:down
DROP TABLE skills;
DROP TABLE meeting_summaries;
