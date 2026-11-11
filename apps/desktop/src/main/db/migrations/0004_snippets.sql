-- Snippets (PZ-08, PZ-09): a spoken trigger and the body it inserts. `body` is plain text, or
-- a JSON document (paragraphs and lists of styled runs) when body_format is 'rich_json'.
-- scope_team_id stays null until team snippets exist (M7).

-- migrate:up
CREATE TABLE snippets (
  id             TEXT PRIMARY KEY,
  trigger_phrase TEXT NOT NULL,
  body           TEXT NOT NULL,
  body_format    TEXT NOT NULL CHECK (body_format IN ('plain','rich_json')),
  scope_team_id  TEXT,
  use_count      INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  CHECK (body_format = 'plain' OR json_valid(body)),
  UNIQUE (trigger_phrase, scope_team_id)
);
CREATE INDEX snippets_trigger_idx ON snippets (trigger_phrase);

-- migrate:down
DROP TABLE snippets;
