CREATE TABLE related_sync_state (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_json TEXT NOT NULL,
  remote_json TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
