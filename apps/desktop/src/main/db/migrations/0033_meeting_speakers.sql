-- Notetaker (NT-07, NT-08): the names of a meeting's speakers. Every segment belongs to a
-- speaker: the one in `meeting_segments.speaker_id`, or, when that is null, the meeting's own
-- speaker for the segment's channel (`<meeting>:mic` or `<meeting>:system`), which is "You" or
-- "Remote" until it is renamed. A row exists only once a speaker has been renamed, so a rename
-- during a recording also names the lines transcribed after it.

-- migrate:up
CREATE TABLE meeting_speakers (
  id         TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  channel    TEXT NOT NULL CHECK (channel IN ('mic', 'system')),
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX meeting_speakers_meeting_idx ON meeting_speakers (meeting_id);

-- migrate:down
DROP TABLE meeting_speakers;
