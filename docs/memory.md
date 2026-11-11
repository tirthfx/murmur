# Memory

Memory (vault spec PZ-18, PZ-19): short facts the cleanup model may use, for example "Sign
emails as Tirth" or "The office is in Pune". Managed on the Hub's Memory page. Everything
stays in the local database.

## Facts and keywords

Each fact has keywords: typed by the owner (comma-separated), or picked from the fact (words
of four or more letters that are not common words, at most eight). A fact is given to the
cleanup model only when one of its keywords occurs, as whole words, in the dictation or in
the text on screen. At most 20 facts and about 3,200 characters go into one dictation, best
match first. Turning Memory off (Hub, "Use Memory") removes facts from every prompt.

Facts go into the system prompt as one line after the fixed part and the style line, worded
so the model uses them only to spell and word the text, never to add them. The output guard
still refuses added words.

Limits: 200 facts, 300 characters each.

## "Remember that" by voice

A dictation that starts with "remember that" is not inserted. The Bar asks "Save to Memory?"
with the fact underneath and Save and Dismiss buttons. Nothing is saved without Save. The
question goes away after five minutes, and a new dictation replaces it. Turn this off with
"Save facts by voice". The history row for such a dictation is empty.

## Storage

Table `memory_items` (migration `0006_memory.sql`), from the data model's proposed additions,
with `keywords_json` added. Settings key `memory.flags` holds the two switches. Code:
`apps/desktop/src/main/memory/`, `apps/desktop/src/renderer/hub/MemoryPage.tsx`.

## Manual test

1. Add "Sign emails as Tirth" with keyword "sign off". Dictate "time to sign off": the log
   (with `MURMUR_LOG_TRANSCRIPTS=1`) shows the cleanup ran; the text is not changed by the
   fact.
2. Dictate "Remember that I prefer metric units": the Bar asks; nothing is typed. Choose Save:
   the fact appears on the Memory page.
3. `npm run smoke -- --full` checks step 2 with real speech.
