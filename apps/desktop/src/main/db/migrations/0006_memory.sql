-- Memory (PZ-18, PZ-19): short facts the owner wants the cleanup model to know. From the data
-- model's proposed additions, with keywords_json for choosing the relevant items.

-- migrate:up
CREATE TABLE memory_items (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'fact' CHECK (kind IN ('fact')),
  text          TEXT NOT NULL,
  keywords_json TEXT NOT NULL CHECK (json_valid(keywords_json)),
  source        TEXT NOT NULL CHECK (source IN ('manual','dictation','note','meeting')),
  source_id     TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

-- migrate:down
DROP TABLE memory_items;
