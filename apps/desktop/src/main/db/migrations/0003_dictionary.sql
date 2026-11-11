-- The personal Dictionary (PZ-01, PZ-03, PZ-04). A row with no replacement is a term to spell
-- exactly; a row with one maps a spoken or recognised form to the written form.
-- scope_team_id stays null until team dictionaries exist (M7); the teams table comes then.

-- migrate:up
CREATE TABLE dictionary (
  id             TEXT PRIMARY KEY,
  term           TEXT NOT NULL,
  replacement    TEXT,
  case_sensitive INTEGER NOT NULL DEFAULT 0 CHECK (case_sensitive IN (0, 1)),
  source         TEXT NOT NULL CHECK (source IN ('manual','auto','import')),
  starred        INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
  use_count      INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  scope_team_id  TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE (term, replacement, scope_team_id)
);
CREATE INDEX dictionary_term_idx ON dictionary (term);

-- migrate:down
DROP TABLE dictionary;
