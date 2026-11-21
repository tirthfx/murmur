# Notetaker

Meeting notes (M5). This page grows as each part lands. Spec: vault `02 Spec/20 Notetaker`.

## Recording (NT-04)

A meeting is recorded as two channels:

| Channel  | What it holds                              | How                                             |
| -------- | ------------------------------------------ | ----------------------------------------------- |
| `mic`    | Your microphone (the owner)                | Its own AVAudioEngine, so dictation still works |
| `system` | Everything the Mac plays: the other people | ScreenCaptureKit, audio only                    |

**Files.** The helper writes each channel in chunks (30 s by default, `notetaker.chunkSeconds`), AAC in `.m4a`, 16 kHz mono at 32 kbps:

```
<data>/Murmur/meetings/<meetingId>/mic-000001.m4a
<data>/Murmur/meetings/<meetingId>/system-000001.m4a
```

A chunk is written as `<name>.partial.m4a` and renamed when it is closed, then reported with `capture.chunk` (path, bytes, SHA-256, where it starts on the meeting's timeline, its length). Main stores each one in `meeting_audio_chunks` as it arrives, so a crash loses at most the chunk being written. Each container adds about 24 KB, so a 30 s chunk is roughly 140 KB.

**Keeping the channels on one timeline.** A channel that falls more than 1.5 s behind the wall clock (a device switch, a stream that sends nothing) is filled with silence, and both are filled to the end when the recording stops. Both channels therefore last as long as the meeting.

**Protocol.** `capture.start` `{meetingId, folder, channels, chunkSeconds, micDeviceId}` answers with the channels that started and any warnings; `capture.stop` `{meetingId}` closes the last chunks (their `capture.chunk` events come first) and answers with per-channel totals. `capture.level` comes about five times a second per channel; `capture.error` reports `device_lost`, `sck_stream_stopped` or `write_failed` and the recording goes on. Fixture: `packages/shared/protocol-fixtures/meeting.capture.json`.

**Permissions.** The microphone is required. The Mac's sound needs Screen Recording (System Settings, Privacy & Security, Screen & System Audio Recording). Murmur only reads its status and never asks: without it the meeting records your microphone only and shows a warning. If the stream stops part way (permission removed), the microphone keeps recording.

**Devices.** The meeting uses the dictation microphone setting (Auto means the system default). If that device goes away, recording carries on with the default input and the meeting is marked `device_lost`.

**Meeting rows.** `meetings` holds the title, start and end, status (`recording`, then `queued` for transcription), channels, warnings and the folder. A recording that saved no audio is not kept. At start, a meeting a crash left as `recording` is ended where its saved audio ends, its `.partial` files are removed, and it is marked `interrupted`. Quitting Murmur stops a recording first, so its last chunk is stored.

**Indicator.** While a meeting records, the menu bar shows a red dot and the time, the tray menu shows "Recording a meeting" with Stop, and the Bar shows a red dot in every state (and "Meeting" with the time when it is otherwise idle).

**Starting and stopping.** From the Notetaker page (Record a meeting, Stop) or the tray menu.

**Sleep.** When the Mac goes to sleep during a recording, the recording is stopped cleanly (its last chunk is closed and stored) and the meeting is marked `sleep`. It is not resumed on wake; start a new recording to carry on.

**Deleting.** Settings, Data and Privacy, Delete data: "Meetings and their recordings" removes every meeting row, its chunk rows and the `meetings` folder. "Delete all data and reset" includes it.

## The Notetaker page (NT-10)

The Hub's Notetaker page (after Dictation in the sidebar) lists meetings newest first with their state: Recording, Waiting for the speech model, Transcribing (parts done of all), Ready, or Transcription failed. Record a meeting starts one and opens it; while it records the page shows the time and Stop.

A meeting opens with its title (renamed in place; a rename is kept from then on), date, length, channels, any warnings (a missing Screen Recording grant has a button to its settings), and six tabs:

| Tab        | Holds                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| My notes   | Your own Markdown notes, saved 2 s after typing stops and when you leave the box (200 KB limit)             |
| Summary    | Empty until summaries are built (#187)                                                                      |
| Transcript | Final lines with time and speaker (You for the microphone, Remote for the Mac's sound), then grey live text |
| Tasks      | Empty until task extraction is built (#189)                                                                 |
| Brief      | Explains that briefs need a connected calendar (M6)                                                         |
| Docs       | Links (http and https only) and files, copied into the meeting's `docs` folder with a SHA-256               |

The tab last used is remembered per meeting in the window's local storage; otherwise My notes opens while recording and Transcript after. Lines from a dictation made during the meeting are not shown (#197 adds the switch). Delete removes the meeting, its transcript, notes, docs and audio folder; a meeting being recorded cannot be deleted. Main tells the page about changes (`meetings:changed`) and new live text (`meetings:live`).

Notes and docs are in `meeting_notes` and `meeting_docs` (migration 0027). A link's title is what you type, or its host; Murmur does not fetch pages.

## Live text (NT-06)

While a meeting records, main asks the helper again and again (`transcribe.live`) to decode the chunk still being written on each channel in turn, with a one-second pause between rounds. The text shows grey and is replaced by the final lines when that chunk closes and is transcribed by the queue (each closed chunk is queued at once, so final text trails the live text by about one chunk). A live decode waits behind any dictation, and none starts while a dictation runs. Under a second of audio is answered at once with no text. `notetaker.live` turns it off.

With 30 s chunks a live decode covers up to 30 s of audio. On an M-series Mac with the default model that takes well under a second, so text appears a few seconds after it is spoken.

## Transcription (NT-05)

A finished recording gets a `transcribe` job in `meeting_jobs`. The queue runs in main, one job at a time:

- Each chunk not yet transcribed (`meeting_audio_chunks.transcribed_at` is empty) goes to the helper's `transcribe.file` with `keepTiming: true`, in timeline order across both channels. With `keepTiming`, the helper reads `.m4a`, does not trim silence (so segment times match the file), and returns no text for a chunk with no sound at all, since the model invents words in silence.
- The segments are moved onto the meeting's timeline (chunk start plus segment time) and written to `meeting_segments` with the chunk mark, in one transaction. Segment ids come from the chunk, so a chunk written twice adds nothing. Sound labels such as `[Music]` are dropped.
- **Offline:** transcription needs only the local speech model. With no model, or while it loads, the job stays queued and the meeting shows `queued`; the queue looks again every 15 seconds and runs with no action from you once the model is ready. A model that goes away mid-job pauses it; the next run carries on from the next chunk.
- **Dictation first:** the helper decodes one file at a time. A dictation waiting is always decoded before the next meeting chunk, and the queue does not start a chunk while a dictation is recording or being transcribed.
- **Failures:** a chunk file that is gone is skipped. Any other error is retried on the next run; after three failed runs the job and the meeting are marked `failed`.
- **Status:** `recording`, then `queued`, `processing` while the job runs, and `ready` when every chunk is done.
- **After a crash:** jobs left `running` are queued again at start, and a meeting waiting for its transcript with no job gets one.

### Manual test

1. `npm run build:helper`, then `npm run dev`.
2. Tray: Record a meeting. The menu bar shows a red dot and the time; the Bar shows a red dot.
3. Play a video with sound and speak for a minute, then Stop recording the meeting.
4. In `<data>/Murmur/meetings/<id>/` there are `mic-*.m4a` and `system-*.m4a` files, and no `.partial` files. `afinfo` on one shows AAC, 16000 Hz, 1 channel.
5. Remove Screen Recording for Murmur in System Settings and record again: only `mic-*` files, and the meeting carries the `system_permission` warning.
6. Transcription: after stopping, the log shows the job; in the database, `meeting_segments` holds the lines with times on the meeting's timeline and the meeting is `ready`. Move the speech model folder away, record again: the meeting stays `queued`; put the folder back, restart Murmur, and it is transcribed with no action.

## Starting and stopping (NT-03, NT-25)

A recording starts from the Notetaker page, the tray menu or a global shortcut, and all three go through one starter (`meetings/meeting-starter.ts`). The shortcut is **Meeting recording** in Settings, Shortcuts. It is unset by default and is checked like the other shortcuts: it cannot repeat a key Murmur already uses (push to talk included) and a modifier alone is refused. A press starts a recording when none runs and stops it when one does. It is its own binding (`notetaker.start`, a press), so a dictation hold cannot start a recording. With the notice off, the press goes straight to `capture.start`.

Clicking the red recording indicator on the Bar opens the Notetaker page, where Stop is. The Bar never stops a recording by itself.

**Recording notice.** Settings, System, Recording notice: the first time only (default), before every recording, or never. The notice is a native dialog written by Murmur ("Recording this meeting. Tell the other participants ..."), so it also shows when the Hub is closed. With "before every recording", or "the first time" until it has been accepted once, `capture.start` is not sent until the owner presses OK; Cancel starts nothing. The acceptance time is stored on the meeting (`consent_ack_at`). The recording indicators are shown whatever the setting says. Murmur gives no legal advice.

**Titles.** A recording is called "Meeting, <date time>". A rename marks the title as edited; `setGeneratedTitle` (used by the summary, a later issue) never replaces an edited title.

Not built yet: the calendar line in event descriptions (M6), `notetaker.titleFormat`, and the suggested shortcut in first-run setup.

Manual check: set a shortcut, press it with the notice on "Before every recording" and confirm the dialog comes first and nothing records until OK; press it again to stop; click the red dot on the Bar.

## Meeting detection (NT-01)

Murmur can notice a call in Zoom, Google Meet or Microsoft Teams and ask if you want to record it. Settings, System, Meeting detection: detection on or off (default on), a switch per app, "Record detected meetings without asking" (default off), and the apps set to "Never".

**How it works.** With detection on, main sends `detect.subscribe` to the helper with the matchers. The helper looks every 2 seconds at the windows of those apps through Accessibility and sends `detect.event` `{matcherId, active}` when a call starts or ends. It never sends a window title or a page address. With detection off (or every app off or set to Never), no `detect.subscribe` is sent at all; a stop is sent only after a start; a helper that restarted is told again.

**What counts as a call.** A native app (Zoom, the Teams app) has a window whose title has one of the matcher's words. A web app (Meet, Teams in a browser) is in the tab a browser window is _showing_: the host, and for Meet a call path such as `/abc-defg-hij`, must match. A call in a background tab is not showing, so it never matches. Where the address cannot be read, a matcher with title words falls back to the window title alone; one without does not match.

**Matchers are data.** The built-in list is in `packages/shared/src/detect.ts`. A file `meeting-matchers.json` in Murmur's profile folder (a list of matchers) replaces it, so an app can be added or a title fixed without a new release. A file that is not valid is ignored and said so in the log. The Teams title words ("Meeting with", "Meeting in", "Call with") are a best effort and have not been checked against a real Teams call.

**The prompt.** After the call has been seen for 2 seconds, the Bar asks "Record this meeting?" with Record, Not now and Never (for this app). After 20 seconds it counts as Not now. Not now asks nothing more until that call ends. Never adds the app to the list in Settings, where "Ask again" removes it. Nothing is asked while a recording runs or a dictation is recording. Record goes through the same starter as the shortcut, so the recording notice still applies.

**Ending.** A recording Murmur started for a call stops 60 seconds after the call ends, unless the call comes back. A recording you stop yourself is not started again for that call.

Needs the Accessibility permission (the same one dictation uses). Detection reads window titles and pages only for the call apps and only on this Mac.

Manual check: join a Zoom call (the prompt comes within a few seconds); open a Meet call in a background tab (no prompt), then show the tab (prompt); choose Never and check Settings; turn detection off and check nothing prompts; leave the call and check the recording stops within a minute.

## Skills and summaries (NT-09, NT-15)

**Skills.** A Skill is a name, a description, the sections of its output, a length and a prompt (`packages/shared/src/skills.ts`). Murmur ships 12 built-in Skills, written for Murmur: Meeting summary (the default), Action review, Follow-up note, Customer call notes, Product spec draft, Decision record, One-to-one prep, Interview debrief, Stand-up update, Weekly digest, Email reply draft and Next meeting agenda. Built-ins are read-only. Custom Skills are described below.

**Custom Skills (NT-16).** The Notetaker page has two tabs, Meetings and Skills. On Skills the owner reads the built-ins, makes a new Skill, duplicates any Skill ("Name (copy)"), edits a custom one, exports one as a `.md` file, imports one, and deletes a custom one (a second click confirms). If the deleted Skill was the default, the default goes back to Meeting summary; summaries already written keep the Skill's name.

- **Versions.** Saving a custom Skill that changed makes its next version (table `skills`, column `version`) and keeps the one it had in `skill_versions`. Saving what is already there makes nothing. "Go back to this" on an earlier version makes it the current text as a new version, so the history is never lost. A summary names the Skill, not its version.
- **Copies of built-ins.** A copy remembers the built-in and the version it had (`based_on`, `based_on_version`). When a later Murmur raises that built-in's version, the copy shows a "New version" badge and a note. (Built-ins are all at version 1 today.)
- **Files.** A custom Skill is also written, on every save, to `<data>/Murmur/Skills/<name>-<first 6 of id>.md`, so the folder can go into version control; renaming moves the file and deleting removes it. The folder is a copy for the owner: Murmur does not read it back. Import goes through the Import button.
- **File format** (`packages/shared/src/skill-file.ts`): a front-matter block between two lines of `---`, then the prompt.

  ```
  ---
  name: Customer call notes
  description: Problems, asks and commitments.
  length: medium
  sections:
    - Problems raised
    - What they asked for
  ---
  Write notes of a call with a customer...
  ```

  `sections` may also be written `[One, Two]`. Values may be in single or double quotes. `version` and `model` are allowed and ignored. A file with bad front matter is refused and the message names the line (`Line 4: The length must be one of: short, medium, long.`): a missing or unclosed `---`, a line that is not `key: value`, an unknown or repeated field, a bad length, no name, no sections, an empty prompt, or a value over the limit (name 80, description 300, a section 60 and at most 12, prompt 4,000 characters). An imported Skill is always a new custom Skill at version 1.

**Summaries.** Once a recording has been transcribed, a `summarise` job in the meeting queue writes a summary with the default Skill (Settings, System, Meeting summaries: on or off, length, which Skill). The Summary tab shows the newest version, a version picker, a Skill picker with "Write a new version" (another Skill, or the same again, adds a version and keeps the old ones), and thumbs with a reason (missed points, wrong names, too long, too short). While a meeting records, "Quick summary so far" summarises what is transcribed; it is labelled Quick and the final summary replaces it. A summary row keeps the Skill and the model.

**How it is written** (`meetings/summarizer.ts`).

- The transcript is lines `[12:34] Owner: text` and `[12:34] Remote: text`. The owner's notes go in too (up to 6,000 characters).
- About 3,000 tokens or less (counting 3.5 characters to a token) goes to the model once. A longer meeting is cut into parts of about 2,500 tokens with 200 tokens of overlap, each part is noted on its own (map), the notes are merged, and merged again while they are too long (reduce), and then the sections are written. Every call stays within the smallest model context (4,096 tokens). A 60-minute fixture is a test.
- The model is asked to end each bullet with the time in square brackets. The answer is then **checked**: the Skill's sections are kept in order and anything else is dropped; a time that matches a transcript line (the nearest within 10 seconds) becomes a link `[12:34](seg:<segment id>)`; a time that matches nothing is dropped; a bullet with no link at all ends in "(No source)". A section the model left empty reads "Not discussed". If the answer filled the whole token room it is asked again with fewer bullets, and sections it still never reached read "Not written: the summary ran out of room" and not "Not discussed".
- Clicking a link opens the Transcript tab at that line. The page renders only text, headings, bullets, bold and these links: no HTML from the model is shown.

**The model is shared.** A summary never starts while a dictation is recording or being transcribed, and never while a Rewrite, Command or Instruct generation is running (the newest generation would cancel it). A step the model dropped for another request is asked again (up to 8 times). Without the language model, the job waits and runs when it is downloaded, with no action from the owner.

`npx vite-node scripts/bench-summary.mjs` runs the summary on the real model with a made-up meeting (short and long) and reports time, links and sections. Needs the model.

Manual check: record or open a meeting with some talk, wait for the summary (or press "Write a summary"), click a time and check the transcript opens at that line, write another version with a different Skill and check both are in the picker, give a thumbs down with a reason, turn the automatic summary off in Settings.

Manual check (Skills): open Notetaker, Skills, duplicate Action review, change the prompt and save, check "Version 2, 1 earlier" and go back to the first; export it, delete it, import the file and check it comes back; edit the exported file to `length: huge` and check the import names that line; look in the Skills folder for the `.md` files.

## Tasks (NT-26)

**What.** After a meeting is summarised, an `extract_tasks` job asks the local model for the tasks in it and adds them to My Tasks as **Suggested**. Nothing is accepted for the owner. With the summary turned off, the job runs after the transcript instead. Settings, System, Tasks from meetings: suggest tasks on or off, and which owners My Tasks shows to begin with (me or a named person, or all). `notetaker.tasks.maxPerMeeting` is 15 and has no control.

**How** (`meetings/tasks-extractor.ts`, `tasks-runner.ts`).

- The transcript goes in as for a summary (`[12:34] Owner: text`, `Remote:`), whole or in parts of about 2,500 tokens with 200 of overlap, with the meeting's date.
- The model answers JSON only: `{"tasks":[{"title","owner","due","time"}]}`. The answer is **checked**: it must parse, `tasks` must be a list, every task needs a title. An invalid answer is asked for once more, with fewer and shorter tasks (the first may have run out of room); if that is invalid too, the meeting gets **no tasks**, the job ends `done`, and its `last_error` says why. Invalid JSON never creates a row. A meeting is all or nothing.
- `owner` "me" (the Owner line took it on) becomes "mine"; a name is kept; "someone", "unknown" and the like become nobody. `time` is matched to the nearest transcript line within 10 seconds and kept as the task's source; no match, no source.
- `due` is the day as it was **said** ("Wednesday", "the 27th", "Nov 27", "tomorrow"). Code works out the date from the meeting's date (`resolveDue`): a weekday is the next one after the meeting's day; a day of the month is the next such day; a time length ("in 3 days") and anything not English give no date. A written `YYYY-MM-DD` is kept if it is not before the meeting. A real-model run showed the model gets weekdays wrong, which is why it does not count days.
- A task whose title matches one the meeting already has (any state) is skipped, so asking again adds only new ones.
- The same model queue as summaries (`model-ask.ts`): a dictation first, never cancelling a Rewrite, Command or Instruct generation, a dropped call asked again, waiting for the model with no failed try.

**My Tasks** is a tab on the Notetaker page, and each meeting has the same list on its Tasks tab (with "Look for tasks"). Filters: status (suggested and open, suggested, open, done, archived, all), owner (me or named, me, others, nobody named, everyone) and meeting (a folder filter comes with #194). Per task: Accept (Suggested to Open), Done, Reopen, Dismiss or Archive, Restore, Edit (task, mine or a name, due date as YYYY-MM-DD, notes), Up and Down, and drag to reorder (position is a fraction between neighbours, numbered again when the gaps run out). **Source** opens the meeting at that transcript line; if the line was removed it says "Source removed". Tasks can be added by hand and are open at once.

**Undo** takes back the last 20 actions (accept, edit, done, reopen, archive, restore, add, move), newest first, one click each. It is kept in memory: it starts empty after a restart. Tasks suggested from a meeting are not an action and are not listed. A deleted meeting takes its Suggested tasks with it (a trigger); accepted ones stay without a meeting.

Table `tasks` (migration 0031). `npx vite-node scripts/bench-tasks.mjs` runs the extraction on the real model with a made-up meeting (needs the model).

Manual check: record or open a meeting where two things are agreed (for example "I will send the budget by Friday", "Priya, can you book the room?" "Sure"), wait for the summary and then the tasks (or press Look for tasks on the Tasks tab); check they are Suggested with the right owner and Friday's date, accept one, press Source and check the transcript opens at that line, move one with Down and by dragging, press Undo until it says nothing is left, add a task by hand, and turn the setting off.

## Ask across meetings (NT-14)

**What.** The Ask tab is a chat about the owner's meetings. A question is answered on this Mac by the local model from numbered sources taken from the meetings, and each source is a chip that opens the meeting where it was said. If the meetings do not support an answer, Ask says so and lists the closest meetings it checked. Ask only reads; it changes no transcript, summary, note or task. Settings, System, Ask across meetings: where a new question looks to begin with (all meetings, the last 7 days, the last 30 days) and whether the owner's notes are searched.

**Scope.** All meetings, a date range ("Last 7 days", "Last 30 days", or dates written YYYY-MM-DD, both days included) or a chosen set of meetings (the Ask button on a meeting's page asks about that meeting only). Folders come with #194 and plug in as a list of meeting ids. Dates in the question ("yesterday", "last Tuesday", "last week", "this month", "in the last 3 days"; English) narrow the scope further, worked out from the local clock; the words are taken out of the question the model sees, because a small model that reads "last Tuesday" looks for it in the text and refuses. A scope is kept with the conversation and can be changed for the next question.

**Search** (`meetings/ask-index.ts`, ADR-0081 in the vault). Pieces of every meeting are in the table `ask_chunks` with an FTS5 index (`ask_fts`, BM25): transcript pieces of about 200 tokens, each starting with the last line of the one before (dictated lines left out); one piece for each section of the newest final summary (links and "(No source)" taken out; sections that say nothing skipped); the owner's notes by paragraph; and one line for each task that is not archived. A meeting is indexed again, just before a question, when its signature changed (transcript lines, the summary, the notes or the tasks). The question becomes an FTS query of its meaningful words joined by OR, each cut to a crude English stem and matching longer words (shipping finds ship, ships, shipped); a question of only small words finds nothing. The best 12 pieces (`notetaker.ask.topK`) are kept, and as many as fit about 2,300 tokens go to the model, so the prompt stays within the smallest context (4,096). There are no embeddings.

**Answer** (`ask-answer.ts`, `ask-runner.ts`). The model is told to use only the sources, to end every sentence with the numbers of its sources, and to reply exactly NOT_SUPPORTED when they do not answer. Then the answer is checked:

- A citation number that is not one of the sources is removed and logged (`[ask]` in the console).
- An answer with no valid citation left is not kept: it counts as not supported (logged).
- NOT_SUPPORTED, or a search that finds nothing, gives the not-supported reply and the closest meetings (up to 3, from the best pieces). With nothing found the model is not called.
- A kept answer stores its citations: the meeting, the kind of source, the transcript line (the first line of the piece) or summary or task, and the words. A chip shows the meeting title and the time, or the kind of source; a deleted meeting's chip is greyed and opens nothing. Only text is rendered, so markup from the model is shown as text.

The model is shared as for summaries (`model-ask.ts`): a dictation first, never cancelling a Rewrite, Command or Instruct generation, and one question at a time. A follow-up question is searched on its own words: it does not know the earlier answer ("it" and "that" find nothing).

**Threads.** `ask_threads` and `ask_messages` (migration 0032) keep each question, answer, citations and scope. Deleting a conversation deletes its messages. Deleting the "meetings" category in Data and Privacy removes the Ask conversations and the tasks taken from meetings too (tasks written by hand stay).

`npx vite-node scripts/bench-ask.mjs` asks the real model seven questions over three made-up meetings and prints each answer with its sources (needs the model).

Manual check: with a few meetings that have transcripts, open Notetaker, Ask, and ask something one meeting answers: check the answer cites that meeting and that clicking the chip opens the transcript at the line; ask something no meeting covers and check the not-supported reply and its closest meetings; switch to "Last 7 days" and to a date range and check meetings outside it are not used; ask with "last Tuesday" in the question; use Ask on a meeting's page; reopen the conversation after restarting the app; delete a conversation.

## Speakers (NT-07, NT-08)

**Level 1, always.** Every line of a transcript has a speaker: the microphone is **You** and the Mac's sound is **Remote**. A line belongs to the speaker named in `meeting_segments.speaker_id`, and when that is empty (all lines today) to its channel's speaker, whose id is `<meeting id>:mic` or `<meeting id>:system`. So no line is ever unlabelled, and lines transcribed after a rename follow it. Splitting a channel into several people (clusters) is not built: see ADR-0082 in the vault. The setting `notetaker.speakers.level` is not added until there is a second level.

**The speakers list.** The Transcript tab starts with the meeting's speakers: name, number of lines and added-up talk time (dictated lines are not counted). The meeting's header names them too.

**Rename.** "Rename" on a speaker gives it a name for the whole meeting: one row in `meeting_speakers` (migration 0033), so every line of the speaker, earlier and later, shows it at once, and the list, the transcript and the live grey text agree. A name is trimmed, up to 60 characters; an empty name gives back "You" or "Remote"; two speakers of a meeting cannot share a name (case ignored). A person in the room can be named on the You side ("Priya (in room)"). The names are not used in summaries, tasks or Ask yet, which still say Owner and Remote.

**Playback.** The name is a button that plays a sample of the speaker: their longest line, from its start, for the length of the line but at least 3 and at most 8 seconds, never past the end of its chunk file. Main reads the chunk (`.m4a`, about 30 s) and the Hub decodes it with Web Audio, so the page's content policy is unchanged and playback needs no round trip beyond one read. A second click stops it, and starting another sample stops the first. Once `meetings.audio_deleted_at` is set (retention, #195) the button is disabled with the reason as its tooltip, and main refuses too. A missing file says so.

Manual check: record a meeting with someone talking (a video works), open the Transcript tab, check "You" and "Remote" with line counts and talk time; click Remote and hear a sample within a moment; rename Remote to a name and check every line and the header change at once (also while a recording is still going); try giving both speakers the same name; set the meeting's audio as deleted later (with #195) and check Play is disabled.

## Transcript corrections (NT-24)

**What.** On the Transcript tab, each line has an Edit button. The editor changes the line's words, gives the line to another speaker (an existing one, or a new one by name: a guest in the room), cuts the line in two at the cursor, or joins it to the next line of the same channel and speaker. A corrected line shows "(edited)". Dictated lines cannot be corrected. Settings, System, Transcript corrections: whether words changed again and again are offered to the Dictionary.

**Every change is kept** in `transcript_corrections` (migration 0034): the lines as they were (JSON rows, with their `edited` count) and the ids of the lines the change produced. Taking a change back deletes those lines and puts the old rows back, so a revert restores the original exactly and removes the correction. History of a line lists its corrections newest first; only a correction no newer one has built on can be taken back ("Take back the later change to this line first"), so changes never overwrite each other.

- **Text:** trimmed, spaces collapsed, 1 to 4,000 characters. The same words change nothing.
- **Speaker:** an added speaker gets an id `<meeting>:p1`, `:p2`, …, belongs to the channel of the line it was added on, and is listed (with lines, talk time, a sample to play, rename) once it has lines; unused ones are not listed. A name another speaker has is refused. Speakers of lines are described in the Speakers section.
- **Split:** the first half keeps the id, the second is `<id>+<correction id>`. The cut in time falls where the same share of the line's time has passed (words have no timings of their own), so the first half ends where the second starts, the first starts and the second ends where the line did, and both are at least 1 ms. A cut with nothing on one side, or a line shorter than 2 ms, is refused. The words must be saved before splitting.
- **Merge:** the next line of the channel (not dictated) by the same speaker is joined: the words with a space, the span from the first start to the later end. Tasks or summary links that pointed at the second line show "Source removed".
- **Used elsewhere:** summaries and tasks read the current words, so a new summary uses the corrections (an existing summary is not changed). The Ask index includes the corrections in its signature, so a corrected line is found on the next question and the original again after a revert.
- **Dictionary:** a changed word or phrase of one to three words goes to the same learner as a correction after a dictation (`dictionary/learn.ts`): a change of capitals is kept at once, anything else the second time it is seen, and it is added for the owner to review on the Dictionary page. The editor says when something was added. Off when either "Learn from my corrections" (Personalization) or the Transcript corrections setting is off.

Manual check: open a meeting's Transcript tab, correct a word in a line and check "(edited)", then ask a question that uses the new word (Ask finds it) and take the correction back from History; split a line in the middle of a sentence and check the two times; join two lines; give a line to a new speaker and check the speakers list; change the same word the same way twice and check the Dictionary page shows it for review.
