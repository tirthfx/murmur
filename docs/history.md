# Dictation history

Every finished dictation is stored on the Mac, in SQLite.

## Where

- Database: `~/Library/Application Support/Murmur/murmur.db`, opened by main with WAL, foreign keys on, a 5 s busy timeout and `synchronous = NORMAL`.
- Engine: Node's built-in `node:sqlite` (Electron 45 ships Node 24 with SQLite 3.53), so there is no native module to rebuild or package.
- If the database cannot open, dictation keeps working; only history is lost, and the log says so.

## Tables (migration `0001_core_settings_dictation.sql`)

- `settings`: key, JSON value, updated time.
- `history`: one row per dictation, including empty and failed ones: when, how long, language, raw and final text, word count, cleanup level, status and fallback reason, insert status and method, error code, the audio path and when it expires, and `retry_of` for retries.
- `audio_chunks`: the recording behind each row (one chunk per dictation for now), with codec, length and expiry.

Migration 0013 adds `auto_rewrite_id` and `auto_rewrite_status` (`applied`, `skipped_timeout`,
`failed`) to `history`: the Rewrite auto-applied after cleanup and how it went (see
`rewrites.md`). Its texts are in `rewrite_runs`.

Migration 0014 adds `command_runs`: each Command Mode command, with what was said, the
command it matched (by rule or by the model), the text it acted on and what replaced it, and
how it ended (see `commands.md`). A command's recording is also a `history` row with insert
status `empty`, like "remember that".

Migration 0015 adds `instruct_threads` and `instruct_history` (one row per Instruct request,
with its draft and what became of it), kept 30 days, then only counts (see `instruct.md`).

Audio paths are relative to `~/Library/Application Support/Murmur/audio`. Recordings live in `audio/tmp` and expire after 24 hours, when the helper deletes them.

## Migrations

`apps/desktop/src/main/db/migrations/NNNN_snake_case.sql`, numbered from 0001 with no gaps, each with a `-- migrate:up` and a `-- migrate:down` section. They run at start, each in its own transaction, and are recorded in `schema_migrations` with a SHA-256 of the file. An applied migration that was edited, or a database from a newer app, stops the database from opening. Never edit a shipped migration; add a new one.

## Reading it

The store gives the last 200 dictations, newest first, and the last dictated text. The Hub's history page and the tray's "paste last" use them later (#16 and the Hub work).

## Retry and recovery

- **Automatic retry, once.** When transcription times out, the helper restarts or the model
  is still loading, the recording is transcribed again after 2 seconds (after waiting for
  the model to be ready, up to a minute). Only the outcome is written to history, so the
  text is inserted once. Other failures are not retried by themselves.
- **Retry by hand.** Click the Bar while it shows the error, or choose **Retry last
  dictation** in the tray. After a restart this finds the newest failed dictation in
  history whose audio is still there. A retry is a new row with `retry_of` pointing at the
  failed one. A dictation whose retry already went in, or that is being retried right now,
  is not retried again.
- **Crash recovery.** Each recording is noted in `pending_sessions` (migration 0002) when
  it starts, and the note is removed when its history row is written or the recording is
  cancelled. Notes left at the next launch become failed rows with error `INTERRUPTED`,
  using the file the helper was writing; they can then be retried.
- **Audio retention.** Successful dictations keep their recording for 24 hours in the
  helper's temporary folder (`audio/tmp`). Failed and interrupted ones are moved to
  `audio/kept` and kept for 7 days. At launch, recordings past their date are deleted (only
  inside the audio folder) and their references cleared.

The list of failed sessions with a Retry button on the Dictation page belongs to the Hub
pages of a later milestone; until then the tray and the Bar are the way in.

### Manual test

1. Hold the dictation key, speak, and quit Murmur from the Activity Monitor (force quit)
   while it is still transcribing.
2. Start Murmur: the log says `1 interrupted dictation(s) can be retried`.
3. Choose **Retry last dictation** in the tray with a text field focused: the text goes in
   once. Choosing it again does nothing.
