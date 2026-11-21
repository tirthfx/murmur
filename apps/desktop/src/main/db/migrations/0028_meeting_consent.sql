-- Notetaker (NT-25): when the owner accepted the recording notice for a meeting. Null means
-- the notice was not shown for it (it is off, or already seen once).

-- migrate:up
ALTER TABLE meetings ADD COLUMN consent_ack_at INTEGER;

-- migrate:down
ALTER TABLE meetings DROP COLUMN consent_ack_at;
