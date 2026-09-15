import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { planTaskSync, type Acknowledgement, type ConflictInput, type IncomingTask, type LocalSyncData, type Patch, type RemoteSheet } from './googleSyncCore';
export interface Connection { client_id: string; oauth_ready: boolean; email: string | null; spreadsheet_url: string | null; enabled: boolean; initialized: boolean; initial_sync_confirmed: boolean; credential_available: boolean; auto_sync: boolean; poll_seconds: number; last_success_at: string | null; last_error: string | null }
export interface SyncTransport {
  local(): Promise<LocalSyncData>; read(): Promise<RemoteSheet>;
  write(remote: RemoteSheet, patches: Patch[]): Promise<void>;
  apply(remote: RemoteSheet, changes: IncomingTask[]): Promise<string[]>;
  acknowledge(remote: RemoteSheet, items: Acknowledgement[]): Promise<void>;
  conflicts(remote: RemoteSheet, items: ConflictInput[]): Promise<void>;
}
export const desktopTransport: SyncTransport = {
  local:()=>invoke('google_local_sync_data'), read:()=>invoke('google_read_tasks'),
  write:(r,patches)=>invoke('google_write_tasks',{spreadsheetId:r.spreadsheet_id,expectedVersion:r.version,patches}),
  apply:(r,changes)=>invoke('google_apply_tasks',{spreadsheetId:r.spreadsheet_id,changes}),
  acknowledge:(r,items)=>invoke('google_acknowledge',{spreadsheetId:r.spreadsheet_id,items}),
  conflicts:(r,items)=>invoke('google_conflicts',{spreadsheetId:r.spreadsheet_id,items}),
};
export interface SyncResult { warnings: string[]; conflicts: number; changed: boolean; pending: number }
export async function synchronizeTasks(transport: SyncTransport): Promise<SyncResult> {
  // ID assignment precedes local creation. A lost write response cannot create duplicate tasks.
  for (let pass=0; pass<3; pass++) {
    const remote=await transport.read(); const local=await transport.local();
    const plan=await planTaskSync(local,remote);
    if (plan.identify.length) { await transport.write(remote,plan.identify.slice(0,1000)); continue; }
    if (plan.conflicts.length) await transport.conflicts(remote,plan.conflicts);
    const warnings=[...plan.warnings];
    if (plan.pull.length) warnings.push(...await transport.apply(remote,plan.pull));
    if (plan.acknowledge.length) await transport.acknowledge(remote,plan.acknowledge);
    const push=plan.push.slice(0,1000);
    if (push.length) { await transport.write(remote,push); await transport.acknowledge(remote,plan.pushed.slice(0,1000)); }
    return {warnings,conflicts:plan.conflicts.length,changed:plan.pull.length>0 || push.length>0,pending:plan.push.length-push.length};
  }
  return {warnings:['新規行へのID設定を続行しています。次回同期で取り込みます。'],conflicts:0,changed:false,pending:1};
}
let busy=false;
let queued=false;
let queuedManual=false;
let failures=0;
let retryAt=0;
let state: {busy:boolean; message:string; warnings:string[]}={busy:false,message:'未同期',warnings:[]};
const subscribers=new Set<()=>void>();
export function syncView() { return state; }
export function subscribeSync(callback:()=>void) {subscribers.add(callback);return ()=>{subscribers.delete(callback);};}
function publish(next:typeof state) {state=next;subscribers.forEach(fn=>fn());}
export function readableSyncError(error:unknown) {return String(error instanceof Error ? error.message : error).replace(/^[A-Z_]+\|/,'');}
export async function syncNow(manual=true):Promise<void> {
  if (!('__TAURI_INTERNALS__' in window)) return;
  if (busy) { queued=true; queuedManual ||= manual; return; }
  if (!manual && Date.now()<retryAt) return;
  busy=true;
  try {
    const connection=await invoke<Connection>('google_status');
    if (!connection.enabled || !connection.initialized || !connection.credential_available) {publish({busy:false,message:connection.email?'Google認証・接続が必要です':'Google未接続',warnings:[]});return;}
    if (!manual && !connection.auto_sync) return;
    if (!connection.initial_sync_confirmed) {publish({busy:false,message:'初回同期の確認待ち',warnings:['設定のGoogle Sheets連携で、両方のタスクを確認して同期を開始してください。']});return;}
    publish({...state,busy:true,message:'同期中…'});
    await invoke('google_prepare_sheet');
    const lifecycle=await invoke<{changed:boolean}>('google_sync_task_lifecycle');
    const categories=await invoke<{warnings:string[];changed:boolean}>('google_sync_related',{entityType:'CATEGORY'});
    const result=await synchronizeTasks(desktopTransport);
    const checks=await invoke<{warnings:string[];changed:boolean}>('google_sync_related',{entityType:'CHECK_ITEM'});
    const issues=[...categories.warnings,...result.warnings,...checks.warnings,...(result.conflicts ? [`${result.conflicts}件の競合があります。採用する内容を選んでください。`] : [])];
    const message=result.conflicts?'同期競合あり':issues.length?'同期警告あり':result.pending?`同期待ち ${result.pending}件`:'同期済み';
    await invoke('google_sync_report',{error:issues.length ? issues.join('\n').slice(0,10000) : result.pending ? message : null});
    failures=0;retryAt=0;publish({busy:false,message,warnings:issues});
    if (lifecycle.changed || result.changed || categories.changed || checks.changed) window.dispatchEvent(new Event('deadline-dock-sync-applied'));
  } catch(error) {
    failures++;retryAt=Date.now()+Math.min(300000,5000*2**Math.min(failures-1,6));
    const message=readableSyncError(error);publish({busy:false,message:'同期待ち・エラー',warnings:[message]});
    try {await invoke('google_sync_report',{error:message});} catch { /* Keep local task operations available. */ }
  } finally {
    busy=false;if(state.busy)publish({...state,busy:false});
    if (queued) {const manualNext=queuedManual;queued=false;queuedManual=false;void syncNow(manualNext);}
  }
}
export function startGoogleSync():()=>void {
  if (!('__TAURI_INTERNALS__' in window)) return ()=>{};
  let disposed=false;let debounce:ReturnType<typeof setTimeout> | undefined;let polling:ReturnType<typeof setTimeout> | undefined;
  const trigger=()=>{clearTimeout(debounce);debounce=setTimeout(()=>void syncNow(false),3000);};
  const immediate=()=>void syncNow(false);
  async function poll() {
    await syncNow(false);
    let delay=60000;
    try { delay=(await invoke<Connection>('google_status')).poll_seconds*1000; } catch { /* Retry on next poll. */ }
    if (!disposed) polling=setTimeout(()=>void poll(),delay);
  }
  const stopEvent=listen('deadline-dock-local-mutation',trigger);
  const deleted=()=>{clearTimeout(debounce);void syncNow(false);};
  const stopDeleted=listen('deadline-dock-task-lifecycle',deleted);
  window.addEventListener('deadline-dock-task-lifecycle',deleted);
  window.addEventListener('deadline-dock-local-mutation',trigger);
  window.addEventListener('focus',immediate);window.addEventListener('online',immediate);
  void poll();
  return ()=>{disposed=true;clearTimeout(debounce);clearTimeout(polling);window.removeEventListener('deadline-dock-local-mutation',trigger);window.removeEventListener('focus',immediate);window.removeEventListener('online',immediate);void stopEvent.then(stop=>stop()).catch(()=>{});window.removeEventListener('deadline-dock-task-lifecycle',deleted);void stopDeleted.then(stop=>stop()).catch(()=>{});};
}
