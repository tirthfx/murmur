-- Recordings that have not reached the history table yet (DC-38). A row is written when a
-- recording starts and removed when its history row is written. Rows left after a crash
-- become failed history rows at the next launch, so the dictation can be retried.

-- migrate:up
CREATE TABLE pending_sessions (
  session_id  TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('hold','hands_free')),
  audio_path  TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0)
);

-- migrate:down
DROP TABLE pending_sessions;
