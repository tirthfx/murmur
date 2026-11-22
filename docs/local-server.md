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
- The owner adds more accounts with `POST /v1/users`, or an invite makes one (see Teams below).
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

## Teams, roles and invites (TM-02 to TM-05)

- **Teams.** Only the server owner makes one, and becomes its `owner`. A person can be in several
  teams. Leaving or being removed ends access on the next request; the account is untouched.
- **Roles** are `owner`, `admin`, `manager`, `member` and `viewer`, fixed. Who may do what is one
  file, `src/permissions.json`, read by the server on every request and by the tests and the
  admin console. The server owner counts as owner in every team.
- **Giving roles.** You can only give, change or remove a role below your own, never your own, and
  nobody hands out `owner`: it belongs to the person who made the team. An admin can make a
  viewer a member but cannot make an admin or touch one.
- **Departments** are labels with an optional cost center and one level of nesting. A member is in
  one department at a time; deleting a department leaves its members with none.
- **Invites.** An admin makes an invite with a role below theirs, an optional department, an
  expiry (default 7 days, up to 90) and a number of uses (default 1, up to 1000), and whether
  approval is required (default yes). The code (`inv_…`) is shown once, with a link; only its hash
  is stored and it is never listed or logged. The defaults come from the settings
  `team.invite.expiryDays`, `team.invite.maxUses` and `team.invite.approvalRequired`.
- **Redeeming** works signed in, or with a name, an email and a password, which makes the account
  and signs it in. A used, expired or withdrawn invite says so; someone already in the team, or
  with a request waiting, is told and no use is taken.
- **Requests.** With approval required the person waits as a pending request, visible to them at
  `GET /v1/me/join-requests`. An admin approves (they must outrank the role) or rejects; a
  rejection leaves no membership. A request nobody decides in 14 days expires.
- Every change is written to the audit log (`team.*`, `member.*`, `department.*`, `invite.*`,
  `join_request.*`).

| Route                                                              | Needs                                |
| ------------------------------------------------------------------ | ------------------------------------ |
| `GET /v1/teams`                                                    | signed in                            |
| `POST /v1/teams`                                                   | server owner                         |
| `GET`, `PATCH`, `DELETE /v1/teams/:teamId`                         | view, update (admin), delete (owner) |
| `GET /v1/teams/:teamId/members`                                    | any role                             |
| `PATCH`, `DELETE /v1/teams/:teamId/members/:userId`                | admin                                |
| `POST /v1/teams/:teamId/leave`                                     | signed in                            |
| `GET /v1/teams/:teamId/departments`                                | any role                             |
| `POST`, `PATCH`, `DELETE …/departments[/:id]`                      | admin                                |
| `GET`, `POST /v1/teams/:teamId/invites`, `DELETE …/:id`            | admin                                |
| `POST /v1/invites/redeem`                                          | anyone                               |
| `GET /v1/teams/:teamId/requests`, `POST …/:id/approve`, `…/reject` | admin                                |
| `GET /v1/me/join-requests`                                         | signed in                            |

The audit log routes are for the server owner only until the admin console (#247) decides what a
team admin may see of it.

## Shared dictionary and snippets (TM-06 to TM-08)

A team keeps one shared dictionary and one set of snippets. An entry has a **scope** (the whole
team, or one department), a version, who proposed it and who approved it. A person's own entries
stay on their machine and always win over these; the client merges them (#245).

- **Dictionary entry:** a term (up to 60 characters), an optional replacement (500) and an optional
  pronunciation hint (100). A term is unique in its place, ignoring capitals.
- **Snippet:** a trigger (2 to 60 characters) and an expansion (up to 20 KB), `plain` or `markdown`.
  Variables are `{{date}}`, `{{me}}` and `{{team}}` only, and only those the team allows; anything
  else (`{{shell}}`) is refused on save. Plain text only when the team turns rich text off. An admin
  can **lock** a snippet so members use it but cannot change or delete it (403 `locked`).
- **Governance mode** (a team setting, default `review`):
  - `open`: a member's new entry, change or deletion goes live at once, and shows in the history
    and the audit log;
  - `review`: it waits in the **review queue**. A reviewer approves it, rejects it (with a
    comment), or comments. Admins review everything; a Manager reviews what is shared with their
    own department. A reviewer's own entries are live at once;
  - `locked`: only admins change anything.
- **A change to a live entry** (edit or delete) waits too, one at a time, and the approved text is
  used until it is approved. The proposer can edit or withdraw an entry that was never approved.
- **Rejections** are told to the proposer at their next sign-in: `GET …/vocabulary/mine` returns
  `notices`, and `POST …/vocabulary/notices/seen` clears them.
- **History and rollback.** Every live version is kept (who, when, the text). An admin goes back to
  an earlier version, which becomes a new version and writes `vocabulary.rolled_back`; a deleted
  entry comes back the same way. Versions older than `rollbackRetentionDays` (180) are removed
  daily, except the newest.
- **CSV import** (admins): `term,replacement,scope`, where scope is empty or `company` for the
  whole team, or a department's name. The first call (`confirm` false) imports nothing and
  reports what would go in, every duplicate (in the file or already present) and every bad row. With
  `confirm: true` the new rows go in and the duplicates are skipped. Up to 1000 rows.
- **Conflicts** (admins): terms present in more than one scope, and snippet triggers that equal a
  dictionary term or replacement.
- **Sync.** `GET …/vocabulary/merged` returns the entries a person's dictation uses: the team's and
  their department's, with the department's winning for the same term, plus `{ me, team }` for the
  variables and the team's `syncMinutes` (5). Pass `?since=<revision>` to get only `{ unchanged }`
  when nothing changed.
- The audit log records each step (`vocabulary.proposed`, `.created`, `.approved`, `.rejected`,
  `.updated`, `.deleted`, `.rolled_back`, `.lock_changed`, `.imported`, `.settings_changed`) with the
  kind and scope, never a term, a trigger or a snippet's text.

Settings (`GET` and `PUT …/vocabulary/settings`; admins change them): `governanceMode`,
`rollbackRetentionDays`, `defaultScope`, `syncMinutes`, `allowRichText`, `allowVariables`.

| Route                                                                                     | Needs         |
| ----------------------------------------------------------------------------------------- | ------------- |
| `GET`, `POST /v1/teams/:teamId/dictionary` and `/snippets`                                | view, propose |
| `POST …/dictionary/import`                                                                | admin         |
| `PATCH`, `DELETE …/vocabulary/items/:itemId`                                              | propose       |
| `GET …/items/:itemId` (with comments and versions), `…/approve`, `…/reject`, `…/comments` | reviewer      |
| `POST …/items/:itemId/rollback`, `…/lock`                                                 | admin         |
| `GET …/vocabulary/merged`                                                                 | any role      |
| `GET …/vocabulary/pending`                                                                | reviewer      |
| `GET …/vocabulary/mine`, `POST …/vocabulary/notices/seen`                                 | propose       |
| `GET …/vocabulary/conflicts`                                                              | admin         |
| `GET`, `PUT …/vocabulary/settings`                                                        | view, admin   |

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
