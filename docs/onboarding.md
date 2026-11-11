# First-run setup

A new profile opens on the setup flow instead of the Hub. It needs no account and no
developer tools. Nothing is requested from macOS until the user presses a button.

## Steps

1. **Welcome**: what Murmur does, and that everything runs on this Mac.
2. **Microphone**, 3. **Accessibility**, 4. **Input Monitoring**: one permission each, with
   its status, the reason, an **Allow** button and an **Open System Settings** button.
   Continue is enabled once the permission is granted; **Skip for now** moves on without it.
   The status is read again each time the window regains focus, so a switch flipped in
   System Settings shows up without a restart. A denied permission keeps its step visible
   with the System Settings button.
3. **Speech model**: downloads the model with a progress bar. Every file is checked against
   the manifest (size and SHA-256) before the model loads. An interrupted download continues
   where it stopped. The step can be skipped.
4. **Dictation shortcut**: shows the push-to-talk key (Right Option by default) and lets it
   be changed.
5. **Try it**: a text box inside the setup window. Hold the key, say a sentence, release;
   the words land in the box. If something is still missing, the step says what.
6. **All set**: confirms that dictation is ready, or lists what is still missing. **Finish**
   saves the setup-complete flag (`onboarding.complete` in the settings table) and opens the
   Hub.

Settings has a **Run setup again** button. It opens the same steps; the flow can be closed
at any point and does not change the flag.

## When dictation is blocked

Dictation does not start until all of these hold:

- the helper is running;
- Microphone, Accessibility and Input Monitoring are granted;
- the speech model is downloaded and loaded.

A press of the dictation key (or Start dictation in the tray) then shows a message in the
Bar, for example "Open Murmur to finish setup: microphone access is not granted", and
nothing is recorded. A permission is read again at that moment, so a grant made a second
ago counts. A permission whose status macOS will not report is not treated as missing.

## Code

| File                                            | Purpose                                    |
| ----------------------------------------------- | ------------------------------------------ |
| `packages/shared/src/setup.ts`                  | Setup status types and the blocked message |
| `apps/desktop/src/main/setup/readiness.ts`      | What still blocks dictation                |
| `apps/desktop/src/main/setup/model-download.ts` | One download at a time, with progress      |
| `apps/desktop/src/renderer/hub/Onboarding.tsx`  | The setup screens                          |
| `apps/desktop/src/renderer/hub/setup-steps.ts`  | Step order, titles and small formatters    |

The Hub reads the model state and the blockers with `getSetupStatus` once a second while the
setup screen is open, and starts the download with `downloadSpeechModel`.

## Manual test

Use a clean profile so the flow starts from the beginning:

```bash
MURMUR_PROFILE_DIR="$(mktemp -d)" npm run dev
```

Add `MURMUR_SHARE_MODELS=1` to keep using the models already downloaded, and leave it out to
test the download step.

(Permissions belong to macOS, not to the profile. To see the "not asked yet" state, reset
them as described in `docs/permissions.md`.)

1. The window opens on "Welcome to Murmur", not on the Hub.
2. On each permission step press Allow and answer the macOS prompt, or flip the switch in
   System Settings and return to the window. The badge turns to Granted and Continue
   becomes active.
3. Deny one permission: its step stays, with a warning and a working System Settings button.
4. On "Speech model" press Download and watch the progress reach the end, then "The speech
   model is ready".
5. On "Try it", click the box, hold the key and say a sentence. The words appear and the
   step says "It works".
6. Press Finish. The Hub opens. Quit and start again: the Hub opens directly.
7. Before granting everything, hold the dictation key: the Bar shows the "finish setup"
   message and nothing is recorded.
