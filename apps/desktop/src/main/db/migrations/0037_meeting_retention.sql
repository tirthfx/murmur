-- Notetaker (NT-22): retention of meeting audio and transcripts. A meeting whose transcript was
-- deleted by retention keeps its row, title, date and folder, and says when. A folder can have
-- its own periods (null: the ones in Settings).

-- migrate:up
ALTER TABLE meetings ADD COLUMN transcript_deleted_at INTEGER;
ALTER TABLE folders ADD COLUMN retention_audio TEXT
  CHECK (retention_audio IN ('forever', '30d', '7d', 'processing'));
ALTER TABLE folders ADD COLUMN retention_transcript TEXT
  CHECK (retention_transcript IN ('forever', '1y', '90d', '30d'));

-- migrate:down
ALTER TABLE folders DROP COLUMN retention_transcript;
ALTER TABLE folders DROP COLUMN retention_audio;
ALTER TABLE meetings DROP COLUMN transcript_deleted_at;
