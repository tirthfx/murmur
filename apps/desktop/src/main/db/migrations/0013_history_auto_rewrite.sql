-- Auto-apply Rewrites (RW-05): which Rewrite ran on a dictation after cleanup, and how it went.
-- The texts themselves are in rewrite_runs.

-- migrate:up
ALTER TABLE history ADD COLUMN auto_rewrite_id TEXT;
ALTER TABLE history ADD COLUMN auto_rewrite_status TEXT
  CHECK (auto_rewrite_status IN ('applied','skipped_timeout','failed') OR auto_rewrite_status IS NULL);

-- migrate:down
ALTER TABLE history DROP COLUMN auto_rewrite_status;
ALTER TABLE history DROP COLUMN auto_rewrite_id;
