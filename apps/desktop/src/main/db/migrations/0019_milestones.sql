-- Milestones (HB-41): each recorded once by key. shown_at is set when the Insights page has
-- shown it. Keys are fixed names, or `best-week:<Monday>` for each new best week.

-- migrate:up
CREATE TABLE milestones (
  key          TEXT PRIMARY KEY,
  achieved_at  INTEGER NOT NULL,
  shown_at     INTEGER
);

-- migrate:down
DROP TABLE milestones;
