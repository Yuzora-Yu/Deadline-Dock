import type { Category, DeadlineInput, Task, TaskStatus } from '../types';
import { deadlineInputFromTask, parseDeadlineText, nonUrgentDeadline } from './deadline';

export const TASK_HEADERS = ['task_id','件名','締切','ステータス','分類','作業内容','表示開始','延期回数','登録日','更新日','完了日','revision','deleted_at'];
export interface SyncState { entity_id: string; last_synced_local_revision: number; last_synced_remote_hash: string }
export interface SyncConflict { id: string; entity_type?: 'TASK' | 'CATEGORY' | 'CHECK_ITEM'; entity_id: string; local_json: string; remote_json: string; resolution: 'LOCAL' | 'REMOTE' | null }
export interface LocalSyncData { tasks: Task[]; categories: Category[]; states: SyncState[]; conflicts: SyncConflict[] }
export interface RemoteSheet { spreadsheet_id: string; version: string; rows: string[][]; grid_rows: number }
export interface Patch { row_index: number; values: string[] }
export interface Acknowledgement { entity_id: string; local_revision: number; remote_hash: string }
export interface IncomingTask {
  id: string; expected_revision: number | null; title: string; description: string; category: string;
  status: TaskStatus; deadline: DeadlineInput; snooze_until: string | null; remote_hash: string; restore: boolean;
}
export interface ConflictInput { entity_id: string; local_json: string; remote_json: string }
export interface SyncPlan {
  identify: Patch[]; push: Patch[]; pull: IncomingTask[]; acknowledge: Acknowledgement[];
  pushed: Acknowledgement[]; conflicts: ConflictInput[]; warnings: string[];
}
export function paddedRow(row: string[]): string[] { return Array.from({length:14}, (_, i) => String(row[i] ?? '')); }
export async function rowHash(row: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(paddedRow(row))));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2,'0')).join('');
}
function localDate(raw: string, withTime = false) {
  const d = new Date(raw); const pad = (n: number) => String(n).padStart(2,'0');
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}${withTime ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : ''}`;
}
export function deadlineCell(task: Pick<Task,'deadline_type'|'deadline_exact'|'deadline_range_start'|'deadline_range_end'>) {
  if (task.deadline_type === 'ASAP') return 'ASAP';
  if (task.deadline_type === 'FUZZY_RANGE' && !task.deadline_range_start && !task.deadline_range_end) return '急ぎではない';
  if (task.deadline_type === 'FUZZY_RANGE') return `${localDate(task.deadline_range_start!)} ～ ${localDate(task.deadline_range_end!)}`;
  const d = new Date(task.deadline_exact!);
  return localDate(task.deadline_exact!, !(d.getHours() === 23 && d.getMinutes() === 59));
}
const statuses: Record<TaskStatus,string> = {TODO:'未着手',IN_PROGRESS:'作業中',COMPLETED:'完了'};
export function taskRow(task: Task, categories: Category[]): string[] {
  return [task.id,task.title,deadlineCell(task),statuses[task.status],categories.find(c=>c.id===task.category_id && !c.deleted_at)?.name ?? '',task.description,
    task.snooze_until ? localDate(task.snooze_until,true) : '',String(task.postponement_count),task.created_at,task.updated_at,task.completed_at || '',String(task.revision),task.deleted_at || '',JSON.stringify(deadlineInputFromTask(task))];
}
function validDeadline(d: DeadlineInput): boolean {
  if (d?.type==='FUZZY_RANGE' && d.label==='急ぎではない' && !d.exact && !d.rangeStart && !d.rangeEnd) return true;
  const date = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
  return typeof d?.label === 'string' && (d.type === 'ASAP' || (d.type === 'EXACT' && date(d.exact)) || (d.type === 'FUZZY_RANGE' && date(d.rangeStart) && date(d.rangeEnd) && Date.parse(d.rangeStart!) <= Date.parse(d.rangeEnd!)));
}
export function parseSheetDeadline(text: string, now = new Date()): DeadlineInput | null {
  if (!text.trim()) return nonUrgentDeadline();
  const range = text.match(/^(\d{4}\/\d{1,2}\/\d{1,2})\s*～\s*(\d{4}\/\d{1,2}\/\d{1,2})$/);
  if (range) {
    const a = parseDeadlineText(range[1],now); const b = parseDeadlineText(range[2],now);
    if (!a?.exact || !b?.exact || a.exact > b.exact) return null;
    const start = new Date(a.exact); start.setHours(0,0,0,0);
    return {type:'FUZZY_RANGE',label:text,rangeStart:start.toISOString(),rangeEnd:b.exact};
  }
  return parseDeadlineText(text,now);
}
export function incomingTask(row: string[], task: Task | undefined, now = new Date()): Omit<IncomingTask,'remote_hash'|'restore'> {
  const [id,title,deadline,status,category,description,snooze] = paddedRow(row);
  if (!title.trim()) throw new Error('B列（件名）が空です');
  if (title.length > 500 || description.length > 50000 || category.length > 200) throw new Error('入力が長すぎます');
  let parsed = task && deadline === deadlineCell(task) ? deadlineInputFromTask(task) : null;
  // Retain precise dates/labels exported by another PC, only when its visible date agrees.
  if (!parsed && row[13]) {
    try {
      const saved = JSON.parse(row[13]) as DeadlineInput;
      if (validDeadline(saved) && deadline === deadlineCell({deadline_type:saved.type,deadline_exact:saved.exact,deadline_range_start:saved.rangeStart,deadline_range_end:saved.rangeEnd})) parsed = saved;
    } catch { /* User-entered date is parsed below. */ }
  }
  parsed ??= parseSheetDeadline(deadline,now);
  if (!parsed || !validDeadline(parsed)) throw new Error('C列（締切）が不正です');
  const parsedStatus = (Object.entries(statuses).find(([,label])=>label===status)?.[0] ?? (status === '' ? 'TODO' : null)) as TaskStatus | null;
  if (!parsedStatus) throw new Error('D列（ステータス）が不正です');
  let snoozeIso: string | null = null;
  if (snooze.trim()) {
    const value = parseDeadlineText(snooze,now);
    if (value?.type !== 'EXACT' || !value.exact) throw new Error('G列（表示開始）が不正です');
    snoozeIso = value.exact;
    if (task?.snooze_until && snooze === localDate(task.snooze_until,true)) snoozeIso = task.snooze_until;
  }
  return {id,expected_revision:task?.revision ?? null,title:title.trim(),description,category:category.trim(),status:parsedStatus,deadline:parsed,snooze_until:snoozeIso};
}
function sameEditable(a: string[], b: string[]) {
  if (JSON.stringify([...a.slice(1,7),a[12]]) !== JSON.stringify([...b.slice(1,7),b[12]])) return false;
  if (a[13] && b[13]) {
    const semantic = (raw:string) => {const d=JSON.parse(raw) as DeadlineInput;return JSON.stringify([d.type,d.label,d.exact ?? null,d.rangeStart ?? null,d.rangeEnd ?? null]);};
    try {return semantic(a[13])===semantic(b[13]);} catch {return false;}
  }
  return true;
}
export async function planTaskSync(local: LocalSyncData, remote: RemoteSheet, now = new Date()): Promise<SyncPlan> {
  if (!remote.rows[0] || TASK_HEADERS.some((name,i)=>remote.rows[0][i]!==name)) throw new Error('タスク一覧の見出しが変更されています。列を元に戻してください。');
  const plan: SyncPlan = {identify:[],push:[],pull:[],acknowledge:[],pushed:[],conflicts:[],warnings:[]};
  const tasks = new Map(local.tasks.map(t=>[t.id,t]));
  const states = new Map(local.states.map(s=>[s.entity_id,s]));
  const resolutions = new Map(local.conflicts.filter(c=>!c.entity_type || c.entity_type==='TASK').map(c=>[c.entity_id,c]));
  const occurrences = new Map<string,number[]>();
  remote.rows.slice(1).forEach((r,i)=>{ if (r[0]) occurrences.set(r[0],[...(occurrences.get(r[0]) ?? []),i+1]); });
  const blocked = new Set<string>();
  for (const [id,rows] of occurrences) if (rows.length>1) { blocked.add(id); plan.warnings.push(`task_id ${id} が重複しています（行 ${rows.map(r=>r+1).join(', ')}）。`); }
  for (let index=1;index<remote.rows.length;index++) {
    const row = paddedRow(remote.rows[index]);
    if (row.every(v=>!v)) continue;
    const id=row[0]; const task=tasks.get(id); const state=states.get(id);
    if (blocked.has(id)) continue;
    if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) { plan.warnings.push(`行 ${index+1}: task_id が不正です。`); continue; }
    try {
      if (!id) {
        incomingTask(row,undefined,now);
        if (!row[2].trim()) {row[0]=crypto.randomUUID();row[2]='急ぎではない';row[13]=JSON.stringify(nonUrgentDeadline());plan.identify.push({row_index:index,values:row});}
        else plan.identify.push({row_index:index,values:[crypto.randomUUID()]});
        continue;
      }
      // A tombstone for a task absent on this PC is already reconciled.
      // Keep it on the sheet to prevent re-import; it is not a sync problem.
      if (row[12] && !task) continue;
      const hash=await rowHash(row);
      const localRow=task ? taskRow(task,local.categories) : null;
      if (task && localRow && sameEditable(localRow,row)) {
        plan.acknowledge.push({entity_id:id,local_revision:task.revision,remote_hash:hash}); continue;
      }
      const localChanged=!!task && (!state || task.revision!==state.last_synced_local_revision);
      const remoteChanged=!state || hash!==state.last_synced_remote_hash;
      const chosen=resolutions.get(id);
      const matchingChoice=chosen && chosen.local_json===JSON.stringify(task) && chosen.remote_json===JSON.stringify(row) ? chosen.resolution : null;
      if (task && localChanged && remoteChanged && !matchingChoice) {
        plan.conflicts.push({entity_id:id,local_json:JSON.stringify(task),remote_json:JSON.stringify(row)}); continue;
      }
      if (matchingChoice==='LOCAL' || (localChanged && !remoteChanged)) {
        plan.push.push({row_index:index,values:localRow!}); plan.pushed.push({entity_id:id,local_revision:task!.revision,remote_hash:await rowHash(localRow!)});
      } else if (remoteChanged || matchingChoice==='REMOTE') {
        if (row[12] && !task?.deleted_at) throw new Error('M列の削除情報は編集できません。削除はアプリで行ってください');
        if (task?.deleted_at && matchingChoice!=='REMOTE') { plan.conflicts.push({entity_id:id,local_json:JSON.stringify(task),remote_json:JSON.stringify(row)}); continue; }
        plan.pull.push({...incomingTask(row,task,now),remote_hash:hash,restore:matchingChoice==='REMOTE' && !!task?.deleted_at});
      }
    } catch(e) { plan.warnings.push(`行 ${index+1}${id ? ` / ${id}` : ''}: ${e instanceof Error ? e.message : String(e)}。`); }
  }
  let nextRow=remote.rows.length;
  for (const task of local.tasks) {
    if (occurrences.has(task.id)) continue;
    if (task.deleted_at) continue;
    if (states.has(task.id)) { plan.warnings.push(`タスク「${task.title}」(${task.id}) の行がシートにありません。ローカルは保持しています。`); continue; }
    const row=taskRow(task,local.categories);
    plan.push.push({row_index:nextRow++,values:row}); plan.pushed.push({entity_id:task.id,local_revision:task.revision,remote_hash:await rowHash(row)});
  }
  return plan;
}
