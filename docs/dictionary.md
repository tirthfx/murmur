# Dictionary

The personal dictionary (vault spec PZ-01, PZ-03, PZ-04). The Hub's Dictionary page adds,
edits, stars and deletes entries.

## Entries

- **Term** (no replacement): a word or phrase Murmur should spell exactly as saved, for
  example "Kubernetes" or "Priya".
- **Replacement**: what is said or recognised (`k8s`) and what is written instead
  (`Kubernetes`). Whole words only; any case unless "Match case" is on.
- **Starred**: always passed to the speech model, even if rarely used.

Limits: 5,000 entries, 1,000 replacements, 200 starred, terms up to 60 characters.
Duplicates are refused in any case, and the page shows the entry already there. Deleting an
entry used more than 20 times asks first.

## Where it acts in a dictation

1. **Speech prompt.** Starred terms, then the 200 most used, up to about 400 characters, go
   before the text on screen in the speech model's prompt. With terms present, the screen
   text is cut to its last 300 characters, so the prompt stays within the helper's 200
   tokens (the helper keeps the end).
2. **After recognition**, before cleanup: replacements in one pass (the most recently added
   rule wins where two match; output is never replaced again), then exact spellings.
3. **Cleanup** is told the dictionary terms that occur in the text, after the on-screen
   terms, so its guard accepts them.
4. **After cleanup** the spellings are applied again, so the model cannot undo them.

Each entry used in a dictation gets one use, which orders the prompt terms and the
"Most used" sort.

## Learning from corrections

With "Learn from my corrections" on (the default), every insertion is followed by a watch of
the same field for 60 seconds (`edits.watch`). The helper finds the inserted text in the field
and reads the field every half second while it keeps the focus. Once an edit has rested for
1.5 seconds it sends `edits.changed` with only the changed words inside the inserted text,
never the rest of the field. The watch ends when the field loses focus, the minute is up, or
a new recording starts (`edits.cancel`). Secure and read-only fields are never watched.

Main decides what to learn (`dictionary/learn.ts`):

- one to three changed words on each side; punctuation at the ends does not count;
- deletions, and changes that take out more than half of what was inserted, are ignored;
- a change of capitals only ("github" → "GitHub") becomes a term at once;
- any other change becomes a replacement the second time it is seen (counts in
  `learn_candidates`, migration `0007`).

Learned entries have source `auto` and show "Learned" on the Dictionary page, with a Keep
button and a "Learned only" filter.

## Bulk import

Experimental (Settings → Experimental → "Import from a file"). The Dictionary page then takes
a `.txt` or `.csv` file: one word per line, or `spoken, written` for a replacement (a header
row is skipped; quoted CSV fields work). The preview counts new rows, rows already in the
dictionary (skipped) and unreadable rows with their line numbers. Confirming writes every new
row in one transaction, all or nothing, with source `import`. Limits: 1 MB, 5,000 rows, and
the dictionary's own limits. Snippets work the same way (see `snippets.md`).

## Storage

Table `dictionary` (migration `0003_dictionary.sql`), as in the vault's data model.
`scope_team_id` stays null until team dictionaries (M7). Code:
`apps/desktop/src/main/dictionary/` (store and the pure `apply.ts`),
`apps/desktop/src/renderer/hub/DictionaryPage.tsx`.

## Manual test

1. Add "Kubernetes" and dictate "deploy to kubernetes": it is written "Kubernetes".
2. Add `k8s` → `Kubernetes` and dictate "k8s": "Kubernetes". "k8sy" stays as it is.
3. `npm run smoke -- --full` checks a spelling and a replacement with real speech.
