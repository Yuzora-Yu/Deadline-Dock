CREATE TABLE IF NOT EXISTS task_check_items (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  text TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0 CHECK(checked IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_check_items_task ON task_check_items(task_id, deleted_at, sort_order);

DROP TRIGGER IF EXISTS task_search_tasks_ai;
DROP TRIGGER IF EXISTS task_search_tasks_au;
DROP TRIGGER IF EXISTS task_search_tasks_ad;
DROP TRIGGER IF EXISTS task_search_resources_ai;
DROP TRIGGER IF EXISTS task_search_resources_au;
DROP TRIGGER IF EXISTS task_search_resources_ad;
DROP TRIGGER IF EXISTS task_search_categories_au;
DROP TRIGGER IF EXISTS task_search_categories_ad;
DROP TABLE IF EXISTS task_search;

CREATE VIRTUAL TABLE task_search USING fts5(
  task_id UNINDEXED,
  title,
  description,
  category,
  resources,
  checklist,
  tokenize='trigram'
);

INSERT INTO task_search(task_id, title, description, category, resources, checklist)
SELECT t.id, t.title, t.description, COALESCE(c.name, ''),
  COALESCE((SELECT group_concat(COALESCE(r.label,'') || ' ' || COALESCE(r.value,''), ' ') FROM resources r WHERE r.task_id=t.id AND r.deleted_at IS NULL), ''),
  COALESCE((SELECT group_concat(COALESCE(ci.text,''), ' ') FROM task_check_items ci WHERE ci.task_id=t.id AND ci.deleted_at IS NULL), '')
FROM tasks t LEFT JOIN categories c ON c.id=t.category_id AND c.deleted_at IS NULL;

CREATE TRIGGER task_search_tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO task_search(task_id,title,description,category,resources,checklist)
  VALUES(NEW.id,NEW.title,NEW.description,
    COALESCE((SELECT name FROM categories WHERE id=NEW.category_id AND deleted_at IS NULL),''),
    COALESCE((SELECT group_concat(COALESCE(label,'') || ' ' || COALESCE(value,''),' ') FROM resources WHERE task_id=NEW.id AND deleted_at IS NULL),''),
    COALESCE((SELECT group_concat(COALESCE(text,''),' ') FROM task_check_items WHERE task_id=NEW.id AND deleted_at IS NULL),''));
END;

CREATE TRIGGER task_search_tasks_au AFTER UPDATE OF title,description,category_id ON tasks BEGIN
  DELETE FROM task_search WHERE task_id=NEW.id;
  INSERT INTO task_search(task_id,title,description,category,resources,checklist)
  VALUES(NEW.id,NEW.title,NEW.description,
    COALESCE((SELECT name FROM categories WHERE id=NEW.category_id AND deleted_at IS NULL),''),
    COALESCE((SELECT group_concat(COALESCE(label,'') || ' ' || COALESCE(value,''),' ') FROM resources WHERE task_id=NEW.id AND deleted_at IS NULL),''),
    COALESCE((SELECT group_concat(COALESCE(text,''),' ') FROM task_check_items WHERE task_id=NEW.id AND deleted_at IS NULL),''));
END;

CREATE TRIGGER task_search_tasks_ad AFTER DELETE ON tasks BEGIN
  DELETE FROM task_search WHERE task_id=OLD.id;
END;

CREATE TRIGGER task_search_resources_ai AFTER INSERT ON resources BEGIN
  DELETE FROM task_search WHERE task_id=NEW.task_id;
  INSERT INTO task_search(task_id,title,description,category,resources,checklist)
  SELECT t.id,t.title,t.description,COALESCE(c.name,''),
    COALESCE((SELECT group_concat(COALESCE(r.label,'') || ' ' || COALESCE(r.value,''),' ') FROM resources r WHERE r.task_id=t.id AND r.deleted_at IS NULL),''),
    COALESCE((SELECT group_concat(COALESCE(ci.text,''),' ') FROM task_check_items ci WHERE ci.task_id=t.id AND ci.deleted_at IS NULL),'')
  FROM tasks t LEFT JOIN categories c ON c.id=t.category_id AND c.deleted_at IS NULL WHERE t.id=NEW.task_id;
END;
CREATE TRIGGER task_search_resources_au AFTER UPDATE OF label,value,deleted_at ON resources BEGIN
  DELETE FROM task_search WHERE task_id=NEW.task_id;
  INSERT INTO task_search(task_id,title,description,category,resources,checklist)
  SELECT t.id,t.title,t.description,COALESCE(c.name,''),
    COALESCE((SELECT group_concat(COALESCE(r.label,'') || ' ' || COALESCE(r.value,''),' ') FROM resources r WHERE r.task_id=t.id AND r.deleted_at IS NULL),''),
    COALESCE((SELECT group_concat(COALESCE(ci.text,''),' ') FROM task_check_items ci WHERE ci.task_id=t.id AND ci.deleted_at IS NULL),'')
  FROM tasks t LEFT JOIN categories c ON c.id=t.category_id AND c.deleted_at IS NULL WHERE t.id=NEW.task_id;
END;
CREATE TRIGGER task_search_resources_ad AFTER DELETE ON resources BEGIN
  DELETE FROM task_search WHERE task_id=OLD.task_id;
  INSERT INTO task_search(task_id,title,description,category,resources,checklist)
  SELECT t.id,t.title,t.description,COALESCE(c.name,''),
    COALESCE((SELECT group_concat(COALESCE(r.label,'') || ' ' || COALESCE(r.value,''),' ') FROM resources r WHERE r.task_id=t.id AND r.deleted_at IS NULL),''),
    COALESCE((SELECT group_concat(COALESCE(ci.text,''),' ') FROM task_check_items ci WHERE ci.task_id=t.id AND ci.deleted_at IS NULL),'')
  FROM tasks t LEFT JOIN categories c ON c.id=t.category_id AND c.deleted_at IS NULL WHERE t.id=OLD.task_id;
END;

CREATE TRIGGER task_search_categories_au AFTER UPDATE OF name,deleted_at ON categories BEGIN
  DELETE FROM task_search WHERE task_id IN (SELECT id FROM tasks WHERE category_id=NEW.id);
  INSERT INTO task_search(task_id,title,description,category,resources,checklist)
  SELECT t.id,t.title,t.description,CASE WHEN NEW.deleted_at IS NULL THEN NEW.name ELSE '' END,
    COALESCE((SELECT group_concat(COALESCE(r.label,'') || ' ' || COALESCE(r.value,''),' ') FROM resources r WHERE r.task_id=t.id AND r.deleted_at IS NULL),''),
    COALESCE((SELECT group_concat(COALESCE(ci.text,''),' ') FROM task_check_items ci WHERE ci.task_id=t.id AND ci.deleted_at IS NULL),'')
  FROM tasks t WHERE t.category_id=NEW.id;
END;
CREATE TRIGGER task_search_categories_ad AFTER DELETE ON categories BEGIN
  DELETE FROM task_search WHERE task_id IN (SELECT id FROM tasks WHERE category_id=OLD.id);
  INSERT INTO task_search(task_id,title,description,category,resources,checklist)
  SELECT t.id,t.title,t.description,'',
    COALESCE((SELECT group_concat(COALESCE(r.label,'') || ' ' || COALESCE(r.value,''),' ') FROM resources r WHERE r.task_id=t.id AND r.deleted_at IS NULL),''),
    COALESCE((SELECT group_concat(COALESCE(ci.text,''),' ') FROM task_check_items ci WHERE ci.task_id=t.id AND ci.deleted_at IS NULL),'')
  FROM tasks t WHERE t.category_id=OLD.id;
END;

CREATE TRIGGER task_search_checkitems_ai AFTER INSERT ON task_check_items BEGIN
  DELETE FROM task_search WHERE task_id=NEW.task_id;
  INSERT INTO task_search(task_id,title,description,category,resources,checklist)
  SELECT t.id,t.title,t.description,COALESCE(c.name,''),
    COALESCE((SELECT group_concat(COALESCE(r.label,'') || ' ' || COALESCE(r.value,''),' ') FROM resources r WHERE r.task_id=t.id AND r.deleted_at IS NULL),''),
    COALESCE((SELECT group_concat(COALESCE(ci.text,''),' ') FROM task_check_items ci WHERE ci.task_id=t.id AND ci.deleted_at IS NULL),'')
  FROM tasks t LEFT JOIN categories c ON c.id=t.category_id AND c.deleted_at IS NULL WHERE t.id=NEW.task_id;
END;
CREATE TRIGGER task_search_checkitems_au AFTER UPDATE OF text,deleted_at ON task_check_items BEGIN
  DELETE FROM task_search WHERE task_id=NEW.task_id;
  INSERT INTO task_search(task_id,title,description,category,resources,checklist)
  SELECT t.id,t.title,t.description,COALESCE(c.name,''),
    COALESCE((SELECT group_concat(COALESCE(r.label,'') || ' ' || COALESCE(r.value,''),' ') FROM resources r WHERE r.task_id=t.id AND r.deleted_at IS NULL),''),
    COALESCE((SELECT group_concat(COALESCE(ci.text,''),' ') FROM task_check_items ci WHERE ci.task_id=t.id AND ci.deleted_at IS NULL),'')
  FROM tasks t LEFT JOIN categories c ON c.id=t.category_id AND c.deleted_at IS NULL WHERE t.id=NEW.task_id;
END;
CREATE TRIGGER task_search_checkitems_ad AFTER DELETE ON task_check_items BEGIN
  DELETE FROM task_search WHERE task_id=OLD.task_id;
  INSERT INTO task_search(task_id,title,description,category,resources,checklist)
  SELECT t.id,t.title,t.description,COALESCE(c.name,''),
    COALESCE((SELECT group_concat(COALESCE(r.label,'') || ' ' || COALESCE(r.value,''),' ') FROM resources r WHERE r.task_id=t.id AND r.deleted_at IS NULL),''),
    COALESCE((SELECT group_concat(COALESCE(ci.text,''),' ') FROM task_check_items ci WHERE ci.task_id=t.id AND ci.deleted_at IS NULL),'')
  FROM tasks t LEFT JOIN categories c ON c.id=t.category_id AND c.deleted_at IS NULL WHERE t.id=OLD.task_id;
END;
