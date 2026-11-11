-- Writing samples (PZ-20): the owner's own writing, kept for Rewrites (M3). Plain text only,
-- up to ten, 20 KB each (checked by the store).

-- migrate:up
CREATE TABLE writing_samples (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- migrate:down
DROP TABLE writing_samples;
