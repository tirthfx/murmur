-- Contacts (NT-12): people mentioned in notes, tasks and Ask. Added by hand, from calendar
-- attendees or from a renamed speaker. A mention lives in the text itself, as
-- `@[contact:<id>|<name>]`, so there is no separate table of mentions.

-- migrate:up
CREATE TABLE contacts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE,
  source      TEXT NOT NULL CHECK (source IN ('manual', 'calendar', 'speaker')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX contacts_name_idx ON contacts (name COLLATE NOCASE);

-- migrate:down
DROP TABLE contacts;
