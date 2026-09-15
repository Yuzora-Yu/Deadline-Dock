ALTER TABLE google_sync_settings ADD COLUMN initial_sync_confirmed INTEGER NOT NULL DEFAULT 0;
-- Existing installations that have already synchronized do not need a new merge.
UPDATE google_sync_settings SET initial_sync_confirmed=1
WHERE last_success_at IS NOT NULL OR EXISTS (SELECT 1 FROM sync_entity_state) OR EXISTS (SELECT 1 FROM related_sync_state);
