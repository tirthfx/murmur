-- Experimental dictionary features (PZ-05, PZ-06). `kind` marks learned multi-word phrases;
-- `sample_path` is a pronunciation clip in the app data folder. phrase_counts holds phrases of
-- two to four words seen in final text, never sentences, for 14 days.

-- migrate:up
ALTER TABLE dictionary ADD COLUMN kind TEXT NOT NULL DEFAULT 'term' CHECK (kind IN ('term','phrase'));
ALTER TABLE dictionary ADD COLUMN sample_path TEXT;

CREATE TABLE phrase_counts (
  phrase   TEXT PRIMARY KEY,
  seen     INTEGER NOT NULL CHECK (seen >= 1),
  first_at INTEGER NOT NULL,
  last_at  INTEGER NOT NULL
);

-- migrate:down
DROP TABLE phrase_counts;
ALTER TABLE dictionary DROP COLUMN sample_path;
ALTER TABLE dictionary DROP COLUMN kind;
