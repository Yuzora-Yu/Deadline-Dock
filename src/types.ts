export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'COMPLETED';
export type DeadlineType = 'EXACT' | 'FUZZY_RANGE' | 'ASAP';
export type ResourceType = 'FILE' | 'FOLDER' | 'URL';
export type CategoryColor = 'slate' | 'blue' | 'cyan' | 'green' | 'lime' | 'yellow' | 'orange' | 'red' | 'pink' | 'purple';

export interface Category {
  id: string;
  workspace_id: string;
  name: string;
  color?: CategoryColor;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Task {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  category_id?: string | null;
  category_name?: string | null;
  category_color?: CategoryColor | null;
  status: TaskStatus;
  deadline_type: DeadlineType;
  deadline_label: string;
  deadline_exact?: string | null;
  deadline_range_start?: string | null;
  deadline_range_end?: string | null;
  snooze_until?: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  revision: number;
  duplicated_from_task_id?: string | null;
  deleted_at?: string | null;
  postponement_count: number;
  next_event_at?: string | null;
  next_event_title?: string | null;
}

export interface ScheduleEvent {
  id: string;
  task_id: string;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface Resource {
  id: string;
  task_id: string;
  type: ResourceType;
  label: string;
  value: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface CheckItem {
  id: string;
  task_id: string;
  text: string;
  checked: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface HistoryEntry {
  actor_name?: string;
  id: string;
  task_id: string;
  actor_id: string;
  event_type: string;
  old_value?: string | null;
  new_value?: string | null;
  created_at: string;
}

export interface DeadlineInput {
  type: DeadlineType;
  label: string;
  exact?: string | null;
  rangeStart?: string | null;
  rangeEnd?: string | null;
}

export interface TaskDetails {
  task: Task;
  events: ScheduleEvent[];
  resources: Resource[];
  checkItems: CheckItem[];
  history: HistoryEntry[];
}


export interface TaskComposerInitial {
  title?: string;
  deadline?: DeadlineInput;
  description?: string;
  categoryId?: string | null;
  snoozeUntil?: string | null;
  duplicatedFromTaskId?: string | null;
  sourceTitle?: string;
  events?: Array<{ title: string; startsAt: string; endsAt?: string | null }>;
  resources?: Array<{ type: ResourceType; label: string; value: string }>;
  checkItems?: Array<{ text: string; checked?: boolean }>;
}

export interface TaskCreateInput {
  title: string;
  deadline: DeadlineInput;
  description?: string;
  categoryId?: string | null;
  snoozeUntil?: string | null;
  duplicatedFromTaskId?: string | null;
  events?: Array<{ title: string; startsAt: string; endsAt?: string | null }>;
  resources?: Array<{ type: ResourceType; label: string; value: string }>;
  checkItems?: Array<{ text: string; checked?: boolean }>;
}

export interface TaskFilters {
  query?: string;
  status?: TaskStatus | 'ALL';
  categoryId?: string | 'ALL';
  postponed?: 'ALL' | 'YES' | 'NO';
  deadlineType?: DeadlineType | 'ALL';
  createdFrom?: string;
  createdTo?: string;
  completedFrom?: string;
  completedTo?: string;
  sort?: 'URGENCY' | 'DEADLINE' | 'CREATED' | 'UPDATED' | 'COMPLETED' | 'TITLE';
  includeCompleted?: boolean;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ActorRecord {
  id: string;
  display_name: string;
  created_at: string;
}

export interface BackupSnapshot {
  format: 'deadline-dock-backup';
  schemaVersion: 1;
  exportedAt: string;
  workspaces: WorkspaceRecord[];
  actors: ActorRecord[];
  tasks: Task[];
  categories: Category[];
  events: ScheduleEvent[];
  resources: Resource[];
  checkItems?: CheckItem[];
  history: HistoryEntry[];
}
