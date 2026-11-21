-- Connectors (CN-01): the accounts the owner signed in with and what was fetched for them.
-- Tokens are never here: they are in the Keychain, reached through the helper.

-- migrate:up
CREATE TABLE connector_accounts (
  id            TEXT PRIMARY KEY,
  -- The provider's id, for example googleCalendar.
  connector     TEXT NOT NULL,
  email         TEXT NOT NULL,
  -- A JSON array of the scopes that were granted.
  scopes        TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('connected', 'needs_attention', 'disabled')),
  status_reason TEXT,
  last_sync_at  INTEGER,
  created_at    INTEGER NOT NULL,
  UNIQUE (connector, email)
);

CREATE TABLE connector_cache (
  account_id TEXT NOT NULL REFERENCES connector_accounts (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  key        TEXT NOT NULL,
  json       TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  -- How long it may be used after it was fetched, in milliseconds.
  ttl_ms     INTEGER NOT NULL,
  PRIMARY KEY (account_id, kind, key)
);

-- migrate:down
DROP TABLE connector_cache;
DROP TABLE connector_accounts;
