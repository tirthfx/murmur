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

## Not here yet

Proposing your own entries to the team from the Dictionary and Snippets pages, and enforcing the
team's policy, the managed file and the plan in the app (#255).
