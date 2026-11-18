-- Scratchpad notes (HB-26, HB-29, HB-31): the rich body as JSON, its plain text for search,
-- and pins. notes_fts is an external-content FTS5 index over the title and plain text.

-- migrate:up
CREATE TABLE notes (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  body_json   TEXT NOT NULL CHECK (json_valid(body_json)),
  body_plain  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  pin_order   INTEGER,
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  deleted_at  INTEGER
);

CREATE INDEX notes_updated_idx ON notes (updated_at DESC);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  title,
  body_plain,
  content = 'notes',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts (rowid, title, body_plain) VALUES (new.rowid, new.title, new.body_plain);
END;

CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts (notes_fts, rowid, title, body_plain)
    VALUES ('delete', old.rowid, old.title, old.body_plain);
END;

CREATE TRIGGER notes_fts_update AFTER UPDATE OF title, body_plain ON notes BEGIN
  INSERT INTO notes_fts (notes_fts, rowid, title, body_plain)
    VALUES ('delete', old.rowid, old.title, old.body_plain);
  INSERT INTO notes_fts (rowid, title, body_plain) VALUES (new.rowid, new.title, new.body_plain);
END;

-- migrate:down
DROP TRIGGER notes_fts_update;
DROP TRIGGER notes_fts_delete;
DROP TRIGGER notes_fts_insert;
DROP TABLE notes_fts;
DROP INDEX notes_updated_idx;
DROP TABLE notes;
