# Team mode in the app

Team mode (M7, TM-01 client, TM-06, TM-09) lets Murmur use a team server (`docs/local-server.md`).
It is **off until you connect** on the Hub's **Team** page. What you dictate and record stays on
this Mac.

## Using it

- **Connect** to the server's address (for example `http://127.0.0.1:7830`). A server with no owner
  asks you to make the owner account (password of 12 or more characters); otherwise you sign in.
  An **invite code** joins a team, or asks to join if an admin must approve, and makes an account
  when you have none.
- **Session.** The token is a Keychain item (`dev.murmur.team`). `team.json` in the app data folder
  holds the server address, your name and email, the idle time and the last shared copy: never a
  token or a password. Sign out, or turn team mode off, removes the Keychain item and the shared
  entries; your own data is not touched.
- **Idle lock.** After the Mac has been idle for the chosen time (1 to 240 minutes, 15 by default) or
  when you press Lock now, the Hub shows only a password box. Meetings, notes' meeting data,
  Ask, briefs and tasks are also refused by the main process (`meetings:`, `ask:`, `brief:`,
  `tasks:` channels, except start and stop of a recording), so a locked app shows nothing. The lock
  survives a restart. Unlocking signs in again; five wrong passwords make the server wait 30 seconds.
- **Shared dictionary and snippets.** Pulled when you sign in and every 5 minutes (the Update now
  button does it at once), kept on disk for when the server is out of reach, and laid over your own:
  **your own entry always wins** for the same term or trigger, and nothing shared is written to your
  personal tables. Several teams are merged, earlier first. `{{date}}`, `{{me}}` and `{{team}}` in a
  shared snippet are filled in on your Mac.
- **Turned-down proposals** are shown on the page until dismissed.
- **Usage counts.** Each sync sends only what is new: words and dictations by kind of app (mail,
  browser, chat, documents, code, notes, other: never an app name or any text), and meetings
  recorded with their minutes. A batch whose answer was lost is sent again with the same id and
  counted once.
- **Strict local mode** refuses a server on the network, but not one on this Mac.

## Policy, the managed file and the plan in the app (TM-13 to TM-16, TM-21, TM-24, TM-25)

The policy in force is the strictest of **the team policies last downloaded** (one per team; kept
in `team.json` so it still applies when the server is out of reach, and dropped when you sign out)
and **the managed file's policy** (`/Library/Application Support/Murmur/managed.json`, or the path
in `MURMUR_MANAGED_PATH` for a test; an invalid file is ignored and the Hub says so). It is
enforced in the main process (`apps/desktop/src/main/policy`), so a hotkey, the tray or another
window cannot get round it. The Hub only shows it.

| Policy                               | What the app does                                                                                                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blocked apps (TM-13)                 | Pressing the dictation key in a blocked app starts no capture; the Bar says why. With "dictation and Notetaker" a call in that app is not offered for recording.                                                                          |
| Notetaker off (TM-14)                | No recording starts, from the hotkey, the tray, the calendar or a detected call (`capture.start` is never sent). Recorded meetings stay readable. A recording running can be stopped.                                                     |
| Scratchpad, Rewrites, Connectors off | The window will not open and its shortcut does nothing; Rewrites have no shortcuts and no auto-apply; no connector can be connected or synced. Their pages leave the sidebar.                                                             |
| MCP off                              | The local MCP server answers nothing, whatever the setting.                                                                                                                                                                               |
| Export off                           | Meeting files, note export, Insights CSV and Skill files are refused; Skill sharing has its own switch.                                                                                                                                   |
| Blocked domains (TM-16)              | A joining link, a brief or draft link, a meeting document link, a connector's sign-in page and its requests to a blocked host (or a subdomain) are refused with the reason.                                                               |
| Retention limits (TM-15)             | The longer choice (or keeping for ever) is cut to the limit where data is kept or deleted, also a folder's own period; a shorter one is raised to the minimum. The settings keep your choice and the Hub says "Set by your organization". |
| Managed badge and updates (TM-21)    | The sidebar says "Managed by your organization", and "Updates are managed by your organization" when the file has an `updates` section.                                                                                                   |

Plan (TM-24, TM-25): the plan is still a local setting (no payments). Free records **5 meetings a
month** (counted from the 1st, this Mac's time); Ask across meetings needs Pro, connectors need
Pro, the MCP server needs Pro. A refusal says "Available on Pro". The share-link policy switches
(`shareLinksTeam`, `shareLinksAnyone`) have no client feature yet: the app makes no links.

## Sharing your own entries, more counts and the retention report (TM-06, TM-07, TM-09, TM-15)

- **Share with the team.** While you are signed in to a team, each Dictionary entry and each snippet
  has a **Share** button. It sends the entry to the team server; the words say if it went live at
  once (when you may approve it), waits for a review, or was refused, and why. Your own entry stays
  where it is. A snippet is sent as plain text (a rich body is not).
- **More usage counts.** Besides words and dictations by kind of app and meetings recorded, each
  sync sends the growth in **skills run** (summaries written by a Skill, not quick ones), **Ask
  sessions** (threads started) and **meeting minutes processed** (minutes of meetings whose
  transcription finished), by this Mac's day. Numbers only, resend-safe like the others.
- **Retention report.** When the daily job removes data and a team's policy limits retention, the
  app tells that team how many recordings and transcripts were removed (counts only; the server
  writes `policy.retention_applied`). It is not repeated if the server is out of reach.
- **Admin console.** Admins see an **Admin console** button on the Team page; it opens the server's
  `/admin` page in the browser (`docs/local-server.md`), unless the policy blocks that address.

## The team client interface (SW-01, SW-08)

Everything the app asks of a team backend goes through one interface, `TeamClient`
(`packages/shared/src/team-client.ts`, version `teamClient.v1`): health, owner setup, sign-in and
sign-out, invites, teams, the shared entries (with a revision), notices, the effective policy,
usage batches, the retention report and proposals. The team service
(`apps/desktop/src/main/team/team-service.ts`) has no HTTP in it; `local-team-client.ts` implements
the interface for the local server and is the only place that knows addresses, headers and status
codes. A second backend implements the same interface and passes the same tests.

- **One error set:** `unauthorized` (the session ended: sign in again), `forbidden`, `not_found`,
  `conflict`, `invalid`, `rate_limited` (with `retryAfterSeconds`), `offline`, `refused` (Murmur's
  own rules, such as strict local mode, will not use that address) and `server`. The first six are
  the spec's; `not_found`, `invalid` and `refused` are added (ADR-0094).
- **The contract suite** (`team-client-contract.ts`) takes a backend fixture and tests the
  interface only through `TeamClient`; the fixture is the one place that knows how a backend is
  set up (a team, a member, a policy, a plan). `local-team-client.test.ts` runs it against the
  real local server. A new backend adds a fixture and runs `describeTeamClientContract`.
- **Where a backend may be named:** the lint rule (`eslint.config.js`) refuses a Supabase import
  outside `services/` and the team client folder, and refuses any import of the local server's
  code outside the team folder; `apps/desktop/src/team-boundary.test.ts` checks that the renderer,
  the preload script and the main process outside the team folder name no backend address, key or
  SDK.
- **Frozen:** a breaking change is a new version with a shim, not an edit of `teamClient.v1`.

### Choosing the backend

The Team page's Connect form takes an address and, optionally, a project key (it is labelled "Project key (optional)" and names no backend: the renderer never does).

- **No key:** the address is a Murmur team server (the local server) and the service uses `local-team-client.ts`.
- **A key:** the address is a Supabase project and the service uses `supabase-team-client.ts` (see `docs/supabase.md`). The key is the project's public key (anon or publishable); it is not a secret and gives no access alone, so it is kept in the team settings file, not the Keychain. A bare address is taken as https; plain http is allowed only on this Mac (a local stack).
- **A change of backend, address or key is a change of server:** the old session, cached entries, policies and usage memory are dropped, as for any new address.
- **The session token is kept in the Keychain either way.** For a Supabase project the token holds both the access and the refresh token; when the client renews an expired session it hands the new token back and the service stores it in the Keychain, so the person stays signed in across restarts.
- The service picks the client for each call from what it is connected to; a test that passes its own `client` always gets that one.

The choice is per address (and so per connection), which is what a team is today: one connection, one backend. Moving a team from the local server to Supabase is a new connection, with its data brought over by the migration tool.

### Shared Skills and folders: `teamContent.v1`

`TeamClient` v1 is frozen, so shared Skills and folders (NT-16, NT-17) are a second interface, `TeamContentClient` (`packages/shared/src/team-content.ts`, version `teamContent.v1`), that a backend implements next to it. Both clients do: `local-team-client.ts` and `supabase-team-client.ts` return a `TeamClient & TeamContentClient`.

- **One answer to keep in step with:** `content(teamId, since?)` gives the Skills and folders this person can see, with a revision, or `unchanged`. A folder lists its people and the titles of its notes; a note's text is read one at a time (`readNote`).
- **Skills** are the Skill file as text. Members read them (and the app can copy one into their own Skills); admins publish, change and remove; each change is a new version (`updateSkill`, `skillVersions`).
- **Folders** are `shared` (named people, a write flag each), `department` or `company`. A note is a title and Markdown text, 60 KB at most, never audio. `people(teamId)` lists who can be chosen for a shared folder.
- **The contract** (`team-content-contract.ts`) runs on the same fixture as the team client contract, against the local server in CI and against a Supabase project when one is configured (see `docs/supabase.md`). A viewer is refused before a folder is looked at, on both.

### Shared Skills and folders in the app (NT-16, NT-17)

The team service pulls `content` with each sync and keeps it in the team settings file, so the Skills and folders show while the server is out of reach; it is dropped at sign-out, for a team the person has left, and when the backend, address or key changes. `TeamView.shared` carries it, with the team each item is from.

- **Team page, "Shared with you":** Skills your teams share (name, version, description, **Add to my Skills**, which copies the Skill file into the person's own Skills through the same import the Skills tab uses; a newer version is copied again as a new Skill), and folders (kind, number of notes, **Show** to list the notes by title, **Read** to open one). **New shared folder** makes a folder for named people picked from the team (the person is always in it). Department and company folders and publishing Skills are in the admin console.
- **Meeting export panel, "Share with your team":** shown only while signed in to a team that has a folder the person may add to. It puts the meeting's **summary and open tasks, as Markdown text**, into the chosen folder (`src/main/meetings/meeting-share.ts`). The transcript, the person's own notes and the audio are never sent; a link into the transcript is reduced to its words. A meeting with no summary is refused with "Make one first".
- **IPC:** `team:people`, `team:folder-create`, `team:note-read`, `team:skill-add`, `team:share-meeting`. The renderer names no backend.

### Proposals made while the server is out of reach (SW-05)

A proposal to the shared dictionary or snippets (**Share with the team**) used to fail when the server could not be reached. Now it is saved and sent later.

- **Saved, not lost:** the proposal goes into an outbox in the team settings file (the term and the replacement, or the trigger and the expansion, and the team: only what the person chose to propose). The person is told "Saved. It is sent to the team when the team server can be reached", and the Team page says how many are waiting. At most 50 wait; after that the proposal is refused with that reason.
- **Sent in order at the next sync,** oldest first. One the server already has (a duplicate) counts as sent, so a repeat after a crash is harmless. One the server refuses is dropped and the person is told why in the proposals turned down; it does not block the ones behind it. If the server is out of reach again, the rest wait.
- **It is one person's:** the outbox is cleared at sign-out and when the server, backend or key changes, so a waiting proposal never goes out under someone else.
- **What this is and is not:** the only change a person makes to team data from the app is a proposal (the shared entries are read-only otherwise), so the outbox is for proposals. Conflicts between two people's edits of one entry (SW-06) cannot arise from the app today; the server's versions and its review flow already decide those.

### Changing your password (`teamAccount.v1`)

A third interface next to the frozen `teamClient.v1`, `TeamAccountClient` (`packages/shared/src/team-account.ts`): `changePassword({ current, next })`. Both clients implement it, and the Team page has "Change your password" while signed in.

- **A wrong current password and an unacceptable new one are `invalid`, in the backend's words;** `unauthorized` is only for a session that has ended. The service does not treat a wrong current password as a lost session.
- **Local server:** `POST /v1/me/password` (12 characters, not one of the last five, the person's other sessions end).
- **Supabase:** the current password is checked by signing in with it (the email is read from the access token), then the new one is set with the person's own session (`PUT /auth/v1/user`). Murmur's 12-character minimum is checked before anything is sent. This is how an account made by the migration tool changes its temporary password.
- **The contract** (`team-account-contract.ts`) runs on the local server in CI and on a Supabase project when one is configured: the new password signs in and the old one does not, a wrong current, a short and an unchanged password are `invalid`, no session is `unauthorized`, and a backend that is down or refused is said so first.

## Leaderboard

Insights, Leaderboard shows the team's ranks for the last seven days or all time, with a switch for whether you are listed (TM-26). It needs the local team server; the Supabase backend has no leaderboard yet and says so.

A shared term's pronunciation hint is used too: when the speech model writes the hint, the term is written instead.
