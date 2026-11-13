-- Command Mode runs (RW-08 to RW-10): what was said, the command it matched, the text it acted
-- on and what came of it. The previous and new text are kept for undo (RW-10); source_text
-- and output_text are cut to their first 200 characters after 7 days.

-- migrate:up
CREATE TABLE command_runs (
  id             TEXT PRIMARY KEY,
  phrase         TEXT NOT NULL,
  command_id     TEXT,
  language       TEXT,
  trigger        TEXT NOT NULL CHECK (trigger IN ('key','wake_phrase')),
  matched_by     TEXT CHECK (matched_by IS NULL OR matched_by IN ('rule','model')),
  target         TEXT NOT NULL CHECK (target IN ('selection','last_dictation','none')),
  source_text    TEXT,
  output_text    TEXT,
  text_truncated INTEGER NOT NULL DEFAULT 0 CHECK (text_truncated IN (0, 1)),
  outcome        TEXT NOT NULL CHECK (outcome IN ('replaced','keys_sent','inserted','copied',
                   'discarded','not_understood','no_text','failed')),
  app_bundle_id  TEXT,
  created_at     INTEGER NOT NULL,
  duration_ms    INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0)
);
CREATE INDEX command_runs_created_idx ON command_runs (created_at);

-- migrate:down
DROP TABLE command_runs;
