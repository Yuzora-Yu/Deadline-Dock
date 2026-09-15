import type { BackupSnapshot } from '../types';
import { DEFAULT_WORKSPACE_ID, LOCAL_ACTOR_ID } from './repository';

function fail(message: string): never {
  throw new Error(`バックアップが不正です：${message}`);
}

function requireArray(value: Record<string, unknown>, key: keyof BackupSnapshot) {
  if (!Array.isArray(value[key])) fail(`${String(key)} が配列ではありません。`);
}

function uniqueIds(rows: Array<{ id: string }>, label: string) {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id) fail(`${label} にIDのないデータがあります。`);
    if (ids.has(row.id)) fail(`${label} に重複IDがあります：${row.id}`);
    ids.add(row.id);
  }
  return ids;
}

/**
 * Validate the backup envelope and the minimum referential integrity required
 * before replacing the local database. SQLite still performs the final schema
 * validation during import.
 */
export function assertBackupSnapshot(value: unknown): asserts value is BackupSnapshot {
  if (!value || typeof value !== 'object') fail('JSONオブジェクトではありません。');
  const raw = value as Record<string, unknown>;
  if (raw.format !== 'deadline-dock-backup') fail('Deadline Dockのバックアップ形式ではありません。');
  if (raw.schemaVersion !== 1) fail(`未対応のschemaVersionです：${String(raw.schemaVersion)}`);

  for (const key of ['workspaces', 'actors', 'tasks', 'categories', 'events', 'resources', 'history'] as const) {
    requireArray(raw, key);
  }
  if (raw.checkItems !== undefined && !Array.isArray(raw.checkItems)) fail('checkItems が配列ではありません。');

  const snapshot = value as BackupSnapshot;
  const workspaceIds = uniqueIds(snapshot.workspaces, 'workspaces');
  const actorIds = uniqueIds(snapshot.actors, 'actors');
  const taskIds = uniqueIds(snapshot.tasks, 'tasks');
  const categoryIds = uniqueIds(snapshot.categories, 'categories');
  uniqueIds(snapshot.events, 'events');
  uniqueIds(snapshot.resources, 'resources');
  uniqueIds(snapshot.checkItems || [], 'checkItems');
  uniqueIds(snapshot.history, 'history');

  if (!workspaceIds.size) fail('workspaceが1件もありません。');
  if (!actorIds.size) fail('actorが1件もありません。');
  // schemaVersion 1 always writes new local data/history through these IDs.
  // Reject snapshots that would restore successfully but break the next write.
  if (!workspaceIds.has(DEFAULT_WORKSPACE_ID)) fail('Default Workspaceがありません。');
  if (!actorIds.has(LOCAL_ACTOR_ID)) fail('Local Actorがありません。');

  for (const category of snapshot.categories) {
    if (!workspaceIds.has(category.workspace_id)) fail(`category ${category.id} のworkspace_idが存在しません。`);
  }
  for (const task of snapshot.tasks) {
    if (!workspaceIds.has(task.workspace_id)) fail(`task ${task.id} のworkspace_idが存在しません。`);
    if (task.category_id && !categoryIds.has(task.category_id)) fail(`task ${task.id} のcategory_idが存在しません。`);
    if (task.duplicated_from_task_id && !taskIds.has(task.duplicated_from_task_id)) fail(`task ${task.id} の複写元が存在しません。`);
  }
  for (const event of snapshot.events) {
    if (!taskIds.has(event.task_id)) fail(`event ${event.id} のtask_idが存在しません。`);
  }
  for (const resource of snapshot.resources) {
    if (!taskIds.has(resource.task_id)) fail(`resource ${resource.id} のtask_idが存在しません。`);
  }
  for (const item of snapshot.checkItems || []) {
    if (!taskIds.has(item.task_id)) fail(`checkItem ${item.id} のtask_idが存在しません。`);
  }
  for (const history of snapshot.history) {
    if (!taskIds.has(history.task_id)) fail(`history ${history.id} のtask_idが存在しません。`);
    if (!actorIds.has(history.actor_id)) fail(`history ${history.id} のactor_idが存在しません。`);
  }
}
