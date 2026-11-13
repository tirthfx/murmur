# Instruct Mode

Ask for text without selecting anything first (M3, RW-11 and RW-17): hold the Instruct key,
say what you want written, let go, and a draft appears in a panel near the Bar. Murmur only
drafts. It never sends, schedules or sets anything.

## Using it

- **Key:** Control+Option+I by default, held while speaking. Change or turn it off in
  Settings, Instruct Mode. Another dictation key does not end it.
- **Panel:** shows what was asked, the context chips, and the draft as it streams. Buttons:
  - **Insert:** brings the app back and pastes at the caret. When text was selected, the
    caret is first moved to the end of the selection, so the draft never replaces the text it
    was written from. If the paste fails, the draft is copied.
  - **Copy**, **Regenerate**, **Discard** (Escape too).
- **Requests to act** ("send this to Sam", "schedule a meeting with Priya", "remind me…") still
  get a draft: the message they would send, addressed to the person, never written as a
  confirmation. Under it the panel says "Murmur only drafts text. Nothing was sent, scheduled or
  set." Detection is in `apps/desktop/src/main/instruct/actions.ts`; asking for words about an
  action ("draft a reply…", "write an email to…") is drafting.

Follow-ups, threads and history come in #119; undo in #120; the model choice in #121.

## Context (RW-17)

| Chip            | What                                          | Setting                                         |
| --------------- | --------------------------------------------- | ----------------------------------------------- |
| Selection       | The selected text, as the text to work on     | always, when something is selected              |
| Field text      | Up to 2,000 characters each side of the caret | "Use the field's text"; needs context awareness |
| Memory          | Saved facts that match the request            | "Use Memory"                                    |
| Writing samples | Your writing samples, in email apps only      | "Use writing samples"                           |
| Style           | The category's style preset and notes         | always, when the app has one                    |

A chip appears only for a source that has content and is allowed. Pressed chips are the
sources the draft used; pressing one turns it off (or back on) for this thread and writes the
draft again. A password field is never read. The email profile chip waits for a mail
connector.

The prompt is the generation engine's (`generation.md`) with the kind `instruct` (4,000
tokens, 30 s); field text goes in as reference that is not to be repeated.

## Benchmark

`node scripts/bench-instruct.mjs` (needs the cleanup model): a reply about Thursday must
mention Thursday and no other day, a short one must stay under 40 words, and "send this to
Sam" and a meeting request must give a message to the person with no claim it was done.
Measured 2026-11-13 on the default model: 4 of 4, 0.3 to 0.9 s each.

## Manual test

1. In Mail, open a reply. Hold Control+Option+I and say "draft a reply saying I can do
   Thursday". The panel shows Field text, and the draft mentions Thursday. Insert puts it at
   the caret.
2. Select a paragraph in Notes and say "send this to Sam": a message to Sam with the
   paragraph, and the drafts-only line. Insert goes after the selection.
3. Press the Writing samples chip (in Mail): the draft is written again without it.
4. Turn off "Use writing samples" in Settings: the chip is gone.
5. Escape closes the panel and the app has the keyboard again.
