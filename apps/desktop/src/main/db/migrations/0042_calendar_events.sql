-- Calendars (CN-02, CN-03): the events of the days around now for each connected account, kept
-- on this Mac so reminders and the menu bar work without the network. Each sync replaces the
-- window it covers; disconnecting an account deletes its events with it.

-- migrate:up
CREATE TABLE calendar_events (
  account_id     TEXT NOT NULL REFERENCES connector_accounts (id) ON DELETE CASCADE,
  event_id       TEXT NOT NULL,
  title          TEXT NOT NULL,
  start_ms       INTEGER NOT NULL,
  end_ms         INTEGER NOT NULL,
  all_day        INTEGER NOT NULL,
  location       TEXT,
  attendees_json TEXT NOT NULL,
  join_url       TEXT,
  response       TEXT NOT NULL CHECK (response IN ('accepted', 'declined', 'tentative', 'none')),
  is_private     INTEGER NOT NULL,
  PRIMARY KEY (account_id, event_id)
);
CREATE INDEX calendar_events_start_idx ON calendar_events (start_ms);

-- migrate:down
DROP TABLE calendar_events;
