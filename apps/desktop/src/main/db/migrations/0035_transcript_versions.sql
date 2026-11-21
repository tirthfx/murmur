-- Notetaker (NT-20, NT-23): a meeting's language and whether it is translated to English, and
-- the versions of its transcript. A rerun from the saved audio saves the transcript it replaces
-- (the lines and the corrections, as JSON) in `transcript_versions` for a number of days, and
-- the meeting's `transcript_version` goes up. New lines carry the version in their ids, so a
-- link to a line of an older transcript never opens a different line of the new one.
-- `rerun_pending` makes the transcription that follows a rerun write a new summary.

-- migrate:up
ALTER TABLE meetings ADD COLUMN translate INTEGER NOT NULL DEFAULT 0 CHECK (translate IN (0, 1));
ALTER TABLE meetings ADD COLUMN transcript_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE meetings ADD COLUMN rerun_pending INTEGER NOT NULL DEFAULT 0 CHECK (rerun_pending IN (0, 1));

CREATE TABLE transcript_versions (
  id               INTEGER PRIMARY KEY,
  meeting_id       TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  -- The `transcript_version` the saved lines had.
  version          INTEGER NOT NULL,
  language         TEXT,
  translate        INTEGER NOT NULL CHECK (translate IN (0, 1)),
  segments_json    TEXT NOT NULL CHECK (json_valid(segments_json)),
  corrections_json TEXT NOT NULL CHECK (json_valid(corrections_json)),
  line_count       INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  UNIQUE (meeting_id, version)
);

-- migrate:down
DROP TABLE transcript_versions;
ALTER TABLE meetings DROP COLUMN rerun_pending;
ALTER TABLE meetings DROP COLUMN transcript_version;
ALTER TABLE meetings DROP COLUMN translate;
