-- The History page (HB-35): archive, a feedback note, and full-text search over the final
-- and raw text. The index is an external-content FTS5 table kept in step by triggers.

-- migrate:up
ALTER TABLE history ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1));
ALTER TABLE history ADD COLUMN feedback_note TEXT;

CREATE VIRTUAL TABLE history_fts USING fts5(
  final_text,
  raw_text,
  content = 'history',
  content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO history_fts (history_fts) VALUES ('rebuild');

CREATE TRIGGER history_fts_insert AFTER INSERT ON history BEGIN
  INSERT INTO history_fts (rowid, final_text, raw_text)
    VALUES (new.rowid, new.final_text, new.raw_text);
END;

CREATE TRIGGER history_fts_delete AFTER DELETE ON history BEGIN
  INSERT INTO history_fts (history_fts, rowid, final_text, raw_text)
    VALUES ('delete', old.rowid, old.final_text, old.raw_text);
END;

CREATE TRIGGER history_fts_update AFTER UPDATE OF final_text, raw_text ON history BEGIN
  INSERT INTO history_fts (history_fts, rowid, final_text, raw_text)
    VALUES ('delete', old.rowid, old.final_text, old.raw_text);
  INSERT INTO history_fts (rowid, final_text, raw_text)
    VALUES (new.rowid, new.final_text, new.raw_text);
END;

CREATE INDEX history_archived_idx ON history (archived, created_at DESC);

-- migrate:down
DROP INDEX history_archived_idx;
DROP TRIGGER history_fts_update;
DROP TRIGGER history_fts_delete;
DROP TRIGGER history_fts_insert;
DROP TABLE history_fts;
ALTER TABLE history DROP COLUMN feedback_note;
ALTER TABLE history DROP COLUMN archived;
