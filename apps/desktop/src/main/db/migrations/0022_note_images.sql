-- Scratchpad images (HB-30): files in the notes folder, re-encoded without metadata. The row
-- goes with its note; main removes the note's image folder after the note is deleted.

-- migrate:up
CREATE TABLE note_images (
  id          TEXT PRIMARY KEY,
  note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  mime        TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg')),
  width       INTEGER NOT NULL CHECK (width > 0),
  height      INTEGER NOT NULL CHECK (height > 0),
  bytes       INTEGER NOT NULL CHECK (bytes > 0),
  created_at  INTEGER NOT NULL
);

CREATE INDEX note_images_note_idx ON note_images (note_id);

-- migrate:down
DROP INDEX note_images_note_idx;
DROP TABLE note_images;
