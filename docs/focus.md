# Focus Mode

Cover chosen apps and websites with a notice for a while (M3, RW-18 to RW-21). Experimental and off
by default: turn on **Focus Mode** in Settings, Experimental. Apps are never quit.

## Using it

- **Start:** Control+Option+F (change or turn it off in Settings, Focus Mode), the tray's
  **Start Focus** menu, or **Start Focus** in Settings. Durations: 25, 50 or 90 minutes, or
  until turned off. The last one chosen is remembered, and the shortcut uses it.
- **While on:** the Bar, when idle, shows "Focus" and the time left. The same shortcut, the
  tray (**Focus is on**, **Turn off Focus**) or Settings turns it off. When the time is up the
  Bar says "Focus ended".
- **Blocked apps:** Settings, Focus Mode. Choose from the installed apps (the Applications
  folders), or type a bundle id. At most 100. Murmur cannot block itself.
- **Blocked sites (RW-20):** Settings, Focus Mode, Blocked sites. Type a domain
  ("example.com" also blocks "news.example.com" and "www.example.com") or a domain and path
  ("youtube.com/shorts" blocks that page and those under it, not "/watch"). A pasted address
  works: the scheme, "www.", the query and the fragment are dropped. At most 200.
- **The overlay:** when a blocked app or site comes to the front, a dark cover fills the screen with
  "Focus is on. [App] is blocked." and three buttons:
  - **Go back:** for an app, activates the app used before it (the Finder when there was
    none). For a site, presses Back (Command+[) in the browser; if the page is still blocked
    1.5 seconds later (a new tab has nothing to go back to), the previous app instead.
  - **Pause Focus for 10 minutes:** blocking stops, then Focus comes back for the time that
    was left.
  - **Turn off Focus.**
    Clicking outside the card does nothing. Switching to another app (Command+Tab) hides it.
    Murmur's own shortcuts keep working.

Why not Option+F: on a Mac, Option+F types "ƒ", and the key listener only listens, so the
letter would still be typed. See ADR-0057 in the vault.

## Browsers

The page is read through Accessibility from the web area of the browser's front window
(its `AXURL`), without extensions, network settings or page contents. Chromium browsers
build that tree only when asked; the helper asks once per process (as for context awareness).
Known browsers: Safari (and Technology Preview), Chrome (and Beta, Canary), Edge, Brave, Arc,
Firefox, Vivaldi, Opera, Chromium. When one of them is in front and its page cannot be read,
the Blocked sites list says "Website blocking is not available in [browser]." That is kept in
memory for this run only.

| Browser            | Result                                  | Checked |
| ------------------ | --------------------------------------- | ------- |
| Safari             | to check on the owner's Mac (installed) | —       |
| Google Chrome      | to check on the owner's Mac (installed) | —       |
| Brave              | to check on the owner's Mac (installed) | —       |
| Edge, Arc, Firefox | not installed here; untested            | —       |

Record the results of the manual test in this table.

## How it works

- While Focus is on, main sends `focus.watch` `{enabled: true}`; the helper then checks the app
  in front four times a second on a background thread and sends `focus.app`
  `{bundleId, name, pid}` only when it changes (and once at once). The helper's main thread
  reads stdin, so there is no run loop for workspace notifications; the check is the same
  Accessibility lookup the paste uses. `focus.watch` `{enabled: false}` stops it.
- `apps.list` returns the installed apps (bundle id and name) from `/Applications`,
  `/Applications/Utilities`, `/System/Applications` (and its Utilities) and `~/Applications`.
- In a known browser, `focus.app` also carries `site` `{host, path}` and `siteStatus`
  (`ok`, `unavailable`; `none` outside browsers). The page is read when the app changes, when
  the front window's title changes (another tab), and about every 2 seconds. The helper keeps
  only the host (lower case) and path of http and https pages; the scheme, query and fragment
  never leave it. Capability `focus.sites`.
- Main compares the bundle id with the blocked apps and the site with the blocked sites. Murmur's own windows coming to the front
  (the overlay takes the keyboard) change nothing.
- The overlay is a borderless window at the screen-saver level on every Space, covering the
  display the pointer is on (`focus.html`, `focus-preload.ts`).
- Nothing about which apps or pages were in front is stored or logged.

Code: `apps/desktop/src/main/focus/` (controller, store, overlay window and IPC),
`native/helper-mac/Sources/MurmurHelperCore/FocusWatch.swift`, `packages/shared/src/focus.ts`.

## Data

Migration 0016 adds `focus_rules` (kind `app` with the bundle id and its name, or kind `site`
with `domain` or `domain/path`) and `focus_sessions`
(start, planned length, end, and why it ended: `timer`, `user`, `quit` or `paused`). Pausing
ends the session as `paused`; resuming starts a new one with the time left. A session left open
by a crash is closed as `quit` at the next start.

## Manual test

1. Settings, Experimental: turn on Focus Mode. In the Focus Mode section, block TextEdit.
2. Press Control+Option+F: the Bar shows "Focus 25:00" counting down.
3. Open TextEdit: the overlay appears within a second. Click **Go back**: the previous app
   comes back and the overlay goes.
4. Open TextEdit again, press Command+Tab to another app: the overlay hides.
5. Open TextEdit, click **Pause Focus for 10 minutes**: TextEdit can be used; the Bar says
   "Focus paused for 10 minutes".
6. Turn Focus off from the tray. Open TextEdit: nothing happens.
7. Block example.com. In Safari, open news.example.com: the overlay appears within 3 seconds.
   Click **Go back**: Safari goes back a page. Open it in a new tab and click **Go back**:
   after 1.5 s the previous app comes to the front. Repeat in Chrome and Brave, and fill in the
   browser table above.
8. Start Focus, quit Murmur, then check the last row of `focus_sessions`: `end_reason` is
   `quit`.
