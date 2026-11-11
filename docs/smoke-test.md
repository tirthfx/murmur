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

The script prints `PASS` and exits with 0, or `FAIL: <reason>` and exits with 1.

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

| Variable               | Effect                                                       |
| ---------------------- | ------------------------------------------------------------ |
| `MURMUR_PROFILE_DIR`   | Keeps the database, settings and window state in this folder |
| `MURMUR_SHARE_MODELS`  | `1`: still read the models from the normal folder            |
| `MURMUR_SMOKE`         | `1`: open the test window and run the smoke steps, then quit |
| `MURMUR_SMOKE_HOLD_MS` | How long the key is held                                     |
| `MURMUR_AUDIO_FIXTURE` | Helper: read this audio file in place of the microphone      |
| `MURMUR_AUDIO_DIR`     | Helper: where temporary recordings go                        |

None of these is set in normal use.

## Code

- `scripts/smoke.mjs`: the runner and the checks.
- `apps/desktop/src/main/smoke.ts`: the steps inside the app.
- `native/helper-mac/Sources/MurmurHelperCore/FileAudioSource.swift`: the clip as an input.
