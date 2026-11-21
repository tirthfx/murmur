-- Notetaker (NT-04): one row per meeting, and the audio chunk files the helper wrote for it.
-- Audio stays in files under the profile's meetings folder; rows keep the path and SHA-256.

-- migrate:up
CREATE TABLE meetings (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  -- 1 once the owner renamed it: a summary then never changes the title (NT-03).
  title_edited      INTEGER NOT NULL DEFAULT 0 CHECK (title_edited IN (0, 1)),
  started_at        INTEGER NOT NULL,
  ended_at          INTEGER,
  source            TEXT NOT NULL CHECK (source IN ('recorded', 'imported', 'ad_hoc', 'calendar')),
  status            TEXT NOT NULL CHECK (status IN ('recording', 'queued', 'processing', 'ready', 'failed')),
  channels          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(channels)),
  warnings          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(warnings)),
  duration_ms       INTEGER NOT NULL DEFAULT 0,
  folder            TEXT NOT NULL,
  language          TEXT,
  calendar_event_id TEXT,
  audio_deleted_at  INTEGER
);
CREATE INDEX meetings_started ON meetings (started_at DESC);
CREATE INDEX meetings_status ON meetings (status);

CREATE TABLE meeting_audio_chunks (
  meeting_id   TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('mic', 'system')),
  seq          INTEGER NOT NULL,
  path         TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  bytes        INTEGER NOT NULL,
  start_ms     INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  PRIMARY KEY (meeting_id, channel, seq)
);

-- migrate:down
DROP TABLE meeting_audio_chunks;
DROP TABLE meetings;
