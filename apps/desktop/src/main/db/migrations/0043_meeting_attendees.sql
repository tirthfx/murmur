-- Calendar-driven start (NT-02): a meeting started from a calendar event keeps who was invited,
-- so folder suggestions can use the people and the meeting page can show them. The event's own
-- id is in meetings.calendar_event_id (migration 0025).

-- migrate:up
ALTER TABLE meetings ADD COLUMN attendees_json TEXT NOT NULL DEFAULT '[]';

-- migrate:down
ALTER TABLE meetings DROP COLUMN attendees_json;
