-- Focus Mode (RW-18 to RW-21). focus_rules: what is blocked while Focus is on (apps by bundle
-- id; sites come with RW-20). focus_sessions: each stretch of Focus and why it ended. Nothing
-- about what was in front, and no addresses, is stored.

-- migrate:up
CREATE TABLE focus_rules (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('app','site')),
  value      TEXT NOT NULL,
  label      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (kind, value)
);

CREATE TABLE focus_sessions (
  id          TEXT PRIMARY KEY,
  started_at  INTEGER NOT NULL,
  planned_ms  INTEGER CHECK (planned_ms IS NULL OR planned_ms > 0),
  ended_at    INTEGER,
  end_reason  TEXT CHECK (end_reason IS NULL OR end_reason IN ('timer','user','quit','paused')),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
CREATE INDEX focus_sessions_started_idx ON focus_sessions (started_at);

-- migrate:down
DROP TABLE focus_sessions;
DROP TABLE focus_rules;
