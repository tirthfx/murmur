-- Notetaker (NT-14): Ask across meetings. `ask_chunks` holds pieces of each meeting's
-- transcript, summary, notes and tasks, searched with FTS5 (BM25). `ask_index` remembers what
-- each meeting looked like when it was indexed, so a changed meeting is indexed again before
-- a question. Threads keep the questions, the answers and the sources each answer cites.

-- migrate:up
CREATE TABLE ask_chunks (
  id         INTEGER PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings (id) ON DELETE CASCADE,
  source     TEXT NOT NULL CHECK (source IN ('transcript', 'summary', 'notes', 'task')),
  -- The first segment of a transcript chunk, the summary or the task; null for notes.
  ref        TEXT,
  start_ms   INTEGER,
  text       TEXT NOT NULL
);
CREATE INDEX ask_chunks_meeting_idx ON ask_chunks (meeting_id);

CREATE VIRTUAL TABLE ask_fts USING fts5(
  text,
  content = 'ask_chunks',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER ask_fts_insert AFTER INSERT ON ask_chunks BEGIN
  INSERT INTO ask_fts (rowid, text) VALUES (new.id, new.text);
END;

CREATE TRIGGER ask_fts_delete AFTER DELETE ON ask_chunks BEGIN
  INSERT INTO ask_fts (ask_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TABLE ask_index (
  meeting_id TEXT PRIMARY KEY REFERENCES meetings (id) ON DELETE CASCADE,
  signature  TEXT NOT NULL,
  indexed_at INTEGER NOT NULL
);

CREATE TABLE ask_threads (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ask_threads_updated_idx ON ask_threads (updated_at DESC);

CREATE TABLE ask_messages (
  id             TEXT PRIMARY KEY,
  thread_id      TEXT NOT NULL REFERENCES ask_threads (id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text           TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(citations_json)),
  closest_json   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(closest_json)),
  -- An answer: 1 when the sources support it, 0 for "not supported". Null for a question.
  supported      INTEGER CHECK (supported IN (0, 1)),
  created_at     INTEGER NOT NULL,
  UNIQUE (thread_id, seq)
);

-- migrate:down
DROP TABLE ask_messages;
DROP TABLE ask_threads;
DROP TABLE ask_index;
DROP TRIGGER ask_fts_delete;
DROP TRIGGER ask_fts_insert;
DROP TABLE ask_fts;
DROP TABLE ask_chunks;
