-- Notetaker (NT-16): custom Skills are edited into new versions. The version a Skill had before
-- an edit is kept in `skill_versions`, so an edit can be undone. A copy of a built-in Skill
-- remembers which version of the built-in it was made from, for the "New version" badge.

-- migrate:up
ALTER TABLE skills ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE skills ADD COLUMN based_on_version INTEGER;

CREATE TABLE skill_versions (
  skill_id      TEXT NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  sections_json TEXT NOT NULL CHECK (json_valid(sections_json)),
  length        TEXT NOT NULL CHECK (length IN ('short', 'medium', 'long')),
  prompt        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (skill_id, version)
);

-- migrate:down
DROP TABLE skill_versions;
ALTER TABLE skills DROP COLUMN based_on_version;
ALTER TABLE skills DROP COLUMN version;
