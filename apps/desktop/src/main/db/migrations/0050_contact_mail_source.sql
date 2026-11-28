-- Contacts (NT-12, CN-04): a contact can also come from the owner's sent mail. SQLite cannot
-- change a CHECK, so the table is made again with the wider one.

-- migrate:up
CREATE TABLE contacts_new (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE,
  source      TEXT NOT NULL CHECK (source IN ('manual', 'calendar', 'speaker', 'mail')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
INSERT INTO contacts_new SELECT id, name, email, source, created_at, updated_at FROM contacts;
DROP TABLE contacts;
ALTER TABLE contacts_new RENAME TO contacts;
CREATE INDEX contacts_name_idx ON contacts (name COLLATE NOCASE);

-- migrate:down
CREATE TABLE contacts_old (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT UNIQUE,
  source      TEXT NOT NULL CHECK (source IN ('manual', 'calendar', 'speaker')),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
INSERT INTO contacts_old
  SELECT id, name, email, CASE source WHEN 'mail' THEN 'manual' ELSE source END, created_at, updated_at
  FROM contacts;
DROP TABLE contacts;
ALTER TABLE contacts_old RENAME TO contacts;
CREATE INDEX contacts_name_idx ON contacts (name COLLATE NOCASE);
