-- Retention (HB-50): the last run of each daily job and what it removed, as JSON counts.

-- migrate:up
CREATE TABLE retention_jobs (
  name         TEXT PRIMARY KEY,
  last_run_at  INTEGER NOT NULL,
  last_result  TEXT NOT NULL CHECK (json_valid(last_result))
);

-- migrate:down
DROP TABLE retention_jobs;
