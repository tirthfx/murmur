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

## The Windows helper (`native/helper-win`)

A .NET 9 program (C#) that speaks the same protocol as the Mac helper over stdin and stdout
(SW-10). It is three projects and a test project:

- `MurmurHelper.Core` has no OS calls. It holds the protocol (envelope, router, handshake), the
  hotkey engine, the microphone session, meeting capture into WAV chunk files, the insertion
  rules, window matching for call detection, and a fake operating system. Everything here is unit
  tested on any machine (`npm run test:helper:win`).
- `MurmurHelper.Windows` has the Win32 calls behind Core's interfaces: Credential Manager, the
  low-level keyboard hook, the clipboard and `SendInput`, `EnumWindows`, WASAPI through NAudio, and
  the output mute switch.
- `MurmurHelper` is the program. `MURMUR_HELPER_FAKE=1` runs it on the fake operating system, and
  `--self-test` runs the real Windows backends once and prints what worked.

`npm run build:helper:win` builds it. In development the app finds
`native/helper-win/src/MurmurHelper/bin/{Release,Debug}/net9.0-windows/murmur-helper.exe`, or
`MURMUR_HELPER_PATH`; packaged, `resources/helper/murmur-helper.exe`, checked by hash first.

### What is checked, and where

| Check                                                                                       | Where it runs                                  |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Protocol, router, hotkeys, audio session, capture, insertion rules, matching                | Unit tests, every CI run                       |
| The app's conformance suite against the real helper process on the fake OS                  | CI (`helper-win`) and locally with a build     |
| The helper compiles for Windows                                                             | CI (`helper-win`, cross-build)                 |
| The Win32 backends run on Windows (`--self-test`)                                           | CI (`helper-win-native`, a Windows runner)     |
| The conformance suite against the real Windows backends with fixture audio and a text field | Not yet: it needs a Windows 11 desktop session |

### What it does not do yet

- **Speech.** There is no speech engine on Windows, so `transcribe.*` is refused as unsupported and
  the helper does not announce those capabilities. A Windows backend (whisper.cpp or ONNX Runtime)
  goes behind the same requests.
- **Mouse bindings.** A binding on a mouse button is rejected (`UNSUPPORTED_TRIGGER`); the key codes
  are virtual-key codes limited to 0 to 127 by the protocol, and the fn key does not exist.
- **Clipboard restore** is for text only. If the clipboard held an image or files, the paste goes
  ahead and the result says it was not restored.
- **Not announced, so refused:** selection read, focus context, accessibility inspect, edit
  watching, typing counts, media pause, process list, installed apps list, live transcription.
- **Elevated programs** do not receive input from a program that is not elevated, so insertion and
  hotkeys do not reach them.

## Packaging on Windows (SW-13)

- `npm run publish:helper:win` makes the helper as one file, so one hash covers it. The package
  step puts it at `resources/helper/murmur-helper.exe` with `murmur-helper.exe.sha256` beside it,
  and the app does not start a helper that differs from that hash.
- `npm run make` builds a Squirrel installer (`Murmur-Setup.exe`). It is signed when
  `MURMUR_WIN_CERT_FILE` and `MURMUR_WIN_CERT_PASSWORD` are set; without them it is unsigned,
  which is for testing the installer only and is never distributed.
- CI (`package-win`, a Windows runner) makes the installer, installs it silently, and checks the
  installed helper's hash and `--self-test`.
- Not done: signing needs a certificate (the owner's choice and cost); an update feed needs
  somewhere to be hosted, and the update test (install a second version, keep user data) needs that
  feed; the cleanup model's runtime and the MCP command are packaged on a Mac only so far.

## Still needs a Windows 11 machine

Seeing the Win32 backends work with a person at the keyboard (hotkeys in a real app, paste into
Notepad, Teams and Zoom call detection, loopback audio), signing and the update feed (SW-13), and
the speech backend.
