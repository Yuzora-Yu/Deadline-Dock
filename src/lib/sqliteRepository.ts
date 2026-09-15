import Database from '@tauri-apps/plugin-sql';
import type {
  BackupSnapshot,
  Category,
  CategoryColor,
  CheckItem,
  DeadlineInput,
  HistoryEntry,
  Resource,
  ResourceType,
  ScheduleEvent,
  Task,
  TaskCreateInput,
  TaskDetails,
  TaskFilters,
  TaskStatus
} from '../types';
import { describeDeadlineChange, deadlineInputFromTask } from './deadline';
import { nowIso } from './datetime';
import { assertBackupSnapshot } from './backup';
import { DEFAULT_WORKSPACE_ID, LOCAL_ACTOR_ID, type Repository } from './repository';
import { DEFAULT_CATEGORY_COLOR } from './categoryColors';

const DB_URL = 'sqlite:deadline-dock.db';

function uuid() {
  return crypto.randomUUID();
}

function json(value: unknown) {
  return JSON.stringify(value);
}

function dateStartIso(date: string) {
  return new Date(`${date}T00:00:00`).toISOString();
}

function dateEndIso(date: string) {
  return new Date(`${date}T23:59:59.999`).toISOString();
}


export class SqliteRepository implements Repository {
  private dbPromise = Database.load(DB_URL);

  private async db() {
    return this.dbPromise;
  }

  private async history(taskId: string, eventType: string, oldValue?: unknown, newValue?: unknown) {
    const db = await this.db();
    await db.execute(
      `INSERT INTO task_history(id, task_id, actor_id, event_type, old_value, new_value, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuid(), taskId, LOCAL_ACTOR_ID, eventType, oldValue === undefined ? null : json(oldValue), newValue === undefined ? null : json(newValue), nowIso()]
    );
  }

  async listTasks(filters: TaskFilters = {}): Promise<Task[]> {
    const db = await this.db();
    const where = ['t.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (filters.includeCompleted) {
      if (filters.status && filters.status !== 'ALL') {
        where.push('t.status = ?'); params.push(filters.status);
      }
    } else {
      where.push("t.status <> 'COMPLETED'");
      if (filters.status && filters.status !== 'ALL') {
        where.push('t.status = ?'); params.push(filters.status);
      }
    }
    if (filters.categoryId && filters.categoryId !== 'ALL') {
      where.push('t.category_id = ?'); params.push(filters.categoryId);
    }
    if (filters.postponed === 'YES') where.push('t.postponement_count > 0');
    if (filters.postponed === 'NO') where.push('t.postponement_count = 0');
    if (filters.deadlineType && filters.deadlineType !== 'ALL') { where.push('t.deadline_type = ?'); params.push(filters.deadlineType); }
    if (filters.createdFrom) { where.push('t.created_at >= ?'); params.push(dateStartIso(filters.createdFrom)); }
    if (filters.createdTo) { where.push('t.created_at <= ?'); params.push(dateEndIso(filters.createdTo)); }
    if (filters.completedFrom) { where.push('t.completed_at IS NOT NULL AND t.completed_at >= ?'); params.push(dateStartIso(filters.completedFrom)); }
    if (filters.completedTo) { where.push('t.completed_at IS NOT NULL AND t.completed_at <= ?'); params.push(dateEndIso(filters.completedTo)); }

    if (filters.query?.trim()) {
      const raw = filters.query.trim();
      const terms = raw.split(/\s+/).filter(Boolean);
      const canUseFts = terms.length > 0 && terms.every(term => Array.from(term).length >= 3);
      if (canUseFts) {
        const ftsQuery = terms.map(term => `\"${term.replaceAll('\"', '\"\"')}\"`).join(' AND ');
        where.push(`t.id IN (
          SELECT task_id FROM task_search
          WHERE task_search MATCH ?
        )`);
        params.push(ftsQuery);
      } else {
        const q = `%${raw}%`;
        where.push(`(
          t.title LIKE ? OR t.description LIKE ? OR c.name LIKE ? OR
          EXISTS (SELECT 1 FROM resources r WHERE r.task_id = t.id AND r.deleted_at IS NULL AND (r.label LIKE ? OR r.value LIKE ?)) OR
          EXISTS (SELECT 1 FROM task_check_items ci WHERE ci.task_id = t.id AND ci.deleted_at IS NULL AND ci.text LIKE ?)
        )`);
        params.push(q, q, q, q, q, q);
      }
    }

    const sql = `
      SELECT t.*, c.name AS category_name, c.color AS category_color,
        (SELECT e.starts_at FROM schedule_events e
          WHERE e.task_id=t.id AND e.deleted_at IS NULL AND e.starts_at >= ?
          ORDER BY e.starts_at ASC LIMIT 1) AS next_event_at,
        (SELECT e.title FROM schedule_events e
          WHERE e.task_id=t.id AND e.deleted_at IS NULL AND e.starts_at >= ?
          ORDER BY e.starts_at ASC LIMIT 1) AS next_event_title
      FROM tasks t
      LEFT JOIN categories c ON c.id=t.category_id AND c.deleted_at IS NULL
      WHERE ${where.join(' AND ')}
    `;
    const now = nowIso();
    const rows = await db.select<Task[]>(sql, [now, now, ...params]);
    return rows;
  }

  async getTaskDetails(taskId: string): Promise<TaskDetails> {
    const db = await this.db();
    const tasks = await db.select<Task[]>(
      `SELECT t.*, c.name AS category_name, c.color AS category_color, NULL AS next_event_at, NULL AS next_event_title
       FROM tasks t LEFT JOIN categories c ON c.id=t.category_id AND c.deleted_at IS NULL
       WHERE t.id=? AND t.deleted_at IS NULL`, [taskId]
    );
    if (!tasks[0]) throw new Error('タスクが見つかりません。');
    const [events, resources, checkItems, history] = await Promise.all([
      db.select<ScheduleEvent[]>('SELECT * FROM schedule_events WHERE task_id=? AND deleted_at IS NULL ORDER BY starts_at ASC', [taskId]),
      db.select<Resource[]>('SELECT * FROM resources WHERE task_id=? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC', [taskId]),
      db.select<CheckItem[]>('SELECT * FROM task_check_items WHERE task_id=? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC', [taskId]),
      db.select<HistoryEntry[]>('SELECT h.*, a.display_name AS actor_name FROM task_history h LEFT JOIN actors a ON a.id=h.actor_id WHERE h.task_id=? ORDER BY h.created_at DESC', [taskId])
    ]);
    return { task: tasks[0], events, resources, checkItems, history };
  }

  async createTask(input: TaskCreateInput): Promise<Task> {
    const db = await this.db();
    const id = uuid();
    const now = nowIso();
    await db.execute(
      `INSERT INTO tasks(
        id, workspace_id, title, description, category_id, status,
        deadline_type, deadline_label, deadline_exact, deadline_range_start, deadline_range_end,
        snooze_until, created_at, updated_at, revision, duplicated_from_task_id, postponement_count
       ) VALUES (?, ?, ?, ?, ?, 'TODO', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0)`,
      [id, DEFAULT_WORKSPACE_ID, input.title.trim(), input.description || '', input.categoryId || null,
        input.deadline.type, input.deadline.label, input.deadline.exact || null,
        input.deadline.rangeStart || null, input.deadline.rangeEnd || null, input.snoozeUntil || null, now, now,
        input.duplicatedFromTaskId || null]
    );
    await this.history(id, 'TASK_CREATED', undefined, { title: input.title, deadline: input.deadline });
    if (input.duplicatedFromTaskId) await this.history(id, 'TASK_DUPLICATED', { source_task_id: input.duplicatedFromTaskId }, undefined);
    for (const event of input.events || []) await this.addEvent(id, event);
    for (const resource of input.resources || []) await this.addResource(id, resource);
    for (const item of input.checkItems || []) {
      const created = await this.addCheckItem(id, item.text);
      if (item.checked) await this.toggleCheckItem(created.id, true);
    }
    return (await this.getTaskDetails(id)).task;
  }

  async updateTaskFields(taskId: string, fields: { title?: string; description?: string; categoryId?: string | null; snoozeUntil?: string | null }): Promise<void> {
    const db = await this.db();
    const before = (await this.getTaskDetails(taskId)).task;
    const sets: string[] = [];
    const params: unknown[] = [];
    if (fields.title !== undefined && fields.title.trim() !== before.title) { sets.push('title=?'); params.push(fields.title.trim()); }
    if (fields.description !== undefined && fields.description !== before.description) { sets.push('description=?'); params.push(fields.description); }
    if (fields.categoryId !== undefined && fields.categoryId !== before.category_id) { sets.push('category_id=?'); params.push(fields.categoryId || null); }
    if (fields.snoozeUntil !== undefined && fields.snoozeUntil !== before.snooze_until) { sets.push('snooze_until=?'); params.push(fields.snoozeUntil || null); }
    if (!sets.length) return;
    sets.push('updated_at=?', 'revision=revision+1'); params.push(nowIso(), taskId);
    await db.execute(`UPDATE tasks SET ${sets.join(', ')} WHERE id=?`, params);
    if (fields.title !== undefined && fields.title.trim() !== before.title) await this.history(taskId, 'TITLE_CHANGED', before.title, fields.title.trim());
    if (fields.description !== undefined && fields.description !== before.description) await this.history(taskId, 'DESCRIPTION_CHANGED', before.description, fields.description);
    if (fields.categoryId !== undefined && fields.categoryId !== before.category_id) await this.history(taskId, 'CATEGORY_CHANGED', before.category_id, fields.categoryId || null);
    if (fields.snoozeUntil !== undefined && fields.snoozeUntil !== before.snooze_until) await this.history(taskId, 'SNOOZE_CHANGED', before.snooze_until, fields.snoozeUntil || null);
  }

  async updateDeadline(taskId: string, deadline: DeadlineInput): Promise<void> {
    const db = await this.db();
    const before = (await this.getTaskDetails(taskId)).task;
    const old = deadlineInputFromTask(before);
    if (JSON.stringify(old) === JSON.stringify(deadline)) return;
    const change = describeDeadlineChange(old, deadline);
    await db.execute(
      `UPDATE tasks SET deadline_type=?, deadline_label=?, deadline_exact=?, deadline_range_start=?, deadline_range_end=?,
       postponement_count=postponement_count + ?, updated_at=?, revision=revision+1 WHERE id=?`,
      [deadline.type, deadline.label, deadline.exact || null, deadline.rangeStart || null, deadline.rangeEnd || null,
        change.direction === 'POSTPONED' ? 1 : 0, nowIso(), taskId]
    );
    await this.history(taskId, 'DEADLINE_CHANGED', old, { ...deadline, ...change });
  }

  async setStatus(taskId: string, status: TaskStatus): Promise<void> {
    const db = await this.db();
    const before = (await this.getTaskDetails(taskId)).task;
    if (before.status === status) return;
    const now = nowIso();
    if (status === 'IN_PROGRESS') {
      await db.execute(`UPDATE tasks SET status=?, started_at=COALESCE(started_at, ?), completed_at=NULL, updated_at=?, revision=revision+1 WHERE id=?`, [status, now, now, taskId]);
    } else if (status === 'COMPLETED') {
      await db.execute(`UPDATE tasks SET status=?, completed_at=?, updated_at=?, revision=revision+1 WHERE id=?`, [status, now, now, taskId]);
    } else {
      await db.execute(`UPDATE tasks SET status=?, completed_at=NULL, updated_at=?, revision=revision+1 WHERE id=?`, [status, now, taskId]);
    }
    await this.history(taskId, 'STATUS_CHANGED', before.status, status);
  }

  async deleteTask(taskId: string): Promise<void> {
    const db = await this.db();
    const before = (await this.getTaskDetails(taskId)).task;
    const now = nowIso();
    await this.history(taskId, 'TASK_DELETED', { title: before.title }, undefined);
    await db.execute('UPDATE tasks SET deleted_at=?, updated_at=?, revision=revision+1 WHERE id=?', [now, now, taskId]);
  }

  async restoreTask(taskId: string): Promise<void> {
    const db = await this.db();
    const rows = await db.select<{ deleted_at: string | null }[]>('SELECT deleted_at FROM tasks WHERE id=?', [taskId]);
    if (!rows[0]?.deleted_at) return;
    const before = rows[0].deleted_at;
    const now = nowIso();
    await db.execute('UPDATE tasks SET deleted_at=NULL, updated_at=?, revision=revision+1 WHERE id=?', [now, taskId]);
    await this.history(taskId, 'TASK_RESTORED', before, null);
  }

  async duplicateTask(taskId: string, options: { deadline?: DeadlineInput; copyEvents?: boolean } = {}): Promise<Task> {
    const source = await this.getTaskDetails(taskId);
    return this.createTask({
      title: source.task.title,
      description: source.task.description,
      categoryId: source.task.category_id,
      deadline: options.deadline || deadlineInputFromTask(source.task),
      duplicatedFromTaskId: taskId,
      resources: source.resources.map(resource => ({ type: resource.type, label: resource.label, value: resource.value })),
      checkItems: source.checkItems.map(item => ({ text: item.text, checked: false })),
      events: options.copyEvents ? source.events.map(event => ({ title: event.title, startsAt: event.starts_at, endsAt: event.ends_at })) : []
    });
  }

  async listCategories(): Promise<Category[]> {
    const db = await this.db();
    return db.select<Category[]>('SELECT * FROM categories WHERE workspace_id=? AND deleted_at IS NULL ORDER BY sort_order ASC, name ASC', [DEFAULT_WORKSPACE_ID]);
  }

  async createCategory(name: string, color: CategoryColor = DEFAULT_CATEGORY_COLOR): Promise<Category> {
    const db = await this.db();
    const id = uuid(); const now = nowIso();
    const max = await db.select<{ max_order: number | null }[]>('SELECT MAX(sort_order) AS max_order FROM categories WHERE workspace_id=? AND deleted_at IS NULL', [DEFAULT_WORKSPACE_ID]);
    const order = (max[0]?.max_order ?? -1) + 1;
    await db.execute('INSERT INTO categories(id,workspace_id,name,color,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', [id, DEFAULT_WORKSPACE_ID, name.trim(), color, order, now, now]);
    return (await db.select<Category[]>('SELECT * FROM categories WHERE id=?', [id]))[0];
  }

  async renameCategory(id: string, name: string): Promise<void> {
    const db = await this.db();
    await db.execute('UPDATE categories SET name=?, updated_at=? WHERE id=? AND deleted_at IS NULL', [name.trim(), nowIso(), id]);
    await db.execute('UPDATE tasks SET revision=revision+1, updated_at=? WHERE category_id=?', [nowIso(), id]);
  }

  async setCategoryColor(id: string, color: CategoryColor): Promise<void> {
    const db = await this.db();
    await db.execute('UPDATE categories SET color=?, updated_at=? WHERE id=? AND deleted_at IS NULL', [color, nowIso(), id]);
  }

  async deleteCategory(id: string): Promise<void> {
    const db = await this.db(); const now = nowIso();
    const affected = await db.select<{ id: string }[]>('SELECT id FROM tasks WHERE category_id=? AND deleted_at IS NULL', [id]);
    for (const task of affected) await this.history(task.id, 'CATEGORY_CHANGED', id, null);
    await db.execute('UPDATE tasks SET category_id=NULL, updated_at=?, revision=revision+1 WHERE category_id=? AND deleted_at IS NULL', [now, id]);
    await db.execute('UPDATE categories SET deleted_at=?, updated_at=? WHERE id=?', [now, now, id]);
  }

  async moveCategory(id: string, direction: 'UP' | 'DOWN'): Promise<void> {
    const cats = await this.listCategories();
    const idx = cats.findIndex(c => c.id === id);
    const swap = direction === 'UP' ? idx - 1 : idx + 1;
    if (idx < 0 || swap < 0 || swap >= cats.length) return;
    const db = await this.db(); const now = nowIso();
    await db.execute('UPDATE categories SET sort_order=?, updated_at=? WHERE id=?', [cats[swap].sort_order, now, cats[idx].id]);
    await db.execute('UPDATE categories SET sort_order=?, updated_at=? WHERE id=?', [cats[idx].sort_order, now, cats[swap].id]);
  }

  async addEvent(taskId: string, input: { title: string; startsAt: string; endsAt?: string | null }): Promise<ScheduleEvent> {
    const db = await this.db(); const id = uuid(); const now = nowIso();
    await db.execute('INSERT INTO schedule_events(id,task_id,title,starts_at,ends_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', [id, taskId, input.title.trim(), input.startsAt, input.endsAt || null, now, now]);
    await db.execute('UPDATE tasks SET updated_at=?, revision=revision+1 WHERE id=?', [now, taskId]);
    await this.history(taskId, 'EVENT_ADDED', undefined, { id, ...input });
    return (await db.select<ScheduleEvent[]>('SELECT * FROM schedule_events WHERE id=?', [id]))[0];
  }

  async updateEvent(eventId: string, input: { title: string; startsAt: string; endsAt?: string | null }): Promise<void> {
    const db = await this.db();
    const old = (await db.select<ScheduleEvent[]>('SELECT * FROM schedule_events WHERE id=? AND deleted_at IS NULL', [eventId]))[0];
    if (!old) return;
    const now = nowIso();
    await db.execute('UPDATE schedule_events SET title=?,starts_at=?,ends_at=?,updated_at=? WHERE id=?', [input.title.trim(), input.startsAt, input.endsAt || null, now, eventId]);
    await db.execute('UPDATE tasks SET updated_at=?, revision=revision+1 WHERE id=?', [now, old.task_id]);
    await this.history(old.task_id, 'EVENT_CHANGED', old, input);
  }

  async deleteEvent(eventId: string): Promise<void> {
    const db = await this.db();
    const old = (await db.select<ScheduleEvent[]>('SELECT * FROM schedule_events WHERE id=? AND deleted_at IS NULL', [eventId]))[0];
    if (!old) return;
    const now = nowIso();
    await db.execute('UPDATE schedule_events SET deleted_at=?, updated_at=? WHERE id=?', [now, now, eventId]);
    await db.execute('UPDATE tasks SET updated_at=?, revision=revision+1 WHERE id=?', [now, old.task_id]);
    await this.history(old.task_id, 'EVENT_DELETED', old, undefined);
  }

  async addResource(taskId: string, input: { type: ResourceType; label: string; value: string }): Promise<Resource> {
    const db = await this.db(); const id = uuid(); const now = nowIso();
    const max = await db.select<{ max_order: number | null }[]>('SELECT MAX(sort_order) AS max_order FROM resources WHERE task_id=? AND deleted_at IS NULL', [taskId]);
    const order = (max[0]?.max_order ?? -1) + 1;
    await db.execute('INSERT INTO resources(id,task_id,type,label,value,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', [id, taskId, input.type, input.label.trim() || input.value, input.value.trim(), order, now, now]);
    await db.execute('UPDATE tasks SET updated_at=?, revision=revision+1 WHERE id=?', [now, taskId]);
    await this.history(taskId, 'RESOURCE_ADDED', undefined, { id, ...input });
    return (await db.select<Resource[]>('SELECT * FROM resources WHERE id=?', [id]))[0];
  }

  async updateResource(resourceId: string, input: { type: ResourceType; label: string; value: string }): Promise<void> {
    const db = await this.db();
    const old = (await db.select<Resource[]>('SELECT * FROM resources WHERE id=? AND deleted_at IS NULL', [resourceId]))[0];
    if (!old) return;
    const now = nowIso();
    await db.execute('UPDATE resources SET type=?,label=?,value=?,updated_at=? WHERE id=?', [input.type, input.label.trim() || input.value, input.value.trim(), now, resourceId]);
    await db.execute('UPDATE tasks SET updated_at=?, revision=revision+1 WHERE id=?', [now, old.task_id]);
    await this.history(old.task_id, 'RESOURCE_CHANGED', old, input);
  }

  async deleteResource(resourceId: string): Promise<void> {
    const db = await this.db();
    const old = (await db.select<Resource[]>('SELECT * FROM resources WHERE id=? AND deleted_at IS NULL', [resourceId]))[0];
    if (!old) return;
    const now = nowIso();
    await db.execute('UPDATE resources SET deleted_at=?, updated_at=? WHERE id=?', [now, now, resourceId]);
    await db.execute('UPDATE tasks SET updated_at=?, revision=revision+1 WHERE id=?', [now, old.task_id]);
    await this.history(old.task_id, 'RESOURCE_DELETED', old, undefined);
  }

  async addCheckItem(taskId: string, text: string): Promise<CheckItem> {
    const value = text.trim();
    if (!value) throw new Error('チェック項目を入力してください。');
    const db = await this.db(); const id = uuid(); const now = nowIso();
    const max = await db.select<{ max_order: number | null }[]>('SELECT MAX(sort_order) AS max_order FROM task_check_items WHERE task_id=? AND deleted_at IS NULL', [taskId]);
    const order = (max[0]?.max_order ?? -1) + 1;
    await db.execute('INSERT INTO task_check_items(id,task_id,text,checked,sort_order,created_at,updated_at) VALUES(?,?,?,0,?,?,?)', [id, taskId, value, order, now, now]);
    await db.execute('UPDATE tasks SET updated_at=?, revision=revision+1 WHERE id=?', [now, taskId]);
    await this.history(taskId, 'CHECKITEM_ADDED', undefined, { id, text: value });
    return (await db.select<CheckItem[]>('SELECT * FROM task_check_items WHERE id=?', [id]))[0];
  }

  async updateCheckItem(itemId: string, text: string): Promise<void> {
    const value = text.trim();
    if (!value) return;
    const db = await this.db();
    const old = (await db.select<CheckItem[]>('SELECT * FROM task_check_items WHERE id=? AND deleted_at IS NULL', [itemId]))[0];
    if (!old || old.text === value) return;
    const now = nowIso();
    await db.execute('UPDATE task_check_items SET text=?, updated_at=? WHERE id=?', [value, now, itemId]);
    await db.execute('UPDATE tasks SET updated_at=?, revision=revision+1 WHERE id=?', [now, old.task_id]);
    await this.history(old.task_id, 'CHECKITEM_CHANGED', old.text, value);
  }

  async toggleCheckItem(itemId: string, checked: boolean): Promise<void> {
    const db = await this.db();
    const old = (await db.select<CheckItem[]>('SELECT * FROM task_check_items WHERE id=? AND deleted_at IS NULL', [itemId]))[0];
    if (!old || Boolean(old.checked) === checked) return;
    const now = nowIso();
    await db.execute('UPDATE task_check_items SET checked=?, updated_at=? WHERE id=?', [checked ? 1 : 0, now, itemId]);
    await db.execute('UPDATE tasks SET updated_at=?, revision=revision+1 WHERE id=?', [now, old.task_id]);
    await this.history(old.task_id, 'CHECKITEM_TOGGLED', { text: old.text, checked: Boolean(old.checked) }, { text: old.text, checked });
  }

  async deleteCheckItem(itemId: string): Promise<void> {
    const db = await this.db();
    const old = (await db.select<CheckItem[]>('SELECT * FROM task_check_items WHERE id=? AND deleted_at IS NULL', [itemId]))[0];
    if (!old) return;
    const now = nowIso();
    await db.execute('UPDATE task_check_items SET deleted_at=?, updated_at=? WHERE id=?', [now, now, itemId]);
    await db.execute('UPDATE tasks SET updated_at=?, revision=revision+1 WHERE id=?', [now, old.task_id]);
    await this.history(old.task_id, 'CHECKITEM_DELETED', { text: old.text }, undefined);
  }

  async moveCheckItem(itemId: string, direction: 'UP' | 'DOWN'): Promise<void> {
    const db = await this.db();
    const item = (await db.select<CheckItem[]>('SELECT * FROM task_check_items WHERE id=? AND deleted_at IS NULL', [itemId]))[0];
    if (!item) return;
    const rows = await db.select<CheckItem[]>('SELECT * FROM task_check_items WHERE task_id=? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC', [item.task_id]);
    const index = rows.findIndex(row => row.id === itemId);
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= rows.length) return;
    const target = rows[targetIndex]; const now = nowIso();
    await db.execute('UPDATE task_check_items SET sort_order=?, updated_at=? WHERE id=?', [target.sort_order, now, item.id]);
    await db.execute('UPDATE task_check_items SET sort_order=?, updated_at=? WHERE id=?', [item.sort_order, now, target.id]);
    await db.execute('UPDATE tasks SET updated_at=?, revision=revision+1 WHERE id=?', [now, item.task_id]);
    await this.history(item.task_id, 'CHECKITEM_REORDERED', { id: item.id, direction }, { id: item.id, sort_order: target.sort_order });
  }

  async exportSnapshot(): Promise<BackupSnapshot> {
    const db = await this.db();
    const [workspaces, actors, tasks, categories, events, resources, checkItems, history] = await Promise.all([
      db.select<BackupSnapshot['workspaces']>('SELECT * FROM workspaces ORDER BY created_at ASC'),
      db.select<BackupSnapshot['actors']>('SELECT * FROM actors ORDER BY created_at ASC'),
      db.select<Task[]>('SELECT * FROM tasks ORDER BY created_at ASC'),
      db.select<Category[]>('SELECT * FROM categories ORDER BY sort_order ASC, created_at ASC'),
      db.select<ScheduleEvent[]>('SELECT * FROM schedule_events ORDER BY created_at ASC'),
      db.select<Resource[]>('SELECT * FROM resources ORDER BY task_id, sort_order ASC, created_at ASC'),
      db.select<CheckItem[]>('SELECT * FROM task_check_items ORDER BY task_id, sort_order ASC, created_at ASC'),
      db.select<HistoryEntry[]>('SELECT * FROM task_history ORDER BY created_at ASC')
    ]);
    return { format: 'deadline-dock-backup', schemaVersion: 1, exportedAt: nowIso(), workspaces, actors, tasks, categories, events, resources, checkItems, history };
  }

  private async replaceSnapshot(snapshot: BackupSnapshot): Promise<void> {
    const db = await this.db();
    await db.execute('DELETE FROM task_history');
    await db.execute('DELETE FROM task_check_items');
    await db.execute('DELETE FROM resources');
    await db.execute('DELETE FROM schedule_events');
    await db.execute('DELETE FROM tasks');
    await db.execute('DELETE FROM categories');
    await db.execute('DELETE FROM actors');
    await db.execute('DELETE FROM workspaces');

    for (const row of snapshot.workspaces) {
      await db.execute('INSERT INTO workspaces(id,name,created_at,updated_at) VALUES(?,?,?,?)', [row.id, row.name, row.created_at, row.updated_at]);
    }
    for (const row of snapshot.actors) {
      await db.execute('INSERT INTO actors(id,display_name,created_at) VALUES(?,?,?)', [row.id, row.display_name, row.created_at]);
    }
    for (const row of snapshot.categories) {
      await db.execute(
        'INSERT INTO categories(id,workspace_id,name,color,sort_order,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?)',
        [row.id, row.workspace_id, row.name, row.color || DEFAULT_CATEGORY_COLOR, row.sort_order, row.created_at, row.updated_at, row.deleted_at || null]
      );
    }
    // Insert tasks without the self-reference first so import does not depend on row ordering.
    for (const row of snapshot.tasks) {
      await db.execute(
        `INSERT INTO tasks(id,workspace_id,title,description,category_id,status,deadline_type,deadline_label,deadline_exact,deadline_range_start,deadline_range_end,snooze_until,created_at,updated_at,started_at,completed_at,revision,duplicated_from_task_id,postponement_count,deleted_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [row.id, row.workspace_id, row.title, row.description || '', row.category_id || null, row.status, row.deadline_type, row.deadline_label,
          row.deadline_exact || null, row.deadline_range_start || null, row.deadline_range_end || null, row.snooze_until || null,
          row.created_at, row.updated_at, row.started_at || null, row.completed_at || null, row.revision || 1,
          null, row.postponement_count || 0, row.deleted_at || null]
      );
    }
    for (const row of snapshot.tasks) {
      if (row.duplicated_from_task_id) {
        await db.execute('UPDATE tasks SET duplicated_from_task_id=? WHERE id=?', [row.duplicated_from_task_id, row.id]);
      }
    }
    for (const row of snapshot.events) {
      await db.execute(
        'INSERT INTO schedule_events(id,task_id,title,starts_at,ends_at,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?)',
        [row.id, row.task_id, row.title, row.starts_at, row.ends_at || null, row.created_at, row.updated_at, row.deleted_at || null]
      );
    }
    for (const row of snapshot.resources) {
      await db.execute(
        'INSERT INTO resources(id,task_id,type,label,value,sort_order,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?)',
        [row.id, row.task_id, row.type, row.label, row.value, row.sort_order, row.created_at, row.updated_at, row.deleted_at || null]
      );
    }
    for (const row of snapshot.checkItems || []) {
      await db.execute(
        'INSERT INTO task_check_items(id,task_id,text,checked,sort_order,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?)',
        [row.id, row.task_id, row.text, row.checked ? 1 : 0, row.sort_order, row.created_at, row.updated_at, row.deleted_at || null]
      );
    }
    for (const row of snapshot.history) {
      await db.execute(
        'INSERT INTO task_history(id,task_id,actor_id,event_type,old_value,new_value,created_at) VALUES(?,?,?,?,?,?,?)',
        [row.id, row.task_id, row.actor_id, row.event_type, row.old_value || null, row.new_value || null, row.created_at]
      );
    }
  }

  async importSnapshot(snapshot: BackupSnapshot): Promise<void> {
    assertBackupSnapshot(snapshot);
    const db = await this.db();
    // Restored revisions can equal old revisions with different contents. Require an explicit reconnect.
    await db.execute('UPDATE google_sync_settings SET enabled=0,auto_sync=0');
    await db.execute('DELETE FROM sync_entity_state');
    const safety = await this.exportSnapshot();
    try {
      await this.replaceSnapshot(snapshot);
    } catch (error) {
      try { await this.replaceSnapshot(safety); } catch { /* best-effort rollback */ }
      throw error;
    }
  }
}
