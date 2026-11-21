-- Notetaker (NT-19, NT-13): the times a dictation was recording while a meeting was, on the
-- meeting's timeline, so lines of the microphone that overlap one are marked dictated; and the
-- "What did I miss" recaps of a meeting.

-- migrate:up
CREATE TABLE meeting_dictations (
  id         INTEGER PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  start_ms   INTEGER NOT NULL,
  -- Null while the dictation is still recording.
  end_ms     INTEGER
);
CREATE INDEX meeting_dictations_meeting_idx ON meeting_dictations (meeting_id);

CREATE TABLE recaps (
  id              TEXT PRIMARY KEY,
  meeting_id      TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  window_start_ms INTEGER NOT NULL,
  window_end_ms   INTEGER NOT NULL,
  markdown        TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX recaps_meeting_idx ON recaps (meeting_id, created_at);

-- migrate:down
DROP TABLE recaps;
DROP TABLE meeting_dictations;
