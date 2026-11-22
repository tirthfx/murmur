# Local server

`services/local-server` is the backend for team features (M7). It runs on this Mac, answers on
`127.0.0.1` only, and keeps its own SQLite database. Nothing leaves the machine. There is no
payment, billing or cloud code in it.

## Running it

```bash
npm start --workspace @murmur/local-server
```

- Data: `~/.murmur-server/murmur-server.db` (set `MURMUR_SERVER_DIR` to move it). The folder is
  created with mode 700. The database is never committed.
- Port: 7830 (set `MURMUR_SERVER_PORT`).
- It uses only Node: `node:http`, `node:sqlite` and `node:crypto`. Node 22.18 or newer runs the
  TypeScript directly, so there is no build step and no web framework (ADR-0088).

## Accounts and sessions (TM-01)

- The first run makes the **owner**: `POST /v1/setup` works once, while there is no account.
- The owner adds more accounts with `POST /v1/users`. Teams, roles and who may do what come with
  the permission matrix (TM-04).
- Passwords are at least 12 characters, hashed with scrypt, and the last five cannot be used
  again. Changing a password ends every other session.
- Five wrong passwords in a row for an address (an unknown address counts too) make the next
  attempt wait 30 seconds, and a right password waits as well. A wrong password and an unknown
  address get the same answer.
- A session is an opaque token (`mst_…`). Only its SHA-256 is stored. It lasts 30 days.
- Password hashes and tokens are never in a response or in the log.

## API

All bodies are JSON. Send `Authorization: Bearer <token>` after signing in.

| Route                         | Who       | Does                              |
| ----------------------------- | --------- | --------------------------------- |
| `GET /v1/health`              | anyone    | `{ ok, version, setUp }`          |
| `POST /v1/setup`              | first run | makes the owner and signs them in |
| `POST /v1/sessions`           | anyone    | signs in (`email`, `password`)    |
| `DELETE /v1/sessions/current` | signed in | signs out                         |
| `GET /v1/me`                  | signed in | the account                       |
| `POST /v1/me/password`        | signed in | `currentPassword`, `newPassword`  |
| `GET /v1/users`               | owner     | the accounts                      |
| `POST /v1/users`              | owner     | adds an account                   |

Errors are `{ "error": { "code", "message" } }`. A delayed sign-in is 429 with
`retryAfterSeconds`.

## Audit log (TM-12)

Every sign-in, failed sign-in (the first miss and each lock, not every miss), new account, password
change, setup, export and audit setting change is written to `audit_events`. Later issues add
invites, roles, policy and the rest through `audit.record`.

- **Append-only and hash-chained.** Each row stores the SHA-256 of the one before it, taken over
  the row's canonical JSON (keys in sorted order). Changing, deleting or inserting a row breaks the
  chain from that row on.
- **Verify:** `npm run audit:verify --workspace @murmur/local-server` walks the chain from the
  start, prints the number of entries, or the first entry that does not match and exits with 1.
  `POST /v1/audit/verify` does the same.
- **No content, ever.** An entry's detail is a flat object of strings (200 characters at most),
  numbers, booleans or null. A field whose name suggests content, audio or a secret (`transcript`,
  `text`, `content`, `note`, `password`, `token`, `hash`, `key` and the like) is refused, so a
  mistake in a caller fails in its test. Passwords, hashes and tokens are never written.
- **Filters:** `actor`, `action` (`auth.` for all of an area, or the whole name), `target` (an id
  or a type), `from` and `to` (milliseconds), `limit` and `before` for paging.
  `GET /v1/audit/export` gives the same filter as JSON lines, and the export is itself an entry.
- **Retention:** `team.audit.retentionDays` (365; 30 to 3650). Once a day the server removes older
  entries, keeps the newest, and writes `audit.retention_pruned` with the count. What is left still
  verifies, from an anchor row that remembers where the chain was cut.

### SIEM streaming (a simulation)

Real only for a receiver you run. Set `siemMode` to `file` (a JSON line is appended to
`audit.jsonl` next to the database, mode 600) or `webhook` (a POST to `siemWebhookUrl`, which
must be on this machine or a private network: `localhost`, `127.x`, `10.x`, `172.16-31.x`,
`192.168.x`, `*.local`; no redirects). Each new entry is queued and sent; a failed send is tried
three times with a wait of 1 and 5 seconds between, then stays in the queue as **failed** with the
last error, shown by `GET /v1/audit/settings`. `POST /v1/audit/siem/retry` puts failed entries back.
Nothing is queued while the mode is off.

| Route                       | Does                                           |
| --------------------------- | ---------------------------------------------- |
| `GET /v1/audit`             | the entries, newest first, with `next`         |
| `GET /v1/audit/export`      | JSON lines                                     |
| `POST /v1/audit/verify`     | `{ ok, count, brokenSeq?, reason? }`           |
| `GET /v1/audit/settings`    | retention and the SIEM state with its failures |
| `PUT /v1/audit/settings`    | `retentionDays`, `siemMode`, `siemWebhookUrl`  |
| `POST /v1/audit/siem/retry` | sends the failed entries again                 |

Until the permission matrix (TM-04) these are for the owner only.

## What it refuses

- A `Host` that is not this machine, and a request with a different `Origin`: a web page cannot
  use the server on your behalf.
- A body that is not `application/json`, or larger than 64 KB.
- A listen address that is not `127.0.0.1` or `::1`. Reaching it from the LAN comes with the IP
  allowlist (TM-22).

## Tests

`npm test` runs `services/local-server/src/*.test.ts` against an in-memory database and a real
HTTP listener on a free port.
