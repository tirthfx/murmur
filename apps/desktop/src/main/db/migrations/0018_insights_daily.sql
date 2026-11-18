-- Insights (HB-36 to HB-39): one row per local calendar day with counts only. No dictated
-- text is stored here, so Insights survive deleting history text. `insights_meta` records
-- one-off jobs, such as filling the days from history once.

-- migrate:up
CREATE TABLE insights_daily (
  date        TEXT PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  words       INTEGER NOT NULL DEFAULT 0 CHECK (words >= 0),
  dictations  INTEGER NOT NULL DEFAULT 0 CHECK (dictations >= 0),
  speech_ms   INTEGER NOT NULL DEFAULT 0 CHECK (speech_ms >= 0),
  wpm_words   INTEGER NOT NULL DEFAULT 0 CHECK (wpm_words >= 0),
  wpm_ms      INTEGER NOT NULL DEFAULT 0 CHECK (wpm_ms >= 0),
  apps_json   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(apps_json))
);

CREATE TABLE insights_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- migrate:down
DROP TABLE insights_meta;
DROP TABLE insights_daily;
