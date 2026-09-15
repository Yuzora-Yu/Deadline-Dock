PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES categories(id),
  status TEXT NOT NULL CHECK(status IN ('TODO','IN_PROGRESS','COMPLETED')),
  deadline_type TEXT NOT NULL CHECK(deadline_type IN ('EXACT','FUZZY_RANGE','ASAP')),
  deadline_label TEXT NOT NULL,
  deadline_exact TEXT,
  deadline_range_start TEXT,
  deadline_range_end TEXT,
  snooze_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  duplicated_from_task_id TEXT REFERENCES tasks(id),
  postponement_count INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS schedule_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  type TEXT NOT NULL CHECK(type IN ('FILE','FOLDER','URL')),
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS task_history (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  actor_id TEXT NOT NULL REFERENCES actors(id),
  event_type TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_status ON tasks(workspace_id, status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline_exact ON tasks(deadline_exact);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline_range_end ON tasks(deadline_range_end);
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category_id);
CREATE INDEX IF NOT EXISTS idx_events_task_start ON schedule_events(task_id, starts_at, deleted_at);
CREATE INDEX IF NOT EXISTS idx_resources_task ON resources(task_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_history_task_created ON task_history(task_id, created_at DESC);

INSERT OR IGNORE INTO workspaces(id, name, created_at, updated_at)
VALUES ('00000000-0000-4000-8000-000000000001', 'Default Workspace', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO actors(id, display_name, created_at)
VALUES ('00000000-0000-4000-8000-000000000001', 'Local User', datetime('now'));
