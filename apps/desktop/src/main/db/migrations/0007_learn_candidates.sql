-- Learning from corrections (PZ-02): a correction seen once waits here until it is seen again.
-- Only the changed words are kept, never the field.

-- migrate:up
CREATE TABLE learn_candidates (
  spoken   TEXT NOT NULL,
  written  TEXT NOT NULL,
  seen     INTEGER NOT NULL CHECK (seen >= 1),
  first_at INTEGER NOT NULL,
  last_at  INTEGER NOT NULL,
  PRIMARY KEY (spoken, written)
);

-- migrate:down
DROP TABLE learn_candidates;
