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

Audio paths are relative to `~/Library/Application Support/Murmur/audio`. Recordings live in `audio/tmp` and expire after 24 hours, when the helper deletes them.

## Migrations

`apps/desktop/src/main/db/migrations/NNNN_snake_case.sql`, numbered from 0001 with no gaps, each with a `-- migrate:up` and a `-- migrate:down` section. They run at start, each in its own transaction, and are recorded in `schema_migrations` with a SHA-256 of the file. An applied migration that was edited, or a database from a newer app, stops the database from opening. Never edit a shipped migration; add a new one.

## Reading it

The store gives the last 200 dictations, newest first, and the last dictated text. The Hub's history page and the tray's "paste last" use them later (#16 and the Hub work).
