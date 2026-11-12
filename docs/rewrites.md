# Rewrites

Saved instructions that reshape selected text (M3, RW-01 to RW-03): what is stored, the
Rewrites page, and the Rewrite panel that runs them on a selection.

## Built-ins

Five come with Murmur, defined in `packages/shared/src/rewrites.ts` in our own words:

| Name      | Key         | What it does                                                                  |
| --------- | ----------- | ----------------------------------------------------------------------------- |
| Clarify   | `clarify`   | Rewords so the meaning is clearer, keeping facts and names.                   |
| Tighten   | `concise`   | Makes it shorter, removing repeats and filler, keeping every fact and number. |
| Keep tone | `keep_tone` | Fixes spelling, grammar and punctuation only.                                 |
| Structure | `structure` | Adds headings, bullets or numbered steps without new content.                 |
| Reorder   | `reorder`   | Puts sentences or points in a more logical order.                             |

They start on, in that order. They can be switched off, moved and duplicated, but not
edited or deleted. Each time the app opens, their names and instructions are refreshed from
the code, so a new app version brings new wording; the owner's switches and order stay.

## Custom Rewrites

A name (up to 40 characters, unique ignoring case), an instruction (up to 1,000), and an
optional example of the result (up to 1,000). At most 50. They can be edited, duplicated,
switched off, moved and deleted. A duplicate is placed right after its source and named
"… copy". The instruction always runs after Murmur's own rules (see `generation.md`), so it
cannot ask the model to drop names or numbers.

## Storage

Table `rewrites` (migration 0011), with the data model's column names (`prompt`,
`builtin_key`, `shortcut`, `auto_apply`, `auto_apply_min_words`, `sort_order`,
`use_count`) plus `example`, `enabled`, `apply_directly` and
`auto_apply_categories_json`. Shortcuts (#114) and auto-apply (#116) use the columns already
there. Built-in rows have ids `builtin:<key>`.

## The Rewrite panel

Select text in any app and press the Rewrite shortcut (Control+Option+R by default; change
or turn it off under Settings, Dictation). The shortcut is a `rewrite` hotkey binding with
the reserved `rewriteId` `panel`, so the helper needs nothing new.

1. Main reads the selection (`selection.read`, see `selection.md`). In browsers the copy is
   used first, because web editors such as Google Docs report the wrong selection through
   Accessibility. Nothing selected, over 8,000 characters, or a password field: the Bar says
   so and no panel opens.
2. The panel opens near the Bar (above it, or below when there is no room) with the enabled
   Rewrites. Type to filter, Up and Down to move, Enter to choose. Escape closes.
3. The result streams in ("Loading model…" first if the model is not loaded). Then:
   **Replace** (Enter), **Copy**, **Regenerate**, **Try another**, **Discard**.

The panel takes the keyboard for the filter. Closing it brings the app with the selection
back to the front. **Replace** does more:

1. hides the panel and brings the app back
2. reads the selection again and compares its SHA-256 with the one read at the start
3. if the text changed, nothing is pasted: "Selection changed. Copy instead?"
4. if another app is in front, the result is copied instead and the Bar says so
5. otherwise the result is pasted over the selection, with the clipboard restored

The prompt gets the app's style notes, Memory facts that match the text (when Memory is on),
and, in Email apps only, up to two writing samples. See `generation.md` for the engine.

Each closed session with a result is stored in `rewrite_runs` (migration 0012): Rewrite,
source text, result, outcome (`replaced`, `copied`, `discarded`, `failed`), app and time. The
source text is cut to its first 200 characters after 7 days, at start and once a day.

### View changes

On a result, **View changes** (or Control+Option+D while the panel has the keyboard) shows
the result with the words that were removed struck through and the words added marked,
and a count ("4 words removed, 2 added"). **Show result** goes back. The diff is word by
word (Myers' method over words and punctuation, in
`apps/desktop/src/renderer/rewrite/word-diff.ts`), after the shared start and end are set
aside. When both texts together are over 20,000 characters, or they differ in more than
1,500 places, only the counts are shown. The colours are set in `rewrite.css` for light and
dark, and a test checks they reach 4.5:1 contrast. Opening the changes of an earlier result
waits for the History page (M4), which can use the same view and `rewrite_runs`.

### A Rewrite's own shortcut

Any enabled Rewrite can have its own shortcut (at most 20), set on the Rewrites page. It is
checked against Push to talk, Hands-free, the Rewrite shortcut and every other Rewrite's, in
both directions, and needs a letter or number key (a modifier on its own cannot run a
Rewrite). It is a `rewrite` hotkey binding whose `rewriteId` is the Rewrite's id, sent to the
helper with the others and refreshed when a Rewrite is switched, deleted or given a new
shortcut. A switched-off Rewrite keeps its shortcut but is not bound.

Pressing it runs that Rewrite on the selection without the list:

- **Apply directly** (on by default): no panel. When the result is ready, the selection is
  read again; if it is the same text in the same app, the result replaces it and the Bar says
  "Replaced". If it changed meanwhile, the result is copied and the Bar says so.
- Apply directly off: the panel opens on the streaming result, as if the Rewrite had been
  chosen from the list.
- Nothing selected, too long or a password field: the Bar says so, as for the panel.

Shortcuts are stored in `rewrites.shortcut` in one form (key code and sorted modifiers), so
the table's unique index also catches two Rewrites with the same keys.

### Auto-apply

A Rewrite can run on every dictation, after cleanup and before the email steps (translation,
style rules, signature). Set on the Rewrites page, per Rewrite:

- **Apply to every dictation**: off by default.
- **Minimum words**: dictations shorter than this go in without it (default 0).
- **In these apps**: Personal, Work, Email, Other (default all four). Developer apps never get
  it, so code is not rewritten.

Only one Rewrite runs per dictation: the first auto-apply one in the list. The page says which
one runs instead when another is earlier. The Rewrite has 3 seconds, model load included; if
it is not done, the cleaned text goes in and the Bar says "Rewrite skipped (slow)". A failure
says "Rewrite skipped". History records which Rewrite ran and how
(`auto_rewrite_id`, `auto_rewrite_status`), and the texts go into `rewrite_runs`. Dictations
that become several messages or contain snippets are not rewritten.

### Manual test

1. In Notes, select a sentence with a number and press Control+Option+R.
2. Type "tig", press Enter: Tighten streams a shorter sentence with the same number.
3. Press Enter: the sentence is replaced, and the clipboard holds what it held before.
4. Select text again, run Clarify, then click into Notes and change the text before
   pressing Replace: the panel says the selection changed and offers Copy.
5. In Google Docs in Chrome, select a paragraph and run Keep tone; Replace works there too.
6. Press the shortcut with nothing selected: the Bar says "Select some text first".
7. On the Rewrites page, give Tighten Control+Option+T. Select a sentence in Notes and press
   it: the sentence is replaced and the Bar says "Replaced". Try Control+Option+R for another
   Rewrite: it is refused, naming the Rewrite shortcut.
8. Turn off Apply directly for Tighten and press Control+Option+T again: the panel opens on
   the result.
9. Turn on Apply to every dictation for Tighten, with minimum words 5 and only Work. Dictate
   a long rambling sentence into Notes (Work): a tighter version goes in. Dictate four words:
   they go in as cleaned. Dictate into Messages (Personal): no Rewrite.
10. On a result, click View changes (or press Control+Option+D): removed words are struck
    through, added ones marked, with the counts. Check it in light and dark mode.

## Benchmark

`node scripts/bench-rewrites.mjs` runs Tighten on 10 sentences (it must come out shorter and
keep every number and name) and Keep tone on 5 sentences with mistakes (it must add no
content words; a spelling fix close to the original word does not count). Needs the model.
