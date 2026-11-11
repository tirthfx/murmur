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

## Rich text

`insert.text` takes an optional `html` (rich snippets, see `snippets.md`). The helper writes it
beside the plain text in the same pasteboard item, still marked transient. Typed insertion and
apps whose trailing newlines are trimmed get the plain text only.

## Press enter

When a dictation ends with the words "press enter", they are left out of the text and Return
is pressed after it: "Send the file, press enter." inserts "Send the file." and presses
Return. The phrase anywhere else in the sentence is ordinary text. The command is removed
before cleanup, so the cleanup model never sees it. Said on its own, it only presses Return.

Return is pressed 150 ms after the text, and only if the same app is still in front.
Otherwise it is skipped and the Bar says so. The setting "Say press enter to press Return"
turns the command off. History records whether Return was pressed.

## Rules per app

Main sends two lists with every insertion (`apps/desktop/src/main/insertion/app-rules.ts`),
and the helper applies them to the app in front:

- **Terminals** (Terminal, iTerm2, Ghostty, Warp, Alacritty, kitty, WezTerm): newlines at
  the end of the text are dropped, so nothing runs by itself. Return is sent only by the
  "press enter" command. Multi-line text is pasted in one piece; the terminal's own
  bracketed paste keeps the shell from running it line by line.
- **Remote desktop clients** (Microsoft Remote Desktop, Horizon, Citrix, Parallels and
  others): the text is typed and the clipboard is not touched.

Browser address bars and notification reply fields use the normal paste; Return is never
sent there unless asked for by voice.

## Permission

Posting key events needs Accessibility. The helper only reads the status; without it `insert.text` fails with `PERMISSION_DENIED` before touching the clipboard. Main then puts the text on the clipboard with `insert.copy` (no permission needed) and logs that you can paste it yourself. Grant Accessibility from the Hub's Settings (see [permissions.md](permissions.md)).

## Manual test

1. `npm run build:helper`, then `npm run dev`. Accessibility, Microphone and Input Monitoring granted to the app that runs the dev build; speech model downloaded.
2. Copy an image (for example a screenshot with Control+Shift+Command+4).
3. Click into TextEdit, hold Right Option, say a sentence, release. The text appears; the terminal shows `inserted by paste_cmd_v … clipboard restored`. Paste elsewhere: the image is still on the clipboard.
4. Repeat in Notes and in a Safari text field.
5. Dictate, and right after releasing the key copy a word with Command+C: the log says the clipboard was kept, and your copied word stays on the clipboard.
6. Typed fallback: dictate "café, naïve, and a thumbs up emoji" into a Microsoft Remote Desktop session or use `method: "keystrokes"`; accents and emoji arrive whole.
