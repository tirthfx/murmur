# macOS permissions

Murmur uses four macOS privacy permissions. The Hub shows each one on the Settings page, with its status, a Request button where one is allowed, and a button that opens the matching System Settings pane.

## What each one is for

| Permission       | Used for                                                            | Request button          | Settings pane                                       |
| ---------------- | ------------------------------------------------------------------- | ----------------------- | --------------------------------------------------- |
| Microphone       | Hearing your voice for dictation and meetings                       | Yes                     | Privacy & Security, Microphone                      |
| Accessibility    | Reading the focused app and field, and pasting or typing the result | Yes                     | Privacy & Security, Accessibility                   |
| Input Monitoring | Noticing the dictation shortcut while another app is in front       | Yes                     | Privacy & Security, Input Monitoring                |
| Screen Recording | Capturing other apps' audio during meetings (later milestone)       | No, status only for now | Privacy & Security, Screen & System Audio Recording |

Nothing is requested on launch or when the page opens. Only a click on a Request button asks the OS. Status is read when the Hub starts, when the Settings page opens, and every time the Hub window regains focus, so a switch flipped in System Settings shows up as soon as you come back.

## Status values

`granted`, `denied`, `not_determined` (never asked) and `unknown`. macOS does not tell Accessibility apart between "never asked" and "refused", so a missing grant shows as `denied` ("Not granted"). Screen Recording has no clean state either, so anything but granted shows as `unknown`. Input Monitoring and Microphone report all three states.

## Who gets the permission

macOS attributes a permission to the app responsible for the process that asks, not to the helper binary itself.

- **In development** (`npm run dev`) the responsible app is the Electron binary Forge starts, or the terminal app that launched it (Terminal, iTerm, an editor's terminal). Grant the permission to that app, not to "Murmur". If Murmur's rows stay "Not granted" after you switched something on, you probably switched on the wrong entry. Quit and restart the dev app after granting Accessibility or Input Monitoring if macOS asks you to.
- **In a packaged build** (`npm run build:helper`, then `npm run package`) the responsible app is `Murmur.app`. Its entries appear in System Settings under the name Murmur. The package declares the microphone usage text in its `Info.plist`; without it macOS cannot show the microphone prompt. Rebuilding or re-signing the app can make macOS treat it as a new app, in which case grant again.

## Granting

1. Press Request on the row. Microphone and Input Monitoring show a system prompt. Accessibility shows a prompt that offers to open System Settings.
2. If no prompt appears (it was refused before, or macOS shows it only once), press Open System Settings and switch the entry on.
3. Return to the Murmur window. The status refreshes on focus.

## Resetting for testing

`tccutil reset` clears what you granted so you can see the first-run flow again. It changes your privacy settings, so run it yourself and only for the app you mean to test.

```sh
tccutil reset Microphone            # every app
tccutil reset Accessibility
tccutil reset ListenEvent           # Input Monitoring
tccutil reset ScreenCapture
tccutil reset Microphone <bundle-id>  # one app only
```

Use the bundle identifier of the app that is responsible (for example the terminal's in development). Once the packaged app has an identifier, use that.
