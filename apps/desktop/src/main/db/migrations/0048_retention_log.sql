-- Notetaker (NT-22): what retention deleted, and when. The title is copied, so the entry still
-- reads after the meeting itself is gone; there is no link to the meeting row for that reason.

-- migrate:up
CREATE TABLE retention_log (
  id          INTEGER PRIMARY KEY,
  meeting_id  TEXT NOT NULL,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('audio', 'transcript')),
  at          INTEGER NOT NULL
);
CREATE INDEX retention_log_at_idx ON retention_log (at);

-- migrate:down
DROP TABLE retention_log;
