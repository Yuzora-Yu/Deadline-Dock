CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline_type ON tasks(deadline_type, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_postponement_count ON tasks(postponement_count, deleted_at);
