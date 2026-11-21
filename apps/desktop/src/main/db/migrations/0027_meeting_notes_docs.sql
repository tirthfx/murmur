-- Notetaker (NT-10): the owner's own notes for a meeting, and links and files attached to it.
-- Files are copied into the meeting's folder with a SHA-256; nothing is uploaded.

-- migrate:up
CREATE TABLE meeting_notes (
  meeting_id  TEXT PRIMARY KEY REFERENCES meetings (id) ON DELETE CASCADE,
  body_md     TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE meeting_docs (
  id          TEXT PRIMARY KEY,
  meeting_id  TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('link', 'file')),
  title       TEXT NOT NULL,
  url         TEXT,
  path        TEXT,
  sha256      TEXT,
  bytes       INTEGER,
  added_at    INTEGER NOT NULL
);
CREATE INDEX meeting_docs_meeting ON meeting_docs (meeting_id, added_at);

-- migrate:down
DROP TABLE meeting_docs;
DROP TABLE meeting_notes;
