-- Voice Profile (PZ-15 to PZ-17): how the owner writes when dictating, as counts only.
-- voice_profiles holds one row ('me') with phrase counts, totals and milestones as JSON;
-- voice_samples holds numbers per dictation for 30 days, never text.

-- migrate:up
CREATE TABLE voice_profiles (
  id           TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL CHECK (json_valid(profile_json)),
  updated_at   INTEGER NOT NULL
);

CREATE TABLE voice_samples (
  id             TEXT PRIMARY KEY,
  history_id     TEXT,
  created_at     INTEGER NOT NULL,
  category       TEXT NOT NULL,
  words          INTEGER NOT NULL CHECK (words >= 0),
  sentences      INTEGER NOT NULL CHECK (sentences >= 0),
  commas         INTEGER NOT NULL CHECK (commas >= 0),
  full_stops     INTEGER NOT NULL CHECK (full_stops >= 0),
  exclamations   INTEGER NOT NULL CHECK (exclamations >= 0),
  questions      INTEGER NOT NULL CHECK (questions >= 0),
  capital_starts INTEGER NOT NULL CHECK (capital_starts >= 0),
  fillers        INTEGER NOT NULL CHECK (fillers >= 0)
);
CREATE INDEX voice_samples_created_idx ON voice_samples (created_at);

-- migrate:down
DROP TABLE voice_samples;
DROP TABLE voice_profiles;
