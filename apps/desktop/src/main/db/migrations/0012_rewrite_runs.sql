-- Rewrite runs (RW-01): what was rewritten and what happened to the result, for History and
-- the diff view. source_text is cut to its first 200 characters after 7 days.

-- migrate:up
CREATE TABLE rewrite_runs (
  id               TEXT PRIMARY KEY,
  rewrite_id       TEXT REFERENCES rewrites (id) ON DELETE SET NULL,
  rewrite_name     TEXT NOT NULL,
  source_text      TEXT NOT NULL,
  source_truncated INTEGER NOT NULL DEFAULT 0 CHECK (source_truncated IN (0, 1)),
  output_text      TEXT,
  outcome          TEXT NOT NULL CHECK (outcome IN ('replaced','copied','discarded','failed')),
  app_bundle_id    TEXT,
  created_at       INTEGER NOT NULL,
  duration_ms      INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0)
);
CREATE INDEX rewrite_runs_created_idx ON rewrite_runs (created_at);

-- migrate:down
DROP TABLE rewrite_runs;
