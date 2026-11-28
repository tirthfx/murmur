# The platform helper

The app talks to macOS through one interface, `PlatformHelper`
(`packages/shared/src/platform-helper.ts`). The implementation launches the Swift helper
(`native/helper-mac`) and speaks the newline-delimited JSON protocol in `helper-protocol.ts`.
Everything else about macOS in main (key codes and names, default shortcuts, the System Settings
links, bringing an app forward) is in `apps/desktop/src/main/platform`.

## The conformance suite

`main/platform/platform-helper-conformance.ts` holds the scenarios the helper must pass:
lifecycle, permissions, hotkeys, insertion, the secure store, the front app, meeting detection,
a microphone session and meeting capture. A scenario talks to the helper only through
`PlatformHelper`. What the helper acts on (a test text field, the front app, a call in a
window, keys pressed) is reached through a `HelperWorld`.

`mac-helper-conformance.test.ts` runs the suite on the helper's supervisor with a scripted
stand-in for the helper process. It runs in CI and checks the app's half of the contract: the
requests main sends and the replies and events it accepts.

## Helper hash

The package step writes `murmur-helper.sha256` beside the helper. At start the app hashes the
binary and does not launch one that differs; the Hub shows the helper as unavailable with the
reason. A build with no hash file (development) is not checked.

## When the helper is given up on

After three restarts in a minute the app stops trying. The Hub then shows a banner on every page
with Retry, which starts the helper again.
