# Command Mode

Spoken commands that act on selected text (M3, RW-08 and RW-09). An experimental option, off
by default: Settings, Experimental, Command Mode. Raw speech is never inserted in Command
Mode; a command that is not understood changes nothing.

## Two ways to give a command

- **The Command Mode key.** Right Command by default (change or turn it off in the Command
  Mode section of Settings, which appears once Command Mode is on). Select text, hold the key
  on its own, say the command and let go.
  - The key counts only when it is held alone. The binding is `exclusive` (see `hotkeys.md`):
    another key or mouse button pressed during the hold ends it, so Command+C and other
    shortcuts never start a command.
  - The microphone starts only after the key has been held alone for 250 ms, so a tap or a
    quick shortcut never starts a recording. Another key pressed later in the hold discards
    the recording.
- **The wake phrase.** "Hey Murmur" by default, changeable (2 to 40 letters, numbers and
  spaces) and can be switched off. Dictate as usual and start with the wake phrase: the rest is
  taken as a command. The recognised words may differ slightly ("Hey Murmer" works). With
  Command Mode off, or the wake phrase off, it is ordinary text and goes in like any
  dictation.

Both run after the speech model, before cleanup and everything else in a dictation.

## What a command acts on

The selection, read like the Rewrite panel reads it (`selection.md`). With nothing selected,
the last dictation, when all of these hold:

- it went in less than 5 minutes ago, in the app that is in front now;
- context awareness is on, and the text just before the caret ends with it.

Murmur then selects it with Shift+Left (one press per character) and checks that exactly that
text is selected; if not, it puts the caret back and the Bar says "Select text first".

## Commands

The list is fixed (`packages/shared/src/commands.ts`); the Command Mode section in Settings
shows it.

| Kind    | Commands                                                                             | What happens                                                                                |
| ------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Rewrite | shorter, clearer, a list, formal, friendly, translate to a language, fix the grammar | The model rewrites it; the Rewrite panel shows the result before Replace.                   |
| Output  | add a summary below, list the questions                                              | The model writes it; the panel's Insert below puts it under the text.                       |
| Text    | uppercase, lowercase, capitalise, delete, new line, new paragraph                    | Done in Murmur, no model. New line and new paragraph go after the selection, never over it. |
| Keys    | bold, italic, select all, undo, press enter                                          | Command+B, Command+I, Command+A, Command+Z, Return in the app.                              |

"undo that" takes back Murmur's last edit when there is one (see `undo.md`), and presses
Command+Z otherwise.

"delete that" on more than 200 characters asks on the Bar first ("Delete the selected
text?"); no answer within a minute counts as No. After a Yes the selection is read again and
deleted only if it is the very same text.

## Matching

1. **Rules** (`apps/desktop/src/main/commands/match.ts`): polite padding is dropped ("could you
   … please"), then ordered patterns pick the command. A test set of 60 phrases, said
   differently from the catalogue's examples, must match at least 90%; all 60 do.
2. **The model**, only when no rule matches: it gets the list of command ids and may answer
   one id or "none" (`model-match.ts`). Anything else counts as none. 5 s limit.

For translate, the language must be named ("translate to French"); without one the Bar says
"Say which language to translate into".

Benchmark: `node scripts/bench-commands.mjs` (needs the cleanup model) runs 20 phrases that no
rule matches through the model. Measured 2026-11-13 on the default model: 15 of 20 right,
none of the 3 non-commands taken as a command, p50 94 ms per answer.

## Storage

Table `command_runs` (migration 0014): phrase, command id, language, trigger (`key` or
`wake_phrase`), matched by (`rule` or `model`), target (`selection`, `last_dictation` or
`none`), the text acted on and what replaced it, outcome (`replaced`, `keys_sent`,
`inserted`, `copied`, `discarded`, `not_understood`, `no_text`, `failed`), app and time. The
texts are cut to 200 characters after 7 days. Commands that use the model are recorded here,
not in `rewrite_runs`. Nothing said is logged.

## Manual test

1. Turn on Settings, Experimental, Command Mode. The Command Mode section shows Right Command.
2. In Notes, press Command+C and Command+V with Right Command: no recording starts.
3. Select a paragraph, hold Right Command alone, say "make this a list", let go: the Rewrite
   panel shows a bulleted list; Replace puts it in.
4. Select a word, hold Right Command, say "bold that": it turns bold.
5. Select more than 200 characters, say "delete that": the Bar asks first; No keeps the text.
6. Dictate "Hey Murmur, uppercase that" with a word selected: it becomes upper case and no
   text is inserted.
7. Dictate a sentence, then with nothing selected hold Right Command and say "make it
   formal": the sentence is selected and the panel shows the formal version.
8. Turn Command Mode off and dictate "Hey Murmur, hello": the words go in as text.
