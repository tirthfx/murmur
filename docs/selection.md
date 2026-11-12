# Selected text and key presses

How Murmur reads the text you selected and presses keys in other apps, for Rewrites,
Command Mode and Instruct Mode (M3). Two helper requests do it: `selection.read` and
`keys.press`. Both need Accessibility and never prompt for it. Nothing they read is stored.

## Reading the selection

`selection.read` looks at the focused element in the app in front:

1. A password field gives `secure` and nothing else. Its text is never read or copied.
2. Accessibility is asked for the selected range. If the range is over 8,000 UTF-16 units
   (JavaScript string length), the answer is `too_long` with the length and no text. The text
   is not copied out of the app.
3. Otherwise the selected text comes back as `ok`, with its range in the field and a SHA-256
   hash of its UTF-8 bytes. An empty selection is `empty`.
4. When Accessibility gives no answer (no focused element, no selected-text attribute, or a
   range with no text), the helper copies the selection instead (the copy fallback, on by
   default):
   - It saves the whole clipboard and posts Command+C (with only Command held).
   - It waits up to 250 ms (`copyWaitMs`, 50 to 1,000) for the clipboard to change.
   - It reads the plain text, then puts the saved clipboard back, unless something else
     wrote to it meanwhile.
   - A clipboard that does not change means nothing was selected: `empty`.
   - A copied selection has no range.
5. `clipboardFirstInApps` lists bundle ids where the copy is used even when Accessibility
   answers, for apps whose Accessibility text is wrong (some web editors).

The hash lets main check later that the selection is unchanged before replacing it: read it
again and compare. One read runs at a time (`BUSY` otherwise).

Command+C goes through the app's own copy, so a clipboard manager may record the selection,
unlike text Murmur pastes, which is marked transient.

## Pressing keys

`keys.press` presses one key from a fixed list. Anything else is refused with
`INVALID_PAYLOAD`, by main before sending and again by the helper:

| Key                   | Allowed modifiers           | Used for                                  |
| --------------------- | --------------------------- | ----------------------------------------- |
| B, I, A               | Command only                | bold, italic, select all                  |
| Z                     | Command, with Shift allowed | undo, redo                                |
| Return                | none, or Shift              | press enter, line break in chat apps      |
| Left, Right, Up, Down | any except Control          | moving the caret, extending the selection |
| Left bracket          | Command only                | browser back (Focus Mode)                 |

`repeat` (1 to 200) presses it several times. With `onlyInApp`, nothing is pressed unless
that app is in front, and the answer is `pressed: false`.

## Manual test

1. Grant Accessibility (see `permissions.md`) and start the app with `npm run dev`.
2. In Notes, select a sentence. A Rewrite or a test call to `readSelection()` returns it with
   source `ax`.
3. In Google Docs in Chrome, select text. With Chrome in `clipboardFirstInApps`, it comes
   back with source `clipboard`, and the clipboard holds what it held before.
4. Select 9,000 characters in TextEdit: `too_long`, length 9,000, no text.
5. In a password field: `secure`.
