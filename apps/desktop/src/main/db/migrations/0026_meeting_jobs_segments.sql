-- Notetaker (NT-05, NT-06): the work queue for recorded meetings, and their transcript.
-- Each audio chunk is marked once transcribed, so an interrupted job carries on where it was.

-- migrate:up
CREATE TABLE meeting_jobs (
  meeting_id   TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('transcribe', 'summarise', 'extract_tasks', 'build_index')),
  status       TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (meeting_id, kind)
);
CREATE INDEX meeting_jobs_status ON meeting_jobs (status, created_at);

CREATE TABLE meeting_segments (
  id           TEXT PRIMARY KEY,
  meeting_id   TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('mic', 'system')),
  start_ms     INTEGER NOT NULL,
  end_ms       INTEGER NOT NULL,
  text         TEXT NOT NULL,
  language     TEXT,
  speaker_id   TEXT,
  is_dictated  INTEGER NOT NULL DEFAULT 0 CHECK (is_dictated IN (0, 1)),
  is_final     INTEGER NOT NULL DEFAULT 1 CHECK (is_final IN (0, 1)),
  created_at   INTEGER NOT NULL
);
CREATE INDEX meeting_segments_time ON meeting_segments (meeting_id, start_ms);

ALTER TABLE meeting_audio_chunks ADD COLUMN transcribed_at INTEGER;

-- migrate:down
ALTER TABLE meeting_audio_chunks DROP COLUMN transcribed_at;
DROP TABLE meeting_segments;
DROP TABLE meeting_jobs;
