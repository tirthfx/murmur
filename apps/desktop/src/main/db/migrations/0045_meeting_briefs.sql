-- Meeting briefs (NT-11): the latest brief of each calendar event, kept on this Mac. A brief is
-- text and the list of what it cites; it is replaced when built again and dropped a couple of
-- days after the meeting.

-- migrate:up
CREATE TABLE meeting_briefs (
  event_key    TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  start_ms     INTEGER NOT NULL,
  built_at     INTEGER NOT NULL,
  markdown     TEXT NOT NULL,
  sources_json TEXT NOT NULL CHECK (json_valid(sources_json)),
  items_json   TEXT NOT NULL CHECK (json_valid(items_json)),
  model_wrote  INTEGER NOT NULL
);
CREATE INDEX meeting_briefs_start_idx ON meeting_briefs (start_ms);

-- migrate:down
DROP TABLE meeting_briefs;
