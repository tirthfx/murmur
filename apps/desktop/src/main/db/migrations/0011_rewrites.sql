-- Rewrites (RW-02 to RW-05): built-in and custom instructions for reshaping selected text.
-- Columns as named in the data model, plus example, enabled, apply_directly and
-- auto_apply_categories_json from the Rewrite spec. Built-in rows are written by the app from
-- its own list (their name and prompt follow the app version); the owner's switches stay.

-- migrate:up
CREATE TABLE rewrites (
  id                         TEXT PRIMARY KEY,
  name                       TEXT NOT NULL,
  builtin_key                TEXT UNIQUE
                               CHECK (builtin_key IN ('clarify','concise','structure','reorder','keep_tone')),
  prompt                     TEXT NOT NULL,
  example                    TEXT,
  shortcut                   TEXT UNIQUE,
  output_mode                TEXT NOT NULL DEFAULT 'replace'
                               CHECK (output_mode IN ('replace','new_note','show_diff')),
  enabled                    INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  apply_directly             INTEGER NOT NULL DEFAULT 1 CHECK (apply_directly IN (0, 1)),
  auto_apply                 INTEGER NOT NULL DEFAULT 0 CHECK (auto_apply IN (0, 1)),
  auto_apply_min_words       INTEGER CHECK (auto_apply_min_words IS NULL OR auto_apply_min_words >= 0),
  auto_apply_categories_json TEXT NOT NULL DEFAULT '["personal","work","email","other"]'
                               CHECK (json_valid(auto_apply_categories_json)),
  use_count                  INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  sort_order                 INTEGER NOT NULL,
  created_at                 INTEGER NOT NULL,
  updated_at                 INTEGER NOT NULL
);
CREATE UNIQUE INDEX rewrites_name_idx ON rewrites (name COLLATE NOCASE);

-- migrate:down
DROP TABLE rewrites;
