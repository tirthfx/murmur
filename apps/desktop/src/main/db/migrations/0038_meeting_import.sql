-- Notetaker (NT-21): a meeting made from a transcript file remembers the file's hash, so the
-- same file is not imported twice.

-- migrate:up
ALTER TABLE meetings ADD COLUMN import_hash TEXT;
CREATE INDEX meetings_import_hash_idx ON meetings (import_hash) WHERE import_hash IS NOT NULL;

-- migrate:down
DROP INDEX meetings_import_hash_idx;
ALTER TABLE meetings DROP COLUMN import_hash;
