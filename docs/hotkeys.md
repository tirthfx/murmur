# Hotkeys

How Murmur notices the dictation key while another app is in front.

## Default

| Key                     | What it does                                     |
| ----------------------- | ------------------------------------------------ |
| Hold Right Option       | Dictate while held, stop on release              |
| Double-tap Right Option | Hands-free: recording continues after you let go |

Left Option is a different key and does nothing. There is no default chord; a hands-free shortcut can be set in Settings (see [settings.md](settings.md)).

## Hands-free and cancel

- A press shorter than 300 ms is a tap. A second press within 400 ms of the first locks recording (the Bar shows Hands-free); let go and keep talking.
- While locked, the next press of the key stops recording and the text is inserted once. The hands-free shortcut, if set, toggles the lock the same way.
- A single short tap ends after the 400 ms window, like a short hold.
- Escape cancels while recording: the recording is discarded and nothing is inserted. The key listener only listens, so the app in front still receives Escape too.
- The lock lives only in memory; after a restart Murmur always starts idle.

## How it works

- Main sends `hotkey.configure` with the bindings each time the helper becomes ready, restarts included. An empty list stops the key listener.
- The helper listens through a **listen-only** event tap. It never blocks, changes or delays a key; every key reaches the app in front as usual. Because of that, a binding cannot stop its key from also typing, which is why the default is a modifier key on its own.
- For each binding the helper sends `hotkey.event` with the binding id, the action, `down`/`up` (hold bindings) or `press`, and the time of the key change in epoch milliseconds. Keys that match no binding are never reported or logged.
- `hotkey.tap.status` reports `active`, `disabled_by_system` (macOS turned the listener off, for example after a slow callback; held keys are released so dictation cannot get stuck) and `reenabled`.
- Auto-repeat is ignored: holding the key gives one `down` and one `up`.
- The helper checks each binding on its own. A trigger used twice is rejected with `CONFLICT`; a plain letter or number key without a modifier, Caps Lock, or an unknown action is rejected with `INVALID_PAYLOAD`. The rest are kept.

Types and schemas: `packages/shared/src/hotkeys.ts`. Example messages: `packages/shared/protocol-fixtures/hotkey.*.json`. Mac default bindings: `apps/desktop/src/main/platform/mac-hotkeys.ts`.

## Input Monitoring

The key listener needs Input Monitoring. The helper only reads the current status; it never asks for it and never shows a prompt. If it is not granted, `hotkey.configure` fails with `PERMISSION_DENIED` and main logs that the dictation key is off.

Grant it from the Hub (Request, or Open System Settings), as described in [permissions.md](permissions.md). In development the permission belongs to the terminal or the Electron binary, not to "Murmur". When the Hub next checks permissions (it does so each time its window regains focus) and Input Monitoring reads granted, main configures the key again by itself. If macOS asks you to quit and reopen, restart `npm run dev`.

## Manual test

1. `npm run build:helper`, then `npm run dev` from the repo root.
2. Make sure Input Monitoring is granted to the app that runs the dev build. The terminal should show `[hotkeys] registered: dictate-hold`.
3. In TextEdit, hold Right Option for about a second and release. The terminal shows one `dictate-hold down` and one `dictate-hold up` line, each with `latency=` under 20 ms.
4. Press Left Option: nothing is logged.
5. Hold Right Option and type a few letters: they still type as usual (with Option's characters), and nothing about them is logged.
6. Hold Right Option for several seconds: still only one `down` line.
