-- Instruct Mode threads (RW-12, RW-14): one row per thread, and one `instruct_history` row per
-- request in it (the data model's table, with thread_id pointing at `instruct_threads`). After
-- 30 days a thread's text is removed and only its counts stay.

-- migrate:up
CREATE TABLE instruct_threads (
  id            TEXT PRIMARY KEY,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  app_bundle_id TEXT,
  title         TEXT NOT NULL DEFAULT '',
  final_draft   TEXT,
  turn_count    INTEGER NOT NULL DEFAULT 0 CHECK (turn_count >= 0),
  outcome       TEXT NOT NULL DEFAULT 'pending'
                  CHECK (outcome IN ('pending','inserted','copied','discarded')),
  text_removed  INTEGER NOT NULL DEFAULT 0 CHECK (text_removed IN (0, 1))
);
CREATE INDEX instruct_threads_updated_idx ON instruct_threads (updated_at);

CREATE TABLE instruct_history (
  id               TEXT PRIMARY KEY,
  thread_id        TEXT NOT NULL REFERENCES instruct_threads (id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL CHECK (seq >= 1),
  created_at       INTEGER NOT NULL,
  instruction_text TEXT NOT NULL,
  model_id         TEXT NOT NULL,
  draft_text       TEXT,
  action_taken     TEXT NOT NULL DEFAULT 'pending'
                     CHECK (action_taken IN ('pending','inserted','copied','discarded','undone')),
  undo_payload_json TEXT CHECK (undo_payload_json IS NULL OR json_valid(undo_payload_json)),
  app_bundle_id    TEXT,
  duration_ms      INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  UNIQUE (thread_id, seq)
);

-- migrate:down
DROP TABLE instruct_history;
DROP TABLE instruct_threads;
