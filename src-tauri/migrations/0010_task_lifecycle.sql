-- Durable deletion/undo outbox. Remote acknowledgements replace the generated
-- operation in the same transaction as the incoming task change.
CREATE TABLE sync_task_lifecycle (
  task_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('DELETED','ACTIVE')),
  operation_id TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  base_operation_id TEXT NOT NULL DEFAULT '',
  dirty INTEGER NOT NULL DEFAULT 1
);

INSERT INTO sync_task_lifecycle(task_id,state,operation_id,changed_at)
SELECT id,'DELETED','legacy:'||id||':'||deleted_at,deleted_at
FROM tasks WHERE deleted_at IS NOT NULL;

CREATE TRIGGER task_lifecycle_delete AFTER UPDATE OF deleted_at ON tasks
WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
BEGIN
  INSERT INTO sync_task_lifecycle(task_id,state,operation_id,changed_at,base_operation_id,dirty)
  VALUES(NEW.id,'DELETED',lower(hex(randomblob(16))),NEW.deleted_at,'',1)
  ON CONFLICT(task_id) DO UPDATE SET state='DELETED',base_operation_id=operation_id,
    operation_id=excluded.operation_id,changed_at=excluded.changed_at,dirty=1;
  UPDATE task_check_items SET deleted_at=NEW.deleted_at,updated_at=NEW.updated_at WHERE task_id=NEW.id AND deleted_at IS NULL;
  UPDATE schedule_events SET deleted_at=NEW.deleted_at,updated_at=NEW.updated_at WHERE task_id=NEW.id AND deleted_at IS NULL;
  UPDATE resources SET deleted_at=NEW.deleted_at,updated_at=NEW.updated_at WHERE task_id=NEW.id AND deleted_at IS NULL;
END;

CREATE TRIGGER task_lifecycle_restore AFTER UPDATE OF deleted_at ON tasks
WHEN NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL
BEGIN
  INSERT INTO sync_task_lifecycle(task_id,state,operation_id,changed_at,base_operation_id,dirty)
  VALUES(NEW.id,'ACTIVE',lower(hex(randomblob(16))),NEW.updated_at,'',1)
  ON CONFLICT(task_id) DO UPDATE SET state='ACTIVE',base_operation_id=operation_id,
    operation_id=excluded.operation_id,changed_at=excluded.changed_at,dirty=1;
  UPDATE task_check_items SET deleted_at=NULL,updated_at=NEW.updated_at WHERE task_id=NEW.id AND deleted_at=OLD.deleted_at;
  UPDATE schedule_events SET deleted_at=NULL,updated_at=NEW.updated_at WHERE task_id=NEW.id AND deleted_at=OLD.deleted_at;
  UPDATE resources SET deleted_at=NULL,updated_at=NEW.updated_at WHERE task_id=NEW.id AND deleted_at=OLD.deleted_at;
END;
