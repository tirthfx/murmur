-- Styles per context (PZ-11, PZ-12) and the owner's app categories (PZ-13). One built-in style
-- per category; `preset` names the preset whose flags the other columns hold.
-- app_categories holds the owner's choices only; the default table ships with the app.

-- migrate:up
CREATE TABLE styles (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  context_kind   TEXT NOT NULL CHECK (context_kind IN ('personal','work','email','other')),
  app_match_json TEXT CHECK (app_match_json IS NULL OR json_valid(app_match_json)),
  preset         TEXT NOT NULL,
  capitalisation TEXT NOT NULL CHECK (capitalisation IN ('standard','none')),
  punctuation    TEXT NOT NULL CHECK (punctuation IN ('full','light','minimal')),
  emphasis       TEXT NOT NULL CHECK (emphasis IN ('normal','expressive')),
  instructions   TEXT,
  auto_detect    INTEGER NOT NULL DEFAULT 0 CHECK (auto_detect IN (0, 1)),
  is_builtin     INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
  is_default     INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  sort_order     INTEGER NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX styles_context_idx ON styles (context_kind, is_default);

INSERT INTO styles (id, name, context_kind, preset, capitalisation, punctuation, emphasis,
  instructions, is_builtin, is_default, sort_order, created_at, updated_at) VALUES
  ('style-personal', 'Personal', 'personal', 'no-caps-less', 'none', 'light', 'normal', NULL, 1, 1, 0, 0, 0),
  ('style-work', 'Work', 'work', 'caps', 'standard', 'full', 'normal', NULL, 1, 1, 1, 0, 0),
  ('style-email', 'Email', 'email', 'formal', 'standard', 'full', 'normal', NULL, 1, 1, 2, 0, 0),
  ('style-other', 'Other', 'other', 'caps', 'standard', 'full', 'normal', NULL, 1, 1, 3, 0, 0);

CREATE TABLE app_categories (
  bundle_id  TEXT PRIMARY KEY,
  app_name   TEXT,
  category   TEXT NOT NULL CHECK (category IN ('personal','work','email','other','developer')),
  source     TEXT NOT NULL CHECK (source IN ('default','user','detected')),
  updated_at INTEGER NOT NULL
);

-- migrate:down
DROP TABLE app_categories;
DROP TABLE styles;
