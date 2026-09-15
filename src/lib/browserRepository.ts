import type {
  ActorRecord, BackupSnapshot, Category, CategoryColor, CheckItem, DeadlineInput, HistoryEntry, Resource, ResourceType, ScheduleEvent,
  Task, TaskCreateInput, TaskDetails, TaskFilters, TaskStatus, WorkspaceRecord
} from '../types';
import { compareUrgency, deadlineInputFromTask, describeDeadlineChange, thisWeekDeadline, todayDeadline } from './deadline';
import { nowIso } from './datetime';
import { assertBackupSnapshot } from './backup';
import { DEFAULT_WORKSPACE_ID, LOCAL_ACTOR_ID, type Repository } from './repository';
import { DEFAULT_CATEGORY_COLOR } from './categoryColors';

type Store = {
  workspaces: WorkspaceRecord[];
  actors: ActorRecord[];
  tasks: Task[];
  categories: Category[];
  events: ScheduleEvent[];
  resources: Resource[];
  checkItems: CheckItem[];
  history: HistoryEntry[];
};

const KEY = 'deadline-dock-browser-preview-v1';
const uuid = () => crypto.randomUUID();

function dateStartIso(date: string) {
  return new Date(`${date}T00:00:00`).toISOString();
}

function dateEndIso(date: string) {
  return new Date(`${date}T23:59:59.999`).toISOString();
}


function loadStore(): Store {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<Store>;
      const now = nowIso();
      return {
        workspaces: parsed.workspaces?.length ? parsed.workspaces : [{ id: DEFAULT_WORKSPACE_ID, name: 'Default Workspace', created_at: now, updated_at: now }],
        actors: parsed.actors?.length ? parsed.actors : [{ id: LOCAL_ACTOR_ID, display_name: 'Local User', created_at: now }],
        tasks: parsed.tasks || [], categories: (parsed.categories || []).map(category => ({ ...category, color: category.color || DEFAULT_CATEGORY_COLOR })), events: parsed.events || [], resources: parsed.resources || [], checkItems: parsed.checkItems || [], history: parsed.history || []
      };
    } catch { /* reset below */ }
  }
  const now = nowIso();
  const cat1: Category = { id: uuid(), workspace_id: DEFAULT_WORKSPACE_ID, name: '総務', color: 'blue', sort_order: 0, created_at: now, updated_at: now };
  const cat2: Category = { id: uuid(), workspace_id: DEFAULT_WORKSPACE_ID, name: '営業', color: 'orange', sort_order: 1, created_at: now, updated_at: now };
  const d1 = todayDeadline();
  const d2 = thisWeekDeadline();
  const t1: Task = {
    id: uuid(), workspace_id: DEFAULT_WORKSPACE_ID, title: '決算資料をまとめる', description: 'ブラウザプレビュー用のサンプルです。',
    category_id: cat1.id, category_name: cat1.name, status: 'IN_PROGRESS', deadline_type: d1.type, deadline_label: d1.label,
    deadline_exact: d1.exact, deadline_range_start: d1.rangeStart, deadline_range_end: d1.rangeEnd,
    created_at: now, updated_at: now, started_at: now, revision: 1, postponement_count: 1
  };
  const t2: Task = {
    id: uuid(), workspace_id: DEFAULT_WORKSPACE_ID, title: 'A社へ見積書送付', description: '', category_id: cat2.id, category_name: cat2.name,
    status: 'TODO', deadline_type: d2.type, deadline_label: d2.label, deadline_exact: d2.exact,
    deadline_range_start: d2.rangeStart, deadline_range_end: d2.rangeEnd, created_at: now, updated_at: now, revision: 1, postponement_count: 0
  };
  const event: ScheduleEvent = { id: uuid(), task_id: t1.id, title: '進捗会議', starts_at: new Date(Date.now() + 86_400_000).toISOString(), created_at: now, updated_at: now };
  const store: Store = {
    workspaces: [{ id: DEFAULT_WORKSPACE_ID, name: 'Default Workspace', created_at: now, updated_at: now }],
    actors: [{ id: LOCAL_ACTOR_ID, display_name: 'Local User', created_at: now }],
    tasks: [t1, t2], categories: [cat1, cat2], events: [event], resources: [], checkItems: [], history: []
  };
  localStorage.setItem(KEY, JSON.stringify(store));
  return store;
}

export class BrowserRepository implements Repository {
  private store = loadStore();

  private save() { localStorage.setItem(KEY, JSON.stringify(this.store)); }
  private log(taskId: string, eventType: string, oldValue?: unknown, newValue?: unknown) {
    this.store.history.unshift({ id: uuid(), task_id: taskId, actor_id: LOCAL_ACTOR_ID, event_type: eventType, old_value: oldValue === undefined ? null : JSON.stringify(oldValue), new_value: newValue === undefined ? null : JSON.stringify(newValue), created_at: nowIso() });
  }
  private task(id: string) {
    const task = this.store.tasks.find(t => t.id === id && !t.deleted_at);
    if (!task) throw new Error('タスクが見つかりません。');
    return task;
  }
  private hydrate(task: Task): Task {
    const category = this.store.categories.find(c => c.id === task.category_id && !c.deleted_at);
    const next = this.store.events.filter(e => e.task_id === task.id && !e.deleted_at && new Date(e.starts_at) >= new Date()).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
    return { ...task, category_name: category?.name ?? null, category_color: category?.color || null, next_event_at: next?.starts_at ?? null, next_event_title: next?.title ?? null };
  }

  async listTasks(filters: TaskFilters = {}) {
    let items = this.store.tasks.filter(t => !t.deleted_at);
    items = filters.includeCompleted ? items : items.filter(t => t.status !== 'COMPLETED');
    if (filters.status && filters.status !== 'ALL') items = items.filter(t => t.status === filters.status);
    if (filters.categoryId && filters.categoryId !== 'ALL') items = items.filter(t => t.category_id === filters.categoryId);
    if (filters.postponed === 'YES') items = items.filter(t => t.postponement_count > 0);
    if (filters.postponed === 'NO') items = items.filter(t => t.postponement_count === 0);
    if (filters.deadlineType && filters.deadlineType !== 'ALL') items = items.filter(t => t.deadline_type === filters.deadlineType);
    if (filters.createdFrom) items = items.filter(t => t.created_at >= dateStartIso(filters.createdFrom!));
    if (filters.createdTo) items = items.filter(t => t.created_at <= dateEndIso(filters.createdTo!));
    if (filters.completedFrom) items = items.filter(t => !!t.completed_at && t.completed_at >= dateStartIso(filters.completedFrom!));
    if (filters.completedTo) items = items.filter(t => !!t.completed_at && t.completed_at <= dateEndIso(filters.completedTo!));
    if (filters.query?.trim()) {
      const q = filters.query.trim().toLowerCase();
      items = items.filter(t => {
        const cat = this.store.categories.find(c => c.id === t.category_id)?.name || '';
        const resources = this.store.resources.filter(r => r.task_id === t.id && !r.deleted_at).map(r => `${r.label} ${r.value}`).join(' ');
        const checkItems = this.store.checkItems.filter(item => item.task_id === t.id && !item.deleted_at).map(item => item.text).join(' ');
        return `${t.title} ${t.description} ${cat} ${resources} ${checkItems}`.toLowerCase().includes(q);
      });
    }
    const hydrated = items.map(t => this.hydrate(t));
    if (filters.sort === 'TITLE') return hydrated.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    if (filters.sort === 'CREATED') return hydrated.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (filters.sort === 'UPDATED') return hydrated.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (filters.sort === 'COMPLETED') return hydrated.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
    if (filters.sort === 'DEADLINE') return hydrated.sort((a, b) => (a.deadline_exact || a.deadline_range_end || '9999').localeCompare(b.deadline_exact || b.deadline_range_end || '9999'));
    return hydrated.sort(compareUrgency);
  }

  async getTaskDetails(taskId: string): Promise<TaskDetails> {
    const task = this.hydrate(this.task(taskId));
    return {
      task,
      events: this.store.events.filter(e => e.task_id === taskId && !e.deleted_at).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      resources: this.store.resources.filter(r => r.task_id === taskId && !r.deleted_at).sort((a, b) => a.sort_order - b.sort_order),
      checkItems: this.store.checkItems.filter(item => item.task_id === taskId && !item.deleted_at).sort((a, b) => a.sort_order - b.sort_order),
      history: this.store.history.filter(h => h.task_id === taskId).sort((a, b) => b.created_at.localeCompare(a.created_at))
    };
  }

  async createTask(input: TaskCreateInput) {
    const now = nowIso();
    const task: Task = {
      id: uuid(), workspace_id: DEFAULT_WORKSPACE_ID, title: input.title.trim(), description: input.description || '', category_id: input.categoryId || null,
      status: 'TODO', deadline_type: input.deadline.type, deadline_label: input.deadline.label, deadline_exact: input.deadline.exact || null,
      deadline_range_start: input.deadline.rangeStart || null, deadline_range_end: input.deadline.rangeEnd || null,
      snooze_until: input.snoozeUntil || null, created_at: now, updated_at: now, revision: 1, postponement_count: 0,
      duplicated_from_task_id: input.duplicatedFromTaskId || null
    };
    this.store.tasks.push(task);
    this.log(task.id, 'TASK_CREATED', undefined, { title: task.title, deadline: input.deadline });
    if (input.duplicatedFromTaskId) this.log(task.id, 'TASK_DUPLICATED', { source_task_id: input.duplicatedFromTaskId }, undefined);
    for (const event of input.events || []) await this.addEvent(task.id, event);
    for (const resource of input.resources || []) await this.addResource(task.id, resource);
    for (const item of input.checkItems || []) { const created = await this.addCheckItem(task.id, item.text); if (item.checked) await this.toggleCheckItem(created.id, true); }
    this.save();
    return this.hydrate(task);
  }

  async updateTaskFields(taskId: string, fields: { title?: string; description?: string; categoryId?: string | null; snoozeUntil?: string | null }) {
    const t = this.task(taskId); const before = { ...t };
    if (fields.title !== undefined) t.title = fields.title.trim();
    if (fields.description !== undefined) t.description = fields.description;
    if (fields.categoryId !== undefined) t.category_id = fields.categoryId;
    if (fields.snoozeUntil !== undefined) t.snooze_until = fields.snoozeUntil;
    t.updated_at = nowIso(); t.revision++;
    if (before.title !== t.title) this.log(taskId, 'TITLE_CHANGED', before.title, t.title);
    if (before.description !== t.description) this.log(taskId, 'DESCRIPTION_CHANGED', before.description, t.description);
    if (before.category_id !== t.category_id) this.log(taskId, 'CATEGORY_CHANGED', before.category_id, t.category_id);
    if (before.snooze_until !== t.snooze_until) this.log(taskId, 'SNOOZE_CHANGED', before.snooze_until, t.snooze_until);
    this.save();
  }

  async updateDeadline(taskId: string, deadline: DeadlineInput) {
    const t = this.task(taskId); const old = deadlineInputFromTask(t); const change = describeDeadlineChange(old, deadline);
    t.deadline_type = deadline.type; t.deadline_label = deadline.label; t.deadline_exact = deadline.exact || null;
    t.deadline_range_start = deadline.rangeStart || null; t.deadline_range_end = deadline.rangeEnd || null;
    if (change.direction === 'POSTPONED') t.postponement_count++;
    t.updated_at = nowIso(); t.revision++;
    this.log(taskId, 'DEADLINE_CHANGED', old, { ...deadline, ...change }); this.save();
  }

  async setStatus(taskId: string, status: TaskStatus) {
    const t = this.task(taskId); const old = t.status;
    if (old === status) return;
    const now = nowIso();
    t.status = status; t.updated_at = now; t.revision++;
    if (status === 'IN_PROGRESS' && !t.started_at) t.started_at = now;
    t.completed_at = status === 'COMPLETED' ? now : null;
    this.log(taskId, 'STATUS_CHANGED', old, status); this.save();
  }

  async deleteTask(taskId: string) {
    const t = this.task(taskId); const now = nowIso();
    t.deleted_at = now; t.updated_at = now; t.revision++;
    this.log(taskId, 'TASK_DELETED', { title: t.title }, undefined); this.save();
  }

  async restoreTask(taskId: string) {
    const t = this.store.tasks.find(x => x.id === taskId);
    if (!t || !t.deleted_at) return;
    const old = t.deleted_at;
    t.deleted_at = null;
    t.updated_at = nowIso();
    t.revision++;
    this.log(taskId, 'TASK_RESTORED', old, null);
    this.save();
  }

  async duplicateTask(taskId: string, options: { deadline?: DeadlineInput; copyEvents?: boolean } = {}) {
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

  async listCategories() { return this.store.categories.filter(c => !c.deleted_at).sort((a, b) => a.sort_order - b.sort_order); }
  async createCategory(name: string, color: CategoryColor = DEFAULT_CATEGORY_COLOR) { const now = nowIso(); const c: Category = { id: uuid(), workspace_id: DEFAULT_WORKSPACE_ID, name: name.trim(), color, sort_order: this.store.categories.length, created_at: now, updated_at: now }; this.store.categories.push(c); this.save(); return c; }
  async renameCategory(id: string, name: string) { const c = this.store.categories.find(x => x.id === id); if (c) { c.name = name.trim(); c.updated_at = nowIso(); this.save(); } }
  async setCategoryColor(id: string, color: CategoryColor) { const c = this.store.categories.find(x => x.id === id); if (c) { c.color = color; c.updated_at = nowIso(); this.save(); } }
  async deleteCategory(id: string) { const c = this.store.categories.find(x => x.id === id); if (c) c.deleted_at = nowIso(); this.store.tasks.forEach(t => { if (t.category_id === id) { this.log(t.id, 'CATEGORY_CHANGED', id, null); t.category_id = null; t.updated_at = nowIso(); t.revision++; } }); this.save(); }
  async moveCategory(id: string, direction: 'UP' | 'DOWN') { const cats = await this.listCategories(); const i = cats.findIndex(c => c.id === id); const j = direction === 'UP' ? i - 1 : i + 1; if (i < 0 || j < 0 || j >= cats.length) return; [cats[i].sort_order, cats[j].sort_order] = [cats[j].sort_order, cats[i].sort_order]; this.save(); }

  async addEvent(taskId: string, input: { title: string; startsAt: string; endsAt?: string | null }) { const now = nowIso(); const e: ScheduleEvent = { id: uuid(), task_id: taskId, title: input.title.trim(), starts_at: input.startsAt, ends_at: input.endsAt || null, created_at: now, updated_at: now }; this.store.events.push(e); const t=this.task(taskId); t.updated_at=now; t.revision++; this.log(taskId, 'EVENT_ADDED', undefined, e); this.save(); return e; }
  async updateEvent(eventId: string, input: { title: string; startsAt: string; endsAt?: string | null }) { const e = this.store.events.find(x => x.id === eventId && !x.deleted_at); if (!e) return; const old = { ...e }; e.title = input.title.trim(); e.starts_at = input.startsAt; e.ends_at = input.endsAt || null; e.updated_at = nowIso(); { const t=this.task(e.task_id); t.updated_at=e.updated_at; t.revision++; } this.log(e.task_id, 'EVENT_CHANGED', old, e); this.save(); }
  async deleteEvent(eventId: string) { const e = this.store.events.find(x => x.id === eventId && !x.deleted_at); if (!e) return; e.deleted_at = nowIso(); { const t=this.task(e.task_id); t.updated_at=e.deleted_at; t.revision++; } this.log(e.task_id, 'EVENT_DELETED', e, undefined); this.save(); }

  async addResource(taskId: string, input: { type: ResourceType; label: string; value: string }) { const now = nowIso(); const r: Resource = { id: uuid(), task_id: taskId, type: input.type, label: input.label.trim() || input.value, value: input.value.trim(), sort_order: this.store.resources.filter(x => x.task_id === taskId && !x.deleted_at).length, created_at: now, updated_at: now }; this.store.resources.push(r); { const t=this.task(taskId); t.updated_at=now; t.revision++; } this.log(taskId, 'RESOURCE_ADDED', undefined, r); this.save(); return r; }
  async updateResource(resourceId: string, input: { type: ResourceType; label: string; value: string }) { const r = this.store.resources.find(x => x.id === resourceId && !x.deleted_at); if (!r) return; const old = { ...r }; r.type = input.type; r.label = input.label.trim() || input.value; r.value = input.value.trim(); r.updated_at = nowIso(); { const t=this.task(r.task_id); t.updated_at=r.updated_at; t.revision++; } this.log(r.task_id, 'RESOURCE_CHANGED', old, r); this.save(); }
  async deleteResource(resourceId: string) { const r = this.store.resources.find(x => x.id === resourceId && !x.deleted_at); if (!r) return; r.deleted_at = nowIso(); { const t=this.task(r.task_id); t.updated_at=r.deleted_at; t.revision++; } this.log(r.task_id, 'RESOURCE_DELETED', r, undefined); this.save(); }

  async addCheckItem(taskId: string, text: string) {
    const value = text.trim();
    if (!value) throw new Error('チェック項目を入力してください。');
    const now = nowIso();
    const item: CheckItem = { id: uuid(), task_id: taskId, text: value, checked: 0, sort_order: this.store.checkItems.filter(row => row.task_id === taskId && !row.deleted_at).length, created_at: now, updated_at: now };
    this.store.checkItems.push(item);
    const task = this.task(taskId); task.updated_at = now; task.revision++;
    this.log(taskId, 'CHECKITEM_ADDED', undefined, { id: item.id, text: item.text }); this.save(); return item;
  }
  async updateCheckItem(itemId: string, text: string) {
    const item = this.store.checkItems.find(row => row.id === itemId && !row.deleted_at); const value = text.trim();
    if (!item || !value || item.text === value) return;
    const old = item.text; item.text = value; item.updated_at = nowIso(); const task = this.task(item.task_id); task.updated_at = item.updated_at; task.revision++;
    this.log(item.task_id, 'CHECKITEM_CHANGED', old, value); this.save();
  }
  async toggleCheckItem(itemId: string, checked: boolean) {
    const item = this.store.checkItems.find(row => row.id === itemId && !row.deleted_at); if (!item || Boolean(item.checked) === checked) return;
    const old = Boolean(item.checked); item.checked = checked ? 1 : 0; item.updated_at = nowIso(); const task = this.task(item.task_id); task.updated_at = item.updated_at; task.revision++;
    this.log(item.task_id, 'CHECKITEM_TOGGLED', { text: item.text, checked: old }, { text: item.text, checked }); this.save();
  }
  async deleteCheckItem(itemId: string) {
    const item = this.store.checkItems.find(row => row.id === itemId && !row.deleted_at); if (!item) return;
    item.deleted_at = nowIso(); item.updated_at = item.deleted_at; const task = this.task(item.task_id); task.updated_at = item.updated_at; task.revision++;
    this.log(item.task_id, 'CHECKITEM_DELETED', { text: item.text }, undefined); this.save();
  }
  async moveCheckItem(itemId: string, direction: 'UP' | 'DOWN') {
    const item = this.store.checkItems.find(row => row.id === itemId && !row.deleted_at); if (!item) return;
    const rows = this.store.checkItems.filter(row => row.task_id === item.task_id && !row.deleted_at).sort((a, b) => a.sort_order - b.sort_order);
    const index = rows.findIndex(row => row.id === itemId); const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= rows.length) return;
    const target = rows[targetIndex]; [item.sort_order, target.sort_order] = [target.sort_order, item.sort_order]; const now = nowIso(); item.updated_at = now; target.updated_at = now;
    const task = this.task(item.task_id); task.updated_at = now; task.revision++; this.log(item.task_id, 'CHECKITEM_REORDERED', { id: item.id, direction }, { id: item.id, sort_order: item.sort_order }); this.save();
  }

  async exportSnapshot(): Promise<BackupSnapshot> {
    const now = nowIso();
    return {
      format: 'deadline-dock-backup',
      schemaVersion: 1,
      exportedAt: now,
      workspaces: structuredClone(this.store.workspaces),
      actors: structuredClone(this.store.actors),
      tasks: structuredClone(this.store.tasks),
      categories: structuredClone(this.store.categories),
      events: structuredClone(this.store.events),
      resources: structuredClone(this.store.resources),
      checkItems: structuredClone(this.store.checkItems),
      history: structuredClone(this.store.history)
    };
  }

  async importSnapshot(snapshot: BackupSnapshot): Promise<void> {
    assertBackupSnapshot(snapshot);
    this.store = {
      workspaces: structuredClone(snapshot.workspaces),
      actors: structuredClone(snapshot.actors),
      tasks: structuredClone(snapshot.tasks),
      categories: structuredClone(snapshot.categories).map(category => ({ ...category, color: category.color || DEFAULT_CATEGORY_COLOR })),
      events: structuredClone(snapshot.events),
      resources: structuredClone(snapshot.resources),
      checkItems: structuredClone(snapshot.checkItems || []),
      history: structuredClone(snapshot.history)
    };
    this.save();
  }
}

