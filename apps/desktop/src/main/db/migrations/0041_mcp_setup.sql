-- Local MCP server (CN-11, part 2): the apps the owner approved, and a log of what they called.
-- A client's token is a Keychain item; only its SHA-256 is kept here, to tell whose it is. The
-- log has the tool, a hash of the arguments and the size of the result: never the contents.

-- migrate:up
CREATE TABLE mcp_clients (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('claude-desktop', 'cursor', 'other')),
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE UNIQUE INDEX mcp_clients_name_idx ON mcp_clients (lower(name));

CREATE TABLE mcp_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           INTEGER NOT NULL,
  client       TEXT NOT NULL,
  tool         TEXT NOT NULL,
  args_hash    TEXT NOT NULL,
  result_bytes INTEGER NOT NULL,
  ok           INTEGER NOT NULL,
  write        INTEGER NOT NULL
);
CREATE INDEX mcp_audit_at_idx ON mcp_audit (at);

-- migrate:down
DROP TABLE mcp_audit;
DROP TABLE mcp_clients;
