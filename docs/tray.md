# Tray menu

The menu bar item gives the controls needed for daily dictation. It is created when the app
is ready and keeps working with the Hub window closed.

## Items

In order:

1. **Start dictation** or **Stop dictation**. Start begins a hands-free recording; Stop ends
   the recording in progress, however it was started.
2. **Microphone**: Auto, then each connected microphone. The current choice is checked. A
   saved microphone that is unplugged shows as "Saved microphone (not connected)".
3. **Languages**: "Detect automatically", then the fixed languages. The current one is
   checked.
4. **Copy last transcript**: copies the most recent dictation that produced text. Sessions
   that failed are skipped. Disabled when there is nothing to copy.
5. **Quit Murmur**: always present and enabled.

Microphone and language choices are the same settings the Hub shows; a change in one place
appears in the other.

## Icon

The icon is a microphone drawn in code (`tray-icon.ts`), so the repository holds no image
file for it. It is a template image, so macOS colours it for a light or dark menu bar.

A dot next to the icon shows the state:

- red while listening;
- yellow for about 10 seconds after a problem (no sound from the microphone, a recording
  that could not start or be saved, a failed transcription, text that could not be pasted).
  It clears early when the next dictation starts.

## When the menu is rebuilt

- At once on every dictation step (start, stop, cancel, failure).
- When a setting changes.
- When the microphone list changes. The list is read when the helper becomes ready and each
  time the pointer reaches the icon, so it is current before the menu opens.

## Code

| File                 | Purpose                                                 |
| -------------------- | ------------------------------------------------------- |
| `tray-menu.ts`       | The menu as plain data, from the current state          |
| `tray-controller.ts` | Follows the recorder and settings, performs actions     |
| `tray-icon.ts`       | Draws the microphone and encodes it as PNG              |
| `tray-electron.ts`   | The Electron `Tray` and `Menu` (the only Electron part) |

All under `apps/desktop/src/main/tray/`.

## Manual test

1. `npm run dev`. A microphone appears in the menu bar.
2. Open the menu. The first item reads "Start dictation". Choose it: the Bar shows
   listening, a red dot appears next to the icon, and the item now reads "Stop dictation".
3. Say a sentence, then choose "Stop dictation". The text is inserted in the app in front.
4. Choose "Copy last transcript" and paste somewhere: the same sentence appears.
5. Plug in or unplug a microphone, then open the menu again: the Microphone list matches.
6. Pick a microphone and a language. Open the Hub's Settings: both show the new choice.
7. Close the Hub window. The menu still works.
8. Choose "Quit Murmur". The app and its helper exit.
