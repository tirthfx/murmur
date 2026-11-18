-- Rewrites inside Scratchpad notes (HB-32): which Rewrite ran on a note and what became of
-- the result. No text is kept here; the note and its versions hold it.

-- migrate:up
CREATE TABLE note_rewrites (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  rewrite_id  TEXT NOT NULL,
  scope       TEXT NOT NULL CHECK (scope IN ('selection', 'note')),
  outcome     TEXT NOT NULL CHECK (outcome IN ('replaced', 'copied', 'discarded')),
  created_at  INTEGER NOT NULL
);

CREATE INDEX note_rewrites_note_idx ON note_rewrites (note_id, created_at DESC);

-- migrate:down
DROP INDEX note_rewrites_note_idx;
DROP TABLE note_rewrites;
