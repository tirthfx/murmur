# Text insertion

How finished text gets into the app you are typing in.

## Flow

After a recording is transcribed, main sends `insert.text` with the text (method `auto`, restore on, 350 ms). The helper:

1. Saves the whole clipboard: every item with every type it carries (text, rich text, images, files).
2. Puts the text on the clipboard, marked with the `org.nspasteboard.TransientType` and `org.nspasteboard.ConcealedType` types so clipboard managers skip it.
3. Posts Command+V (with only Command held, whatever keys are physically down).
4. Waits 350 ms, then restores the saved clipboard, but only if the clipboard has not changed since step 2. A copy you make during the wait is kept.

If Command+V cannot be posted, the clipboard is put back at once and the text is typed instead: Unicode key events in pieces of at most 20 UTF-16 units (a character such as an emoji is never split), 4 ms apart, each piece retried once. `auto` types straight away in remote desktop apps, where paste does not reach the remote side.

Empty text does nothing. One insertion runs at a time.

## Permission

Posting key events needs Accessibility. The helper only reads the status; without it `insert.text` fails with `PERMISSION_DENIED` before touching the clipboard. Main then puts the text on the clipboard with `insert.copy` (no permission needed) and logs that you can paste it yourself. Grant Accessibility from the Hub's Settings (see [permissions.md](permissions.md)).

## Manual test

1. `npm run build:helper`, then `npm run dev`. Accessibility, Microphone and Input Monitoring granted to the app that runs the dev build; speech model downloaded.
2. Copy an image (for example a screenshot with Control+Shift+Command+4).
3. Click into TextEdit, hold Right Option, say a sentence, release. The text appears; the terminal shows `inserted by paste_cmd_v … clipboard restored`. Paste elsewhere: the image is still on the clipboard.
4. Repeat in Notes and in a Safari text field.
5. Dictate, and right after releasing the key copy a word with Command+C: the log says the clipboard was kept, and your copied word stays on the clipboard.
6. Typed fallback: dictate "café, naïve, and a thumbs up emoji" into a Microsoft Remote Desktop session or use `method: "keystrokes"`; accents and emoji arrive whole.
