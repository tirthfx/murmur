# Platform helper and the platform adapter

The app talks to the operating system through one interface, `PlatformHelper`
(`packages/shared/src/platform-helper.ts`). The Mac implementation launches the Swift helper
and speaks the newline-delimited JSON protocol in `helper-protocol.ts`. A Windows helper is a
separate process with the same protocol (SW-09, SW-10).

## One place knows the OS

`apps/desktop/src/main/platform/index.ts` is the platform adapter. It is the only code that
reads `process.platform`: `hostPlatform()` returns it, and the other functions answer a
question for an OS (default shortcuts, key names, the settings page for a permission, whether
closing the last window quits, whether the tray shows text). Code elsewhere calls these and
never compares the platform itself. `apps/desktop/src/platform-boundary.test.ts` fails when any
other file in the desktop app, or the shared package, reads it.

To add an OS: add its files next to the `mac-*` ones in `main/platform`, return them from the
adapter's functions, and return its helper from `createPlatformHelper`. Nothing else changes.

## The conformance suite

`main/platform/platform-helper-conformance.ts` holds the scenarios every helper must pass:
lifecycle, permissions, hotkeys, insertion, the secure store, the front app, meeting detection,
a microphone session and meeting capture. A scenario talks to the helper only through
`PlatformHelper`. What the helper acts on (a test text field, the front app, a call in a
window, keys pressed) is reached through a `HelperWorld`, so each platform supplies its own.

- `mac-helper-conformance.test.ts` runs the suite on the Mac helper's supervisor with a scripted
  stand-in for the helper process. It runs in CI and checks the app's half of the contract: the
  requests main sends and the replies and events it accepts.
- A Windows run passes a `HelperWorld` that drives a real Windows 11 machine, with fixture audio
  and a real text field. A scenario that cannot run on a platform is named in `skip` with the
  reason; the report shows it as skipped, never dropped.

The scenarios are the acceptance list for SW-10: a Windows helper is done when each passes on
Windows 11.

## Platform neutral parts, done ahead of the Windows helper

- **Paths** in helper requests (`capture.start` folder, the speech model folders, a file to
  transcribe) accept a POSIX path, a Windows drive path or a network share
  (`absolutePathSchema`). A relative path is still refused.
- **Meeting matchers** may carry a `windows` part: process image names and words in the window
  title (SW-12). `matchersForOs` gives a Mac helper `native` and `web`, and a Windows helper
  `windows` and `web`, and drops a matcher with nothing for that OS. The built-in Zoom, Meet
  and Teams matchers have a Windows part; the Teams title words are a best effort, and a
  `meeting-matchers.json` in the profile folder can replace them.
- **Helper hash.** The package step writes `murmur-helper.sha256` beside the helper. At start
  the app hashes the binary and does not launch one that differs; the Hub shows the helper as
  unavailable with the reason. A build with no hash file (development) is not checked.

- **Playback warning (SW-12).** On Windows the system channel is the default output, so it
  records everything playing. The first time that channel starts, the recording carries a
  `system_playback` warning (shown on the Notetaker page) and `notetaker.windowsAudio.warned`
  is set so it is not said again. `notetaker.windowsAudio.warnOnPlayback` turns it off, and
  turning off "record the computer's sound" pauses the channel. `endpoint` is `default` for now.

## Platform differences (SW-11)

| Area           | State                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| Permissions    | Handled: statuses and settings links come from the adapter; a Windows helper reports `granted` or `unknown`.     |
| System audio   | Needs the Windows helper (WASAPI loopback). Limitation to state in release notes: loopback records all playback. |
| Hotkeys        | Needs the Windows helper. Limitation: an elevated app does not receive input from a non-elevated hook.           |
| Insertion      | Needs the Windows helper (UI Automation and paste); terminals that need Ctrl+Shift+V are a helper test target.   |
| Remote desktop | Windows-only test target, after the helper exists.                                                               |
| Secure storage | Needs the Windows helper (Credential Manager); same key shape as the Keychain calls.                             |
| Window titles  | Handled in data: the `windows` matchers above.                                                                   |
| Speech runtime | Open: Windows needs another backend behind the same interface.                                                   |
| Paths          | Handled in the protocol (above); app data folders come from Electron.                                            |
| Auto-start     | Handled by Electron's login item setting.                                                                        |
| Packaging      | Open: installer, signing and update feed need a Windows build machine and a certificate.                         |

## Still needs a Windows 11 machine

The Windows helper itself (language still to choose, C++ or .NET), the conformance suite
passing on it, installer and signing (SW-13) and the
speech backend.
