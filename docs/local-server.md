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

## What it refuses

- A `Host` that is not this machine, and a request with a different `Origin`: a web page cannot
  use the server on your behalf.
- A body that is not `application/json`, or larger than 64 KB.
- A listen address that is not `127.0.0.1` or `::1`. Reaching it from the LAN comes with the IP
  allowlist (TM-22).

## Tests

`npm test` runs `services/local-server/src/*.test.ts` against an in-memory database and a real
HTTP listener on a free port.
