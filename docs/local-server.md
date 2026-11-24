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

| Route                         | Who       | Does                                                           |
| ----------------------------- | --------- | -------------------------------------------------------------- |
| `GET /v1/health`              | anyone    | `{ ok, version, setUp }`                                       |
| `POST /v1/setup`              | first run | makes the owner and signs them in                              |
| `POST /v1/sessions`           | anyone    | signs in (`email`, `password`)                                 |
| `DELETE /v1/sessions/current` | signed in | signs out                                                      |
| `GET /v1/me`                  | signed in | the account                                                    |
| `POST /v1/me/password`        | signed in | `currentPassword`, `newPassword`                               |
| `GET /v1/users`               | owner     | the accounts                                                   |
| `POST /v1/users`              | owner     | adds an account                                                |
| `POST /v1/admin/session`      | anyone    | signs in to the admin console (cookie, no token in the answer) |
| `DELETE /v1/admin/session`    | signed in | ends it and clears the cookie                                  |

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

## Policy (TM-13 to TM-16)

An admin sets policy for the whole team, for one department or for one member. A person's app
downloads the **effective** policy, the three merged, and enforces it (the app side is #255). The
rules live in `packages/shared/src/policy.ts`, which imports only `zod` so the server and the app
run the same code.

- **Settings** (one row each, set by an admin):
  - `blockedApps` (bundle ids, or an absolute path for an app with none; up to 200) and
    `blockedApps.appliesTo` (`dictation`, or `dictation_and_notetaker`);
  - `features.notetaker`, `scratchpad`, `transforms`, `connectors`, `shareLinksTeam`,
    `shareLinksAnyone`, `exportToFile`, `mcp`, `skillSharing` (on unless set to false) and
    `connectors.disabled` (connector ids);
  - `retention.audio.max`, `.min` and `retention.transcript.max`, `.min` (days, 1 to 3650, or null);
  - `blockedDomains` (up to 500) and `adminContact` (team scope only).
- **Merging.** A feature is off if any layer turns it off, so a department cannot turn on what the
  team turned off. Block lists and disabled connectors are added together. A retention limit is the
  strictest given (the lowest maximum, the highest minimum, and a minimum above the maximum is
  brought down to it). A layer's own minimum cannot be above its maximum.
- **Domains** are written like `example.com` however they are typed (scheme, path, port and `www.`
  are dropped; the name is lower-cased and in punycode). `example.com` blocks `sub.example.com`
  and not `notexample.com`.
- **Retention reports.** After the app applies a new limit it posts the counts to
  `POST …/policy/report`; the audit log gets the numbers and nothing else.
- Every change is an audit entry per setting (`policy.changed` with the old and new value; a list
  is only "3 items"). A webhook for SIEM streaming is refused if a team blocks its host.

| Route                                               | Needs    |
| --------------------------------------------------- | -------- |
| `GET …/policy/effective`                            | any role |
| `GET …/policy?scope=…&scopeId=…`                    | admin    |
| `PUT …/policy` (`scope`, `scopeId`, `set`, `unset`) | admin    |
| `POST …/policy/report`                              | any role |

## Usage dashboards, export and the leaderboard (TM-09, TM-10)

Apps send **counts**, never text. An event is a day (`YYYY-MM-DD`, the app's local day, within the
last 35 days), a metric, a number and, for dictation, an app group. The server adds it to the
person's daily rollup and keeps nothing else: a field that is not one of these is ignored, so text
cannot be stored by mistake.

- **Metrics:** `words`, `dictations`, `meeting_minutes_recorded`, `meeting_minutes_processed`,
  `meetings_recorded`, `skills_run`, `ask_sessions`.
- **Batches.** `POST …/usage` with a `batchId` and up to 500 events. Sending the same batch id again
  is answered with `duplicate: true` and counts nothing. Any role can send.
- **App groups.** `mail`, `browser`, `chat`, `documents`, `code`, `notes`, `other`; an unknown group
  is `other`. A real app name is kept only when the team turns **app names** on, and then only for
  `words` and `dictations`.
- **Dashboard** (`GET …/usage`, admins and managers): totals, every day of the range, top apps,
  figures per department, and "time saved" (words divided by the team's typing speed, 40 words a
  minute by default). Filters: `from`, `to` (at most 400 days), `department`, `member`;
  `detail=members` adds a row per person. A **Manager** sees only their own department and the people
  in it; another department is 403.
- **Export** (`GET …/usage/export?format=csv|json`): exactly the filtered rollup rows, with the
  member, department and cost center. A cell that a spreadsheet could run as a formula (`=`, `+`,
  `-`, `@`) gets a quote in front. Each export is an audit entry with the row count.
- **Moving a person to another department** moves their history with them: the department is read
  when a report is run.
- **Leaderboard** (`GET …/leaderboard?metric=words|meetings|streak&period=week|all`): the last seven
  days or all time. Streak is the days active in the last seven (week) or the longest run (all time).
  Ties share a rank (1, 1, 3). Everyone sees names and ranks; a count is shown only to the person it
  belongs to and to admins. A member can opt out (`PUT …/leaderboard/me`): they are in no response
  and their count is still in the total. Admins turn the board off, choose the metric and choose
  whether members are listed by default (`PUT …/leaderboard/settings`).
- **Settings** (`GET`, `PUT …/usage/settings`): `typingWpm` (10 to 150), `retentionDays` (30 to 3650,
  default 400; older rollups are removed daily), `appNames`.

| Route                                                       | Needs                           |
| ----------------------------------------------------------- | ------------------------------- |
| `POST …/usage`                                              | any role                        |
| `GET …/usage`, `…/usage/export`                             | admin, manager (own department) |
| `GET`, `PUT …/usage/settings`, `PUT …/leaderboard/settings` | admin                           |
| `GET …/leaderboard`, `PUT …/leaderboard/me`                 | any role                        |

## Single sign-on, SCIM and domains (TM-18 to TM-20): simulations

Everything here is a **simulation**. It is built to the shape of SAML single sign-on, SCIM 2.0 and
DNS domain verification so the rules and the screens can be tried, and none of it has been checked
against a real identity provider. Every response about it carries
`simulation: { label: "Simulation", notice: … }`, and the admin console must show it on every
screen. A real provider needs a public HTTPS address, a registered app and its metadata, which a
local build does not have (that is a gate for M8).

- **SSO setup** (`PUT …/identity/sso`, admins): the provider's metadata XML, `enabled`, `jitCreate`
  (make an account and a membership at first sign-in) and `enforce` (members cannot use a password;
  the server owner always can). The metadata is checked for **structure only**: an
  `EntityDescriptor` with an entity id, an `IDPSSODescriptor`, a sign-on address and a signing
  certificate that can be read and has not expired. Metadata with no signing certificate is refused
  with that reason. A DOCTYPE is refused. **Test connection** (`POST …/identity/sso/test`) reports
  those checks and says the real provider was not checked. The response also shows the service
  provider's entity id (`urn:murmur:team:<id>`) and the ACS address (`/v1/sso/acs`).
- **The test identity provider** exists only when the server starts with `MURMUR_DEV_IDP=1`. It
  signs "SAML-like" assertions (JSON, not XML) with a key made at start. The flow:
  `POST …/identity/sso/start` (a sign-in request, valid 10 minutes, one use) →
  `POST /dev-idp/authorize` (`requestId`, `email`, `name`: the provider's login) →
  `POST /v1/sso/acs` (`samlResponse`) which checks the signature, the issuer against the team's
  metadata, the audience, the time and that the request is unused, then returns a session.
  `GET /dev-idp/metadata` is its metadata, in the shape of a real provider's.
- **Enforced SSO** makes `POST /v1/sessions` answer 403 `sso_required` for anyone in a team that
  requires it, except the server owner.
- **SCIM** (`PUT …/identity/scim`, admins): turning it on makes a token, shown once and kept hashed;
  `POST …/identity/scim/token` makes a new one. `/scim/v2` has `Users` and `Groups` (create, read,
  list, replace, patch, delete) for the team the token belongs to, with `userName eq` and
  `externalId eq` filters. A deactivated user cannot sign in and their sessions end; nothing is
  deleted, and `DELETE` only turns them off. The owner cannot be changed through SCIM. A wrong token
  is 401 in the SCIM error format and changes nothing. A **group map** sends a group's members to a
  department or a role (and takes them back out when they leave the group); a team's owner is never
  moved. The provider in this repository is `src/scim-test-client.ts`:
  `npm run scim:test --workspace @murmur/local-server -- <server url> <scim token>`.
- **Domains** (`…/identity/domains`, admins): add a domain, put the `TXT` record shown in DNS
  (`_murmur-challenge.<domain>` = `murmur-verify=<token>`) and verify. The record is looked at no
  more than once in 10 minutes, and a second team cannot verify a domain the first has. The lookup
  can be replaced with a JSON file of fake records (`MURMUR_DNS_RECORDS`). A verified domain can:
  let a person with that address ask to join without an invite (`POST …/domain-join`, an admin still
  approves), limit invite sign-ups and single sign-on to its addresses (`restrictSignup`), and offer
  a personal account the chance to join (`capture`): `GET /v1/me/capture-offers`, then
  `POST …/capture/accept` or `…/decline`. Nothing moves an account by itself.

## IP allowlist, compliance mode and the managed file (TM-21 to TM-23)

- **IP allowlist** (`GET`, `PUT /v1/network/allowlist`, server owner). Each entry is a CIDR range or
  an address, IPv4 or IPv6 (up to 100). It is checked from the **socket's own address** before
  anything else, so a refused address gets 403 `ip_not_allowed` and learns nothing; `X-Forwarded-For`
  and similar headers are never read. **This machine is always allowed**, so removing the last other
  entry never locks the owner out. A refusal is an audit entry (`network.denied`), at most one a
  minute for an address. By default the server listens on this machine only, so the list matters
  once you start it with `MURMUR_SERVER_LAN=1` (it then listens on all addresses and accepts an
  address as the `Host`). If you lock yourself out, on the host machine run
  `npm run allowlist:reset --workspace @murmur/local-server`.
- **Compliance mode** (`GET`, `PUT …/compliance`, admins): `none`, `strict_data` or `records`. A mode
  is a bundle of policy values (`src/compliance-bundles.json`), written at the team layer with the
  source `compliance`, so the console can say "Set by compliance mode". **It is a setting, not a
  certification**, and every response says so.
  - `strict_data`: audio kept at most 7 days, transcripts 365, no export to file, no share links, no
    MCP, all connectors read only; meeting views and exports reported by the apps are audited.
  - `records`: audio and transcripts kept at least 365 days, deletion needs approval; deletions
    reported by the apps are audited.
  - Changing the mode clears what the old bundle set and writes the new one. Only the **owner** can
    override one value, which is logged (`compliance.overridden`, with the old and the new value);
    an admin's attempt is 403 `compliance_locked`.
  - Apps report `meeting_viewed`, `export` and `deletion` with `POST …/compliance/report`; the audit
    log gets a meeting id or a kind and a count, only when the mode asks for it.
- **The managed file** (TM-21, the contract): `/Library/Application Support/Murmur/managed.json`,
  which device management would deliver. Murmur only reads it. `{ "version": 1, "serverUrl"?,
"policy"?, "updates"?: { "policy": "automatic" | "notify" | "off", "feedUrl"? } }`; `policy` takes
  the same settings as team policy. A file that does not follow this is **ignored and logged**,
  never half applied (`packages/shared/src/managed.ts`, `apps/desktop/src/main/managed`). Showing
  the badge, locking settings and the update line in the Hub is #255.

## Plan tiers and the training lock (TM-24, TM-25)

The server has a **plan tier** (Free, Pro, Team, Growth, Enterprise; the owner's build is on
Enterprise so everything can be tried). It is a local switch for testing: **nothing is charged, there
is no billing, payment or subscription code, and a test fails if one is added**
(`packages/shared/src/no-payments.test.ts`).

- **One matrix.** `PLAN_FEATURES` and the tier each feature first appears on are in
  `packages/shared/src/plans.ts`, read by both the app and this server. The tests write the matrix
  out by hand.
- **Gates.** A route that needs a feature answers 403 `plan_required` ("Available on Team") when the
  tier is lower, after the sign-in check. `src/plan-gates.ts` maps routes to features; a test fails
  for a route that is neither gated nor on the list of routes for every plan.
  - Team: teams, members, departments and invites; shared dictionary and snippets; the leaderboard;
    usage dashboards (admins only); the audit log (view, verify); basic policy (blocked apps and
    features).
  - Growth: usage dashboards for managers, audit export, the full policy (retention, blocked domains,
    connector limits, deletion approval), compliance mode, the IP allowlist.
  - Enterprise: audit SIEM streaming; SSO, SCIM and domains.
  - The personal features (rewrites, Ask, connectors, MCP, unlimited meetings) are enforced in the app.
- **The plan** (`GET /v1/plan`, any signed-in person; `PUT /v1/plan { tier }`, the server owner):
  the tier, which features it allows, and the training lock. Each change is `plan.changed`.
- **Training lock.** Nothing Murmur keeps is used for model training on any tier, and
  `optIn` is false everywhere. On Growth and Enterprise the choice is shown locked off. It is a
  statement and a stored value, not a network control (there is no cloud AI), and the notice says so.
  A change in the lock is written to the log as `plan.training_lock`.

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

## The admin console (TM-11)

`http://127.0.0.1:7830/admin` (the same port; for admins, opened from the Hub's Team page). It is
plain HTML, CSS and JavaScript modules in `services/local-server/admin` with no build step and no
dependency (ADR-0093), served by the server itself. It has ten pages: **Members**, **Invites and
requests**, **Teams and departments**, **Dictionary and Snippets** (governance, review queue, locks,
conflicts, CSV import), **Policies**, **Usage**, **Audit log**, **Identity** (SSO, SCIM and domains,
every section with the simulation label), **Plan and compliance** and **Settings** (audit retention
and streaming, the address allowlist). Shared Skills are not built, so there is no Skills page.

- **Every action is an API call** to a route in the table above (`admin/api.js` names each one as
  `"METHOD /path"`), and a test checks every such name against the server's route table. The console
  has no access to the database, never calls the SCIM or development-provider routes, never uses
  `innerHTML`, and reaches the network only through that helper.
- **Sign-in** is `POST /v1/admin/session`: the same checks as `POST /v1/sessions` (throttle,
  deactivated accounts, enforced SSO), then the token goes into an `HttpOnly; SameSite=Strict`
  cookie and **not** into the answer, so no script can read it. `DELETE /v1/admin/session` ends it.
- **Who may open it:** the server owner, or an owner, admin or manager of any team. Anyone else
  gets the **403 page** (at sign-in, and at `GET /admin` with any other session), and a server plan
  without the admin console (below Team) says so after sign-in. What each page may do is still
  decided by the permission matrix on every call; a manager sees what a manager may.
- **Cookie requests** that change something must carry `x-murmur-admin: 1` (a page on another
  site cannot add it) and pass the Origin check; a SCIM route never accepts a cookie. A Bearer
  request needs neither.
- **No stored password or token is shown.** The two things made once are shown once, with a note:
  an invite's code and link, and a SCIM token. The server keeps only their hashes.
- The files are served only from that folder (a fixed name pattern, no path segments but
  `pages/`), with a strict content security policy (`script-src 'self'`), `no-store`, `DENY` for
  frames, and only for this machine's own name or address like the rest of the server.
- Not built: the `team.admin.requireMfa` simulation of a TOTP step, and Astryx components (the
  spec asks for a React bundle; see the ADR).

### A second step for the console (`team.admin.requireMfa`)

The console can ask for a time-based one-time password (RFC 6238: HMAC-SHA1, six digits, thirty seconds) after the password. Any authenticator app reads the key. `src/mfa.ts` has the code, the recovery codes and the checks.

- **Setting up** asks for the password, not a session, because a person who must have a second step cannot get a session without one: `POST /v1/admin/mfa/begin` gives the key and an `otpauth://` address once; `POST /v1/admin/mfa/confirm` with a right code turns it on and gives eight recovery codes, once. The console's sign-in page does both.
- **Signing in** with a second step on needs `code` in `POST /v1/admin/session`: the code from the app, or a recovery code. A code works once (its time step is remembered); the steps either side of now are accepted for a clock that is a little off; a recovery code works once. Without a code the answer is 401 `mfa_required`, with a wrong one 401 `mfa_invalid`, and no session is made.
- **Five wrong codes in a row** make a wait of thirty seconds, as for passwords, and say how long (`delayed`, 429).
- **Requiring it:** the server owner turns `team.admin.requireMfa` on (`PUT /v1/admin/mfa-policy`, from the console's Settings page) and a console account with none is refused with 403 `mfa_enrollment_required` until it sets one up. The owner must have one first, or turning it on is refused (`enroll_first`). While it is required a person cannot turn their own off (`POST /v1/admin/mfa/disable` needs a code and is refused with `mfa_required_by_owner`).
- **A lost phone and no recovery codes:** the owner resets the person's second step (`POST /v1/users/:userId/mfa/reset`, the Members page), and they set it up again.
- **What is kept:** the key as it is (a code cannot be checked from a hash) and only hashes of the recovery codes. The audit log has `mfa.enrollment_started`, `mfa.enrolled`, `mfa.failed`, `mfa.recovery_used`, `mfa.disabled`, `mfa.reset` and `admin.mfa_policy_changed`, with counts and never a key, a code or an address.
- **Honest limits:** the database is not encrypted at rest, so this guards the console against a stolen password; it does not guard against someone who can read the server's files. The setting is for the whole server, because the console's sign-in is.

### Shared Skills and folders (NT-16, NT-17)

What a team shares besides its dictionary and snippets (`src/shared-content.ts`, `routes/shared-content.ts`). It is for Team and up (the same gate as the shared dictionary) and for people in the team.

- **Skills.** An admin publishes a Skill (the Skill file as text: front matter, then the prompt) to the whole team or one department; a department's manager publishes only to their own. Members and viewers read it and copy it into their own Skills in the app; they cannot change or remove it. Each change makes a new version and the old ones stay (`GET …/skills/:id/versions`). A publish is refused when the team's policy turns Notetaker off. Names are unique in a place. A Skill file is at most 20 KB.
- **Folders** hold copies of notes a person chose to share, as text; the server has no field for audio. Kinds: `shared` (named people, each can write or only read; the maker is in it), `department` (that department) and `company` (the team). A viewer reads folders they can see and adds to none. Admins see every folder. The maker, an admin, or a department's manager for a department folder renames or removes it (its notes go with it); a person may leave a shared folder; a note is removed by the person who shared it or by those who manage the folder. A note is at most 60 KB (the server's request limit is 64 KB).
- **One answer to keep in step with:** `GET /v1/teams/:teamId/content?since=<revision>` gives the Skills and folders (with each folder's people and the titles of its notes, not their text) and a revision, or `unchanged`. A note's text is read one at a time (`GET …/folders/:id/items/:itemId`).
- **Matrix and audit:** the actions are `skills.view`, `skills.manage` (a manager's is for their department), `folders.view` and `folders.contribute`. The audit log has `skill.published`, `skill.updated`, `skill.removed` and the `folder.*` entries, with the kind and version and never a prompt or a note's text.
- **The console** has a Skills and folders page to publish, edit, remove and make department and company folders.

## What it refuses

- A `Host` that is not this machine, and a request with a different `Origin`: a web page cannot
  use the server on your behalf.
- A body that is not `application/json`, or larger than 64 KB.
- A listen address that is not `127.0.0.1` or `::1`. Reaching it from the LAN comes with the IP
  allowlist (TM-22).

## Tests

`npm test` runs `services/local-server/src/*.test.ts` against an in-memory database and a real
HTTP listener on a free port.
