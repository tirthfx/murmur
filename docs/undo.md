# Undo

Taking back Murmur's own edits (M3, RW-10 and RW-13) without relying on the app's
Command+Z, which many apps do not keep clean for pasted text.

## What can be undone

| From          | Edits recorded                                                                   | How to undo                     | Kept                        |
| ------------- | -------------------------------------------------------------------------------- | ------------------------------- | --------------------------- |
| Command Mode  | case changes, delete, new line and paragraph, Rewrite and output commands put in | say "undo that"                 | last 10, each for 5 minutes |
| Instruct Mode | each Insert                                                                      | Control+Z in the Instruct panel | last 20 while the app runs  |

"undo that" undoes the newest of either kind. With nothing of Murmur's to undo it presses
Command+Z in the app, as before. Key commands (bold, italic, select all, Return) are logged but
cannot be undone by Murmur. Control+Z only works while the Instruct panel is open (Command+Z
there stays the text box's own undo); Undo brings the app back first.

## How it is checked

Each edit keeps the text that was there before, the text Murmur left, and the field's text up
to the caret just after the edit (read through Accessibility; up to 300 characters, or the
whole inserted text). Undo:

1. reads the field again: it must be the same app, not a password field, and the text before
   the caret must still end with that anchor;
2. selects the inserted text with Shift+Left and checks it is exactly that text;
3. pastes the old text over it (or presses Delete when the edit was an insert).

If the field changed, Undo refuses with "Text changed since insert. Undo is not safe." and
nothing is touched. Where the field could not be read (no Accessibility text, context
awareness off, more than 4,000 characters) the previous text is copied instead, with "Undo is
not possible in this field. The previous text was copied."

Undo itself is recorded as a `command_runs` row (command `undo`) for "undo that", and as
`action_taken = 'undone'` on the Instruct request. The stacks live only in memory.

Not built yet: the Bar's last-result Undo button (RW-10), which waits for a Bar tooltip.

## Manual test

1. TextEdit: hold the Instruct key, say "write two lines about rain", Insert. Open the panel
   again (hold the key and speak, or New thread) and press Control+Z: the two lines are gone.
2. Notes, with Command Mode on: select a word, say "uppercase that", then "undo that": the word
   is back exactly as it was.
3. Repeat step 2 but type a letter after the change before "undo that": Murmur refuses and the
   text stays.
