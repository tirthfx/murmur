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

## Threads and follow-ups (RW-12)

The panel is a short chat. Type a change in "Ask for a change", or hold the Instruct key again
while the panel is open: each follow-up changes the current draft. Earlier requests are listed
above the draft. A thread takes 20 requests; after that the panel says "Start a new thread to
keep going." **New thread** clears the panel and waits for a new first request (typed, or said
with the key); its context is read then.

A follow-up sends the current draft as the text, the last 6 turns as the chat, and older
requests as a short list in the instruction (no extra model call to summarise them). The
selection is used for the first request only; the field text, Memory, samples and style stay.
Regenerate and the chips write the last request again and replace its draft.

## Saved threads (RW-14)

Each request and its draft is saved (`instruct_threads` and `instruct_history`, migration
0015), with the app, the time, and what became of the last draft (inserted, copied, discarded,
or not used). The **Instruct** page in the Hub lists threads newest first with a search over
requests and drafts; a thread can be opened to read every turn, its last draft copied, reused
as the start of a new thread in the panel, or deleted, one at a time or all (after a second
click). "Save Instruct threads" (on by default) is on that page.

Once a day, threads older than 30 days lose their text (their requests and drafts are deleted;
the count of requests stays and the page shows "Text removed after 30 days"), and threads
beyond the newest 1,000 are deleted.

Control+Z in the panel takes the last inserted draft out of the app again (see `undo.md`).

## Models (RW-15)

- **Fast:** the cleanup model (Qwen3 4B Instruct), always there.
- **Quality:** Qwen3 8B, 4-bit, 5.0 GB (Apache 2.0; owner's choice 2026-11-13). Never
  downloaded unless asked: Settings, Instruct Mode, Quality model, Download. The file is pinned
  by revision, size and SHA-256 in `packages/shared/src/llm-models.ts`, checked once per run,
  and can be removed again. `npm run model:download -- quality` fetches it from a terminal.
  It runs in its own worker ("Murmur Instruct Quality"), started only when a thread uses it
  and stopped after a while unused, so the cleanup model stays loaded for dictation. Its
  thinking mode is off (`budgets.thoughtTokens: 0`).
- Settings, Instruct Mode, Model picks the model for new threads. The panel's Fast/Quality
  switch applies to the next request and keeps the thread. Without the Quality model the switch
  stays on Fast and says "Download a Quality model in Settings".

## Auto-detect (RW-16, experimental)

Settings, Experimental, "Offer Instruct Mode" (off by default). A dictation that starts like a
request to write ("draft a…", "write an email…", "reply to…", "rewrite this…") asks on the Bar
"Use Instruct Mode for this?" for 4 seconds. Yes sends the words to Instruct Mode as a new
thread; No or no answer inserts them as dictated, and Instruct is never called.

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
mention Thursday and no other day, a short one must stay under 40 words, "send this to Sam"
and a meeting request must give a message to the person with no claim it was done, and the
follow-up "make it shorter" must shorten the same draft and keep Thursday. Measured
2026-11-13 on the default model: 5 of 5, 0.3 to 0.9 s each. `node scripts/bench-instruct.mjs
quality` runs the same checks on the Quality model once it is downloaded.

## Manual test

1. In Mail, open a reply. Hold Control+Option+I and say "draft a reply saying I can do
   Thursday". The panel shows Field text, and the draft mentions Thursday. Insert puts it at
   the caret.
2. Select a paragraph in Notes and say "send this to Sam": a message to Sam with the
   paragraph, and the drafts-only line. Insert goes after the selection.
3. Press the Writing samples chip (in Mail): the draft is written again without it.
4. Turn off "Use writing samples" in Settings: the chip is gone.
5. Escape closes the panel and the app has the keyboard again.
6. After a draft, type "make it shorter" and press Enter: the same draft comes back shorter,
   with the first request listed above it. Hold the key and say "add a thank you": it changes
   again.
7. Open the Hub's Instruct page: the thread is listed; Open shows both turns; Reuse opens the
   last draft in the panel; Delete removes it.
