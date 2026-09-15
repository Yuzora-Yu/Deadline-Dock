import type {
  BackupSnapshot,
  Category,
  CheckItem,
  CategoryColor,
  DeadlineInput,
  Resource,
  ResourceType,
  ScheduleEvent,
  Task,
  TaskCreateInput,
  TaskDetails,
  TaskFilters,
  TaskStatus
} from '../types';

export const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
export const LOCAL_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

export interface Repository {
  listTasks(filters?: TaskFilters): Promise<Task[]>;
  getTaskDetails(taskId: string): Promise<TaskDetails>;
  createTask(input: TaskCreateInput): Promise<Task>;
  updateTaskFields(taskId: string, fields: { title?: string; description?: string; categoryId?: string | null; snoozeUntil?: string | null }): Promise<void>;
  updateDeadline(taskId: string, deadline: DeadlineInput): Promise<void>;
  setStatus(taskId: string, status: TaskStatus): Promise<void>;
  deleteTask(taskId: string): Promise<void>;
  restoreTask(taskId: string): Promise<void>;
  duplicateTask(taskId: string, options?: { deadline?: DeadlineInput; copyEvents?: boolean }): Promise<Task>;

  listCategories(): Promise<Category[]>;
  createCategory(name: string, color?: CategoryColor): Promise<Category>;
  renameCategory(id: string, name: string): Promise<void>;
  setCategoryColor(id: string, color: CategoryColor): Promise<void>;
  deleteCategory(id: string): Promise<void>;
  moveCategory(id: string, direction: 'UP' | 'DOWN'): Promise<void>;

  addEvent(taskId: string, input: { title: string; startsAt: string; endsAt?: string | null }): Promise<ScheduleEvent>;
  updateEvent(eventId: string, input: { title: string; startsAt: string; endsAt?: string | null }): Promise<void>;
  deleteEvent(eventId: string): Promise<void>;

  addResource(taskId: string, input: { type: ResourceType; label: string; value: string }): Promise<Resource>;
  updateResource(resourceId: string, input: { type: ResourceType; label: string; value: string }): Promise<void>;
  deleteResource(resourceId: string): Promise<void>;

  addCheckItem(taskId: string, text: string): Promise<CheckItem>;
  updateCheckItem(itemId: string, text: string): Promise<void>;
  toggleCheckItem(itemId: string, checked: boolean): Promise<void>;
  deleteCheckItem(itemId: string): Promise<void>;
  moveCheckItem(itemId: string, direction: 'UP' | 'DOWN'): Promise<void>;

  exportSnapshot(): Promise<BackupSnapshot>;
  importSnapshot(snapshot: BackupSnapshot): Promise<void>;
}

let repoPromise: Promise<Repository> | null = null;

export async function getRepository(): Promise<Repository> {
  if (!repoPromise) {
    repoPromise = (async () => {
      const isTauri = '__TAURI_INTERNALS__' in window;
      if (isTauri) {
        const { SqliteRepository } = await import('./sqliteRepository');
        return new SqliteRepository();
      }
      const { BrowserRepository } = await import('./browserRepository');
      return new BrowserRepository();
    })();
  }
  return repoPromise;
}
