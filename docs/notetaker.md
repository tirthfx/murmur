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

**Starting and stopping.** For now, from the tray menu: Record a meeting, Stop recording the meeting.

**Deleting.** Settings, Data and Privacy, Delete data: "Meetings and their recordings" removes every meeting row, its chunk rows and the `meetings` folder. "Delete all data and reset" includes it.

### Manual test

1. `npm run build:helper`, then `npm run dev`.
2. Tray: Record a meeting. The menu bar shows a red dot and the time; the Bar shows a red dot.
3. Play a video with sound and speak for a minute, then Stop recording the meeting.
4. In `<data>/Murmur/meetings/<id>/` there are `mic-*.m4a` and `system-*.m4a` files, and no `.partial` files. `afinfo` on one shows AAC, 16000 Hz, 1 channel.
5. Remove Screen Recording for Murmur in System Settings and record again: only `mic-*` files, and the meeting carries the `system_permission` warning.
