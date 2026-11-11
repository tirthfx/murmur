# End-to-end smoke test

One command runs the whole dictation path on a clean profile and checks the result:

```bash
npm run smoke
```

It runs on the owner's Mac, not in CI: it needs macOS, the built helper, the downloaded
models and the Accessibility permission.

## What it does

1. Creates a temporary, empty profile folder (`MURMUR_PROFILE_DIR`), so the database and
   settings start from nothing. The models are read from their normal place
   (`MURMUR_SHARE_MODELS=1`), because they are large.
2. Makes a short speech clip with the system voice (`say`, then `afconvert` to 16 kHz mono).
   No audio file is stored in the repository.
3. Starts the app with `MURMUR_SMOKE=1`. In this mode a small window with one text box takes
   the place of the Hub.
4. When dictation is ready, the app puts the caret in the box and reports a push-to-talk
   key down, exactly as the key listener would.
5. The helper plays the clip in place of the microphone (`MURMUR_AUDIO_FIXTURE`).
6. After the length of the clip the app reports key up. The recording is transcribed,
   cleaned and pasted into the box by the same code as a real dictation.
7. The script checks that:
   - the box holds the expected sentence (compared without case and punctuation);
   - the history table has exactly one row, with raw text, final text equal to the inserted
     text, and insert status `inserted`.
8. The app quits and the temporary profile is removed. `npm run smoke -- --keep` keeps it.

`npm run smoke -- --packaged` runs the same steps against the app built by `npm run package`.
macOS treats the packaged app as a different app, so it needs its own Accessibility grant
first (see `docs/permissions.md`).

The script prints `PASS` and exits with 0, or `FAIL: <reason>` and exits with 1.

## Full mode

`npm run smoke -- --full` runs the main dictation, then these checks, and prints one line
each (`ok`, `FAIL`, or `SKIP` when the Mac cannot run it):

| Check                                           | How                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Bar position is saved and restored              | Moves the Bar, closes and reopens its window                                                                  |
| Tray: choosing a microphone and a language      | Runs the menu actions; the settings follow, then go back                                                      |
| Bar shows listening, processing, done           | Records the Bar states during a dictation                                                                     |
| Text arrives while the test box keeps the focus | The Bar never takes the focus                                                                                 |
| Start and success sounds play                   | Records the sounds asked for                                                                                  |
| Output muted while dictating, restored after    | Turns on mute while dictating; reads the output mute during and after                                         |
| Tray: Start and Stop dictation                  | Dictates through the menu's Start and Stop                                                                    |
| An output that was already muted stays muted    | Mutes the Mac first, dictates, reads it after, unmutes                                                        |
| Tray: Copy last transcript                      | Saves the clipboard, copies, compares, puts the clipboard back                                                |
| Silent microphone warns                         | Copies a silent clip over the fixture; the Bar says "No sound from …"                                         |
| Context: the text before the caret is read      | Puts text in the box first; the context read at the start holds it                                            |
| Press enter                                     | A clip ending in "press enter": the text without the command, then a Return                                   |
| Languages                                       | A Hindi clip (system voice Lekha): Devanagari with Hindi chosen, Latin letters with Hindi in Latin script     |
| Whisper mode                                    | The speech clip 40 dB quieter gives text with whisper mode on (the line also says what came out with it off)  |
| Mic check                                       | Runs the Hub's check on the clip: speech and background levels and advice                                     |
| Retry                                           | One transcription is made to fail on purpose; Retry last dictation from the tray types the text               |
| Typing reminder                                 | 70 words are handed to the reminder: nothing while snoozed, the suggestion once on again                      |
| Dictionary                                      | Saves "FOX" as a spelling and "lazy dog" → "sleepy cat", dictates the clip, removes them                      |
| Snippets                                        | Makes the clip's sentence a trigger for a two-line rich body, dictates it, removes it                         |
| Styles                                          | Puts the test window's app in Personal, dictates, expects no capital and no final full stop                   |
| Memory                                          | Dictates "Remember that I prefer metric units": the Bar asks, nothing is typed, Save stores it (then removed) |
| Learning                                        | Dictates twice, changes "dog" to "cat" in the box each time; the dictionary learns it (then removed)          |
| Quit                                            | The app exits by itself and the helper process is gone                                                        |

The typing reminder is handed word counts instead of real key presses, which would type on the
desktop; counting key presses is covered by the helper's unit tests. Mouse buttons and plugging
a microphone in or out still need the owner.

It changes the Mac's own output mute for a few seconds and leaves it as it was. The
clipboard is saved with every type it holds and written back. Sounds are checked as
requested, not heard.

## What it needs

- `npm run build:helper` has been run.
- `npm run model:download` has been run (the speech model is required; without the cleanup
  model the text is cleaned by rules only).
- **Accessibility** is granted, so the helper can paste. Without it the test fails with "the
  text was copied, not pasted".
- The Microphone permission is **not** needed: in fixture mode the helper reads the clip and
  reports the microphone as granted.
- Leave the test window in front for the few seconds the run takes. If another window takes
  the focus, nothing is pasted and the test fails with a message saying so. Text never goes
  into another app.

## What it does not cover

- The real key listener (the listen-only event tap). The key press is reported inside the
  app. Use the manual test in `docs/hotkeys.md`.
- A real microphone, its permission and the device list. Use `docs/audio.md`.
- The first-run setup screens. Use `docs/onboarding.md`.

## Test-only switches

| Variable                 | Effect                                                                  |
| ------------------------ | ----------------------------------------------------------------------- |
| `MURMUR_PROFILE_DIR`     | Keeps the database, settings and window state in this folder            |
| `MURMUR_SHARE_MODELS`    | `1`: still read the models from the normal folder                       |
| `MURMUR_SMOKE`           | `1`: open the test window and run the smoke steps, then quit            |
| `MURMUR_SMOKE_HOLD_MS`   | How long the key is held                                                |
| `MURMUR_AUDIO_FIXTURE`   | Helper: read this audio file in place of the microphone                 |
| `MURMUR_AUDIO_DIR`       | Helper: where temporary recordings go                                   |
| `MURMUR_SMOKE_FULL`      | `1`: run the full-mode checks after the main dictation                  |
| `MURMUR_SMOKE_CLIPS_DIR` | Full mode: the clips (`<name>.wav`) and `clips.json` with their lengths |

None of these is set in normal use.

## Code

- `scripts/smoke.mjs`: the runner and the checks.
- `apps/desktop/src/main/smoke.ts`: the steps inside the app.
- `apps/desktop/src/main/smoke-checks.ts`: the full-mode checks.
- `native/helper-mac/Sources/MurmurHelperCore/FileAudioSource.swift`: the clip as an input.
