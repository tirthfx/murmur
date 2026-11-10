-- migrate:up
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at  INTEGER NOT NULL
);

CREATE TABLE history (
  id               TEXT PRIMARY KEY,
  created_at       INTEGER NOT NULL,
  session_id       TEXT,
  source           TEXT NOT NULL CHECK (source IN ('hold','hands_free','retry','command','rewrite_voice')),
  app_bundle_id    TEXT,
  app_name         TEXT,
  language         TEXT,
  duration_ms      INTEGER NOT NULL CHECK (duration_ms >= 0),
  raw_text         TEXT,
  final_text       TEXT,
  word_count       INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  cleanup_level    TEXT CHECK (cleanup_level IN ('off','light','standard','full') OR cleanup_level IS NULL),
  cleanup_status   TEXT NOT NULL CHECK (cleanup_status IN ('applied','skipped_disabled','skipped_timeout','failed','not_run')),
  cleanup_fallback TEXT CHECK (cleanup_fallback IN ('model_missing','timeout','rejected','error') OR cleanup_fallback IS NULL),
  insert_status    TEXT NOT NULL CHECK (insert_status IN ('inserted','clipboard_only','failed','empty')),
  insert_method    TEXT CHECK (insert_method IN ('paste_cmd_v','paste_shift_insert','keystrokes','clipboard') OR insert_method IS NULL),
  error_code       TEXT,
  press_enter      INTEGER NOT NULL DEFAULT 0 CHECK (press_enter IN (0, 1)),
  style_id         TEXT,
  audio_path       TEXT,
  audio_expires_at INTEGER,
  retry_of         TEXT REFERENCES history(id) ON DELETE SET NULL,
  feedback         TEXT CHECK (feedback IN ('good','bad') OR feedback IS NULL)
);

CREATE INDEX history_created_idx ON history (created_at DESC);
CREATE INDEX history_app_idx ON history (app_bundle_id, created_at DESC);
CREATE INDEX history_retry_idx ON history (retry_of);
CREATE INDEX history_expiry_idx ON history (audio_expires_at) WHERE audio_path IS NOT NULL;

CREATE TABLE audio_chunks (
  id          TEXT PRIMARY KEY,
  history_id  TEXT NOT NULL REFERENCES history(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL CHECK (seq >= 0),
  path        TEXT NOT NULL,
  codec       TEXT NOT NULL CHECK (codec IN ('pcm_s16le','opus')),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  gain_db     REAL,
  expires_at  INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE (history_id, seq)
);

CREATE INDEX audio_chunks_expiry_idx ON audio_chunks (expires_at);

-- migrate:down
DROP TABLE audio_chunks;
DROP TABLE history;
DROP TABLE settings;
