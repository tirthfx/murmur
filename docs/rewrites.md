# Rewrites

Saved instructions that reshape selected text (M3, RW-02 and RW-03). This covers what is
stored and the Rewrites page; running one on a selection is the Rewrite panel (#113).

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

## Benchmark

`node scripts/bench-rewrites.mjs` runs Tighten on 10 sentences (it must come out shorter and
keep every number and name) and Keep tone on 5 sentences with mistakes (it must add no
content words; a spelling fix close to the original word does not count). Needs the model.
