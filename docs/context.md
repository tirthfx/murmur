# Context awareness

When a dictation starts, Murmur reads the focused text field so the speech model and the
cleanup model can spell names and terms that are already on screen (for example a
colleague's name in a chat).

## What is read

The helper's `context.snapshot` request returns the app name and bundle id, the window
title, the element's role and subrole, whether it is editable, and up to 1,500 characters
before the caret and 300 after. Only that window around the caret is asked for, so a long
document is not copied.

- **Secure fields are never read.** The role and subrole are checked first; for a password
  field the value is never asked for, and the controller blanks any text again before
  replying.
- It needs **Accessibility**, which insertion already needs. Without it the request fails
  with `PERMISSION_DENIED` and dictation goes ahead without context. Nothing is requested.
- Each Accessibility call waits at most 0.25 s, and main waits at most 1.5 s in total, so a
  slow app never delays the text.

## How it is used

- **Speech model:** the last 600 characters before the caret become the decoder prompt
  (`transcribe.file` `prompt`, at most 200 tokens, special tokens removed).
- **Cleanup model:** only single words are passed: capitalised words, words with capitals
  inside (GitHub) and words with digits (v2), at most 30. They are listed in the system
  prompt "for spelling only". The output guard accepts a dictated word replaced by one of
  them, but never an added word, so text on screen cannot make the model write new content.

## What is kept

Nothing. The context lives in memory for one dictation (and its retry) and is dropped
afterwards. It is not in the history table, not in any file and not in the logs; the log
line gives only the app name and the number of characters.

## Setting

"Use the text around the cursor" in Settings (`context.enabled`, default on). Off means no
`context.snapshot` request is made.

## Manual test

1. In Slack or Messages, open a conversation that shows an unusual name.
2. Click into the message box, hold the dictation key and say a sentence with that name.
   The name is spelled as on screen.
3. Click into a password field and dictate: the log shows `secure field, nothing read`.
4. Turn the setting off and repeat step 2: the log shows `context: none`.
