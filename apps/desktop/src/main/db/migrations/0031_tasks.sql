-- Notetaker (NT-26): tasks suggested from meetings and added by hand. A task from a meeting
-- starts `suggested` and is never accepted by itself. `source_segment_id` is not a foreign
-- key: retention can remove the segment, and the task then says "Source removed".

-- migrate:up
CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  notes             TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL CHECK (status IN ('suggested', 'open', 'done', 'archived')),
  source            TEXT NOT NULL CHECK (source IN ('meeting', 'manual')),
  meeting_id        TEXT REFERENCES meetings (id) ON DELETE SET NULL,
  owner_name        TEXT,
  owner_is_me       INTEGER NOT NULL DEFAULT 0 CHECK (owner_is_me IN (0, 1)),
  due_on            TEXT,
  source_segment_id TEXT,
  position          REAL NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  completed_at      INTEGER
);

CREATE INDEX tasks_status_position_idx ON tasks (status, position);
CREATE INDEX tasks_meeting_idx ON tasks (meeting_id);

-- A meeting that is deleted takes the tasks nobody accepted with it.
CREATE TRIGGER tasks_drop_suggested_with_meeting
BEFORE DELETE ON meetings
BEGIN
  DELETE FROM tasks WHERE meeting_id = OLD.id AND status = 'suggested';
END;

-- migrate:down
DROP TRIGGER tasks_drop_suggested_with_meeting;
DROP TABLE tasks;
