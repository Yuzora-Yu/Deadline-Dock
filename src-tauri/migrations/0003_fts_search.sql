CREATE VIRTUAL TABLE IF NOT EXISTS task_search USING fts5(
  task_id UNINDEXED,
  title,
  description,
  category,
  resources,
  tokenize='trigram'
);

DELETE FROM task_search;
INSERT INTO task_search(task_id, title, description, category, resources)
SELECT
  t.id,
  t.title,
  t.description,
  COALESCE(c.name, ''),
  COALESCE((
    SELECT group_concat(COALESCE(r.label, '') || ' ' || COALESCE(r.value, ''), ' ')
    FROM resources r
    WHERE r.task_id = t.id AND r.deleted_at IS NULL
  ), '')
FROM tasks t
LEFT JOIN categories c ON c.id = t.category_id AND c.deleted_at IS NULL;

CREATE TRIGGER IF NOT EXISTS task_search_tasks_ai
AFTER INSERT ON tasks
BEGIN
  INSERT INTO task_search(task_id, title, description, category, resources)
  VALUES (
    NEW.id,
    NEW.title,
    NEW.description,
    COALESCE((SELECT name FROM categories WHERE id = NEW.category_id AND deleted_at IS NULL), ''),
    COALESCE((SELECT group_concat(COALESCE(label, '') || ' ' || COALESCE(value, ''), ' ') FROM resources WHERE task_id = NEW.id AND deleted_at IS NULL), '')
  );
END;

CREATE TRIGGER IF NOT EXISTS task_search_tasks_au
AFTER UPDATE OF title, description, category_id ON tasks
BEGIN
  DELETE FROM task_search WHERE task_id = NEW.id;
  INSERT INTO task_search(task_id, title, description, category, resources)
  VALUES (
    NEW.id,
    NEW.title,
    NEW.description,
    COALESCE((SELECT name FROM categories WHERE id = NEW.category_id AND deleted_at IS NULL), ''),
    COALESCE((SELECT group_concat(COALESCE(label, '') || ' ' || COALESCE(value, ''), ' ') FROM resources WHERE task_id = NEW.id AND deleted_at IS NULL), '')
  );
END;

CREATE TRIGGER IF NOT EXISTS task_search_tasks_ad
AFTER DELETE ON tasks
BEGIN
  DELETE FROM task_search WHERE task_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS task_search_resources_ai
AFTER INSERT ON resources
BEGIN
  DELETE FROM task_search WHERE task_id = NEW.task_id;
  INSERT INTO task_search(task_id, title, description, category, resources)
  SELECT
    t.id,
    t.title,
    t.description,
    COALESCE(c.name, ''),
    COALESCE((SELECT group_concat(COALESCE(r.label, '') || ' ' || COALESCE(r.value, ''), ' ') FROM resources r WHERE r.task_id = t.id AND r.deleted_at IS NULL), '')
  FROM tasks t
  LEFT JOIN categories c ON c.id = t.category_id AND c.deleted_at IS NULL
  WHERE t.id = NEW.task_id;
END;

CREATE TRIGGER IF NOT EXISTS task_search_resources_au
AFTER UPDATE OF label, value, deleted_at ON resources
BEGIN
  DELETE FROM task_search WHERE task_id = NEW.task_id;
  INSERT INTO task_search(task_id, title, description, category, resources)
  SELECT
    t.id,
    t.title,
    t.description,
    COALESCE(c.name, ''),
    COALESCE((SELECT group_concat(COALESCE(r.label, '') || ' ' || COALESCE(r.value, ''), ' ') FROM resources r WHERE r.task_id = t.id AND r.deleted_at IS NULL), '')
  FROM tasks t
  LEFT JOIN categories c ON c.id = t.category_id AND c.deleted_at IS NULL
  WHERE t.id = NEW.task_id;
END;

CREATE TRIGGER IF NOT EXISTS task_search_resources_ad
AFTER DELETE ON resources
BEGIN
  DELETE FROM task_search WHERE task_id = OLD.task_id;
  INSERT INTO task_search(task_id, title, description, category, resources)
  SELECT
    t.id,
    t.title,
    t.description,
    COALESCE(c.name, ''),
    COALESCE((SELECT group_concat(COALESCE(r.label, '') || ' ' || COALESCE(r.value, ''), ' ') FROM resources r WHERE r.task_id = t.id AND r.deleted_at IS NULL), '')
  FROM tasks t
  LEFT JOIN categories c ON c.id = t.category_id AND c.deleted_at IS NULL
  WHERE t.id = OLD.task_id;
END;

CREATE TRIGGER IF NOT EXISTS task_search_categories_au
AFTER UPDATE OF name, deleted_at ON categories
BEGIN
  DELETE FROM task_search WHERE task_id IN (SELECT id FROM tasks WHERE category_id = NEW.id);
  INSERT INTO task_search(task_id, title, description, category, resources)
  SELECT
    t.id,
    t.title,
    t.description,
    CASE WHEN NEW.deleted_at IS NULL THEN NEW.name ELSE '' END,
    COALESCE((SELECT group_concat(COALESCE(r.label, '') || ' ' || COALESCE(r.value, ''), ' ') FROM resources r WHERE r.task_id = t.id AND r.deleted_at IS NULL), '')
  FROM tasks t
  WHERE t.category_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS task_search_categories_ad
AFTER DELETE ON categories
BEGIN
  DELETE FROM task_search WHERE task_id IN (SELECT id FROM tasks WHERE category_id = OLD.id);
  INSERT INTO task_search(task_id, title, description, category, resources)
  SELECT
    t.id,
    t.title,
    '',
    COALESCE((SELECT group_concat(COALESCE(r.label, '') || ' ' || COALESCE(r.value, ''), ' ') FROM resources r WHERE r.task_id = t.id AND r.deleted_at IS NULL), '')
  FROM tasks t
  WHERE t.category_id = OLD.id;
END;
