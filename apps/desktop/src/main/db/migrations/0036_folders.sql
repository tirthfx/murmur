-- Notetaker (NT-17, NT-18): personal folders for meetings. The Inbox is not a row: a meeting
-- with no `folder_id` is in the Inbox, so deleting a folder (ON DELETE SET NULL) moves its
-- meetings to the Inbox and never deletes them. A folder can carry a default Skill for the
-- summaries of its meetings and a path where a shareable file is written after each meeting.
-- `folder_suggestion_dismissals` remembers a suggestion the owner dismissed, by the people (or
-- the title) of the meeting and the folder, so it is not offered again.

-- migrate:up
CREATE TABLE folders (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal')),
  default_skill_id TEXT,
  auto_export_path TEXT,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE UNIQUE INDEX folders_name_idx ON folders (lower(name));

ALTER TABLE meetings ADD COLUMN folder_id TEXT REFERENCES folders (id) ON DELETE SET NULL;
CREATE INDEX meetings_folder_idx ON meetings (folder_id);

CREATE TABLE folder_suggestion_dismissals (
  key        TEXT NOT NULL,
  folder_id  TEXT NOT NULL REFERENCES folders (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (key, folder_id)
);

-- migrate:down
DROP TABLE folder_suggestion_dismissals;
DROP INDEX meetings_folder_idx;
ALTER TABLE meetings DROP COLUMN folder_id;
DROP TABLE folders;
