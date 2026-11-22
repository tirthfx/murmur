-- Importing from Zoom and Fireflies (CN-09, CN-10): a meeting that came from a service keeps that
-- service's own id (`zoom:<meeting UUID>`, `fireflies:<transcript id>`), so the same recording is
-- never imported twice. The id is the only thing kept about where it came from: no link, no token.

-- migrate:up
ALTER TABLE meetings ADD COLUMN external_ref TEXT;
CREATE UNIQUE INDEX meetings_external_ref_idx ON meetings (external_ref) WHERE external_ref IS NOT NULL;

-- migrate:down
DROP INDEX meetings_external_ref_idx;
ALTER TABLE meetings DROP COLUMN external_ref;
