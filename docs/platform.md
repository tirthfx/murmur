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

## Known gap for Windows

`capture.start` takes a `folder` that must start with `/`, which a Windows path does not. The
protocol needs a platform-neutral absolute-path check (a protocol version bump) before the
Windows helper can record a meeting.
