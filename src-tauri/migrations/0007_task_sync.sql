ALTER TABLE google_sync_settings ADD COLUMN auto_sync INTEGER NOT NULL DEFAULT 1;
ALTER TABLE google_sync_settings ADD COLUMN poll_seconds INTEGER NOT NULL DEFAULT 60;
CREATE UNIQUE INDEX sync_unresolved_entity ON sync_conflicts(entity_type, entity_id) WHERE resolved_at IS NULL;
CREATE TABLE sync_write_journal (
  id TEXT PRIMARY KEY, spreadsheet_id TEXT NOT NULL, before_json TEXT NOT NULL,
  patches_json TEXT NOT NULL, result TEXT NOT NULL DEFAULT 'PENDING', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
