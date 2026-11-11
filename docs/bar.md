# The Bar

A small floating pill that shows what dictation is doing, and nothing else.

## States

| State        | Shows                                      | Leaves when                                       |
| ------------ | ------------------------------------------ | ------------------------------------------------- |
| `hidden`     | nothing                                    | shown again                                       |
| `idle`       | small mic dot                              | recording starts                                  |
| `listening`  | mic, "Listening", level meter, time        | key released (processing), lock, cancel           |
| `locked`     | lock, "Hands-free", level meter, time      | stop, cancel (hands-free comes in #14)            |
| `processing` | spinner, "Transcribing"                    | text arrives (done), failure (error), cancel      |
| `done`       | check and the word count                   | after 800 ms                                      |
| `warning`    | amber, a message                           | after 3 s, or with the recording if it is running |
| `error`      | red, "Transcription failed. Tap to retry." | a click retries the last recording                |
| `cancelled`  | grey, "Cancelled"                          | after 600 ms                                      |

Warnings while recording (for example "No sound from MacBook Pro Microphone") stay up while the microphone keeps recording, and end with the recording. Other warnings ("No speech detected", "Copied. Grant Accessibility to paste.") last 3 seconds.

The state machine is `apps/desktop/src/main/bar/bar-machine.ts`, a pure function covered by a test of every state and event. Main owns it; the page only draws what it is sent.

## Window

- A second page (`bar.html`) of the same renderer build, with its own preload that exposes only `window.murmurBar`: the current view, levels, drags and clicks. Main accepts those calls only from the Bar page and checks every argument.
- A macOS panel that cannot take keyboard focus, shown without activating Murmur, so the app you are typing in stays in front. It floats above normal windows and appears on every Space.
- Drag it anywhere; the position is saved in `bar-position.json` in the app's data folder, relative to the display, and restored on the next start (back to bottom centre if that display is gone). A press that moves less than 4 points is a click.

## Looking at it without the app

`npx vite --config apps/desktop/vite.renderer.config.ts apps/desktop`, then open `/bar.html` in a browser: outside the app the page shows every state side by side.

## Questions

The `ask` state shows a question with a second line and Save and Dismiss buttons (used by
"remember that", see `memory.md`). The answer comes back on `bar:answer`. A question stays
five minutes, never covers a recording, and a new dictation replaces it. The buttons stop the
pointer from starting a drag.

## Manual test

1. `npm run dev`. The mic dot appears near the bottom centre of the screen.
2. Click into TextEdit and dictate: the pill shows Listening with a moving meter and time, then Transcribing, then the word count, and the text arrives in TextEdit. Typing in TextEdit keeps working the whole time.
3. Drag the pill to a corner, quit and restart: it comes back to the same place.
4. Hold Right Option with the input muted: "No sound from …" in amber after about 3 seconds.
