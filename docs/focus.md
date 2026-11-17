# Focus Mode

Cover chosen apps with a notice for a while (M3, RW-18, RW-19 and RW-21). Experimental and off
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
- **The overlay:** when a blocked app comes to the front, a dark cover fills the screen with
  "Focus is on. [App] is blocked." and three buttons:
  - **Go back:** activates the app used before the blocked one (the Finder when there was
    none).
  - **Pause Focus for 10 minutes:** blocking stops, then Focus comes back for the time that
    was left.
  - **Turn off Focus.**
    Clicking outside the card does nothing. Switching to another app (Command+Tab) hides it.
    Murmur's own shortcuts keep working.

Why not Option+F: on a Mac, Option+F types "ƒ", and the key listener only listens, so the
letter would still be typed. See ADR-0057 in the vault.

## How it works

- While Focus is on, main sends `focus.watch` `{enabled: true}`; the helper then checks the app
  in front four times a second on a background thread and sends `focus.app`
  `{bundleId, name, pid}` only when it changes (and once at once). The helper's main thread
  reads stdin, so there is no run loop for workspace notifications; the check is the same
  Accessibility lookup the paste uses. `focus.watch` `{enabled: false}` stops it.
- `apps.list` returns the installed apps (bundle id and name) from `/Applications`,
  `/Applications/Utilities`, `/System/Applications` (and its Utilities) and `~/Applications`.
- Main compares the bundle id with the blocked list. Murmur's own windows coming to the front
  (the overlay takes the keyboard) change nothing.
- The overlay is a borderless window at the screen-saver level on every Space, covering the
  display the pointer is on (`focus.html`, `focus-preload.ts`).
- Nothing about which apps were in front is stored or logged.

Code: `apps/desktop/src/main/focus/` (controller, store, overlay window and IPC),
`native/helper-mac/Sources/MurmurHelperCore/FocusWatch.swift`, `packages/shared/src/focus.ts`.

## Data

Migration 0016 adds `focus_rules` (kind `app`, the bundle id, its name) and `focus_sessions`
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
7. Start Focus, quit Murmur, then check the last row of `focus_sessions`: `end_reason` is
   `quit`.
