-- Notetaker (NT-24): corrections to a transcript. Each change (a text edit, a new speaker for a
-- line, a split, a merge) keeps the lines as they were, as JSON rows, and the ids of the lines
-- it produced, so it can be taken back by deleting those and putting the old rows back.
-- `meeting_segments.edited` counts the changes a line has been through, for the mark in the
-- transcript; the old value comes back with the old row.

-- migrate:up
ALTER TABLE meeting_segments ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;

CREATE TABLE transcript_corrections (
  -- AUTOINCREMENT: an id is never used twice, so the Ask index can tell a changed transcript.
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id     TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('text', 'speaker', 'split', 'merge')),
  before_json    TEXT NOT NULL CHECK (json_valid(before_json)),
  after_ids_json TEXT NOT NULL CHECK (json_valid(after_ids_json)),
  created_at     INTEGER NOT NULL
);
CREATE INDEX transcript_corrections_meeting_idx ON transcript_corrections (meeting_id, id);

-- migrate:down
DROP TABLE transcript_corrections;
ALTER TABLE meeting_segments DROP COLUMN edited;
