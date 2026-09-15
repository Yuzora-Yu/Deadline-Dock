CREATE TABLE google_sync_settings (
  workspace_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL DEFAULT '',
  google_sub TEXT,
  email TEXT,
  spreadsheet_id TEXT,
  spreadsheet_url TEXT,
  initialized INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO google_sync_settings(workspace_id)
VALUES ('00000000-0000-4000-8000-000000000001');
CREATE TABLE sync_entity_state (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  last_synced_local_revision INTEGER,
  last_synced_remote_hash TEXT,
  last_synced_at TEXT,
  PRIMARY KEY(entity_type, entity_id)
);
CREATE TABLE sync_conflicts (
  id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  local_json TEXT NOT NULL, remote_json TEXT NOT NULL,
  detected_at TEXT NOT NULL, resolved_at TEXT, resolution TEXT
);
