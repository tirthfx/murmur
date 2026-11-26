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
| Speech runtime | Done: whisper.cpp behind `ISpeechEngine`, with live text (above). GPU is open.                                   |
| Paths          | Handled in the protocol (above); app data folders come from Electron.                                            |
| Auto-start     | Handled by Electron's login item setting.                                                                        |
| Packaging      | Installer, cleanup runtime and MCP command done and checked in CI. Signing and the update feed are open.         |

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
`native/helper-win/src/MurmurHelper/bin/{Release,Debug}/net9.0-windows10.0.19041.0/murmur-helper.exe`, or
`MURMUR_HELPER_PATH`; packaged, `resources/helper/murmur-helper.exe`, checked by hash first.

### What is checked, and where

| Check                                                                                       | Where it runs                                  |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Protocol, router, hotkeys, audio session, capture, insertion rules, matching                | Unit tests, every CI run                       |
| The app's conformance suite against the real helper process on the fake OS                  | CI (`helper-win`) and locally with a build     |
| The helper compiles for Windows                                                             | CI (`helper-win`, cross-build)                 |
| The Win32 backends run on Windows (`--self-test`)                                           | CI (`helper-win-native`, a Windows runner)     |
| The conformance suite against the real Windows backends with fixture audio and a text field | Not yet: it needs a Windows 11 desktop session |

### Speech on Windows

`transcribe.load`, `transcribe.unload` and `transcribe.file` are done by whisper.cpp through
Whisper.net (MIT), on the CPU. `SpeechController` in Core holds the rules (one request at a time,
`MODEL_NOT_LOADED`, silence trimmed unless `keepTiming`, no text for a file with no sound, the
choice among several languages, the 20-seconds-per-30 limit); `WhisperEngine` in the Windows
project only turns samples into text behind `ISpeechEngine`. A request that can take long runs on
its own task, so pings are answered while it works.

- **Model.** `WINDOWS_SPEECH_MODEL` (`packages/shared/src/speech-models-windows.ts`) is Whisper
  large-v3 turbo, 5-bit, as one ggml file (about 574 MB) at a pinned Hugging Face revision with its
  size and SHA-256. The app picks the model for the OS with `speechModelFor` and downloads and
  checks it with the same code as the Mac model. The tokenizer folder in `transcribe.load` is
  ignored.
- **Input.** WAV files only (16-bit PCM or 32-bit float, any rate or channel count). The
  helper's own recordings and meeting chunks are WAV. `.m4a` is refused.
- **Languages.** One language forces it; none detects it; several detect it, and if the detected
  one was not chosen the file is decoded again in the first choice.
- **Check.** `--self-test` with `MURMUR_SELFTEST_SPEECH_MODEL` set to a folder holding a ggml
  model transcribes `jfk.wav` (a public-domain recording kept beside the model) and checks the words.
  CI fetches the small English model and that recording
  (`native/helper-win/scripts/fetch-test-model.ps1`, checksummed) and runs it in
  `helper-win-native` and again on the installed helper in `package-win`.
- **Live text.** `transcribe.live` decodes the chunk still being written on a meeting channel (kept in
  memory beside the chunk file, up to the chunk length) and answers with the chunk's number and its
  place on the timeline. Under a second of audio gives no text yet, a channel that is not recorded is
  `NOT_FOUND`, and a request while another speech request runs is `BUSY`, as on the Mac.
- **Not done:** GPU runtimes, and a measured speed and accuracy check of the large model, and of how
  often live decoding keeps up on a real machine.

### Mouse buttons and the clipboard

- **Mouse bindings.** A binding on the middle, back or forward button (protocol buttons 2, 3 and 4)
  works through a low-level mouse hook that shares its thread with the keyboard hook; hold, toggle
  and press modes behave as for a key. Other buttons are rejected with `UNSUPPORTED_TRIGGER`, and a
  mouse binding cannot be exclusive. The helper announces `hotkey.mouse`.
- **Clipboard restore.** A paste saves every format whose data is global memory (text, HTML, file
  lists, bitmaps as DIB, formats apps registered) and puts them back byte for byte. A format that is
  a GDI handle or private to an app cannot be copied (`ClipboardPolicy`); a bitmap or palette comes
  back from a saved DIB. When such a format was there, the rest is restored and the result says the
  clipboard was not fully restored. Over 64 MB the clipboard is not saved. `--self-test` saves and
  restores text, HTML, a DIB and a registered format on a Windows runner.

### Selected text, key presses and apps

- **Selection.** `selection.read` reads the focused element through UI Automation (text pattern); a
  password field is never read. When an element does not say, the helper copies with **Ctrl+Insert**
  and puts the clipboard back. Ctrl+C is not used: in a terminal it would stop the running program
  when nothing is selected. A clipboard that cannot be saved is not copied over. Line ends are
  reported as one character, as on the Mac.
- **Keys.** `keys.press` takes the same list as the Mac and types the Windows shortcut: Command+B,
  I, A and Z become Control; redo is Control+Y; browser back is Alt+Left; Delete is Backspace;
  Command+arrow is Home or End (with Control for the document); Option+arrow moves by word. Held
  modifier keys are let go first, with Control down so no menu opens. Keys Murmur types are marked,
  and its own hooks ignore them.
- **Apps.** An app's id on Windows is its program file name (`chrome.exe`). `focus.app` names the
  app by its program's description, not the window title. `apps.list` reads the Start menu
  shortcuts, so Store apps without one are not listed. `proc.foreground` walks the process table
  under the front window; for `node` or `python` it reports the script or package that runs, never
  the arguments.

### Context, corrections, the inspector and browser pages

- **Context.** `context.snapshot` reads the focused element through UI Automation: whether it takes
  text, and only the characters beside the caret. A password field gives no text. An element with
  no text pattern gives its value, taken as ending at the caret.
- **Corrections.** `edits.watch` reads the same field every half second and sends only the changed
  words, with the Mac's rules.
- **Inspector.** `ax.inspect` walks the window in front, six deep and at most 500 rows.
- **Browser pages.** In Chrome, Edge, Firefox, Brave, Vivaldi, Opera, Arc and Chromium,
  `focus.app` carries the page's host and path, read from the first web document in the window. This
  has not been tried against a real browser.

### Typing counts, media pause and microphone changes

- **Typing counts.** The keyboard hook's key codes are counted as words (Alt Gr types; Control,
  Alt and Windows shortcuts do not). Only the count is sent. As on the Mac, counting sees keys only
  while a binding keeps the hook running.
- **Media.** `media.pause` pauses the first playing session in the system's media transport
  controls and `media.resume` plays only that one. Where the system does not offer the controls,
  playback is reported as unavailable. This needs Windows 10 version 2004 or later, which is the
  helper's target.
- **Microphones.** When inputs change the helper sends the new list; a recording whose device went
  away, or whose capture stopped, carries on into the same file on the chosen device or the default.

- **Elevated programs** do not receive input from a program that is not elevated, so insertion and
  hotkeys do not reach them.

## Packaging on Windows (SW-13)

- `npm run publish:helper:win` makes the helper as one self-contained file (the .NET runtime is
  inside, about 45 MB), so a PC needs nothing installed and one hash covers it. CI runs the packaged
  and installed helper with no .NET runtime reachable. The package
  step puts it at `resources/helper/murmur-helper.exe` with `murmur-helper.exe.sha256` beside it,
  and the app does not start a helper that differs from that hash.
- `npm run make` builds a Squirrel installer (`Murmur-Setup.exe`). It is signed when
  `MURMUR_WIN_CERT_FILE` and `MURMUR_WIN_CERT_PASSWORD` are set; without them it is unsigned,
  which is for testing the installer only and is never distributed.
- CI (`package-win`, a Windows runner) makes the installer, installs it silently, and checks the
  installed helper's hash and `--self-test`.
- **Cleanup model runtime.** The Windows package carries `node-llama-cpp` and the CPU build
  `@node-llama-cpp/win-x64` in `resources/llm-modules`, outside the asar archive, as on the Mac. The
  GPU builds are not shipped. CI loads it with the app's own Node (`getLlama` with `build: "never"`).
- **MCP command.** `resources/mcp/murmur-mcp.cmd` runs `murmur-mcp.cjs` with the app's own Node
  (Electron run as Node), or with `node` when it is not inside an installed app. The local MCP
  server listens on a named pipe, `\\.\pipe\murmur-mcp-<user>`, not a socket file; the script and
  the pipe are tested on Windows in CI. The config Murmur writes names the command in the app's
  current folder, so after an update the owner writes it again (Squirrel keeps a folder per version).
  Claude desktop's config is under `AppData\Roaming\Claude`.
- Not done: signing needs a certificate (the owner's choice and cost); an update feed needs
  somewhere to be hosted, and the update test (install a second version, keep user data) needs that
  feed.

## Still needs a Windows 11 machine

Seeing the Win32 backends work with a person at the keyboard (hotkeys in a real app, paste into
Notepad, Teams and Zoom call detection, loopback audio), signing and the update feed (SW-13), and
a speed and accuracy check of the large speech model.
