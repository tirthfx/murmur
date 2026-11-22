-- Automations (NT-27): each time the owner confirms "Draft email", one row records what was made.
-- Only the draft's address in Gmail is kept (`result_ref`), never its text. Disconnecting the
-- account keeps the row (the account is set to null); deleting the row never deletes the draft.

-- migrate:up
CREATE TABLE automations (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('task_created', 'meeting_ended', 'manual')),
  action_kind  TEXT NOT NULL CHECK (action_kind IN ('draft_email', 'create_calendar_event')),
  account_id   TEXT REFERENCES connector_accounts (id) ON DELETE SET NULL,
  config_json  TEXT NOT NULL CHECK (json_valid(config_json)),
  result_ref   TEXT,
  open_url     TEXT,
  enabled      INTEGER NOT NULL DEFAULT 0,
  last_run_at  INTEGER,
  last_status  TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX automations_action_idx ON automations (action_kind, created_at);

-- migrate:down
DROP TABLE automations;
