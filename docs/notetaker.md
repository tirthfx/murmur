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
