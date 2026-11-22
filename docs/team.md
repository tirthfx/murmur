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
