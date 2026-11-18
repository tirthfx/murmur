-- Scratchpad note versions (HB-28): snapshots of a note's title and body. At most 50 per
-- note; the oldest goes when the 51st is saved. Deleted with their note.

-- migrate:up
CREATE TABLE note_versions (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  body_json   TEXT NOT NULL CHECK (json_valid(body_json)),
  body_plain  TEXT NOT NULL DEFAULT '',
  label       TEXT,
  words       INTEGER NOT NULL DEFAULT 0 CHECK (words >= 0),
  created_at  INTEGER NOT NULL
);

CREATE INDEX note_versions_note_idx ON note_versions (note_id, created_at DESC);

-- migrate:down
DROP INDEX note_versions_note_idx;
DROP TABLE note_versions;
