import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { incomingTask, paddedRow, planTaskSync, rowHash, taskRow, TASK_HEADERS, type LocalSyncData, type RemoteSheet } from './googleSyncCore';
import { synchronizeTasks, type SyncTransport } from './googleSync';
import { getUrgency,nonUrgentDeadline } from './deadline';
const id='11111111-1111-4111-8111-111111111111';
const now='2026-09-15T00:00:00.000Z';
function task(overrides:Partial<Task>={}):Task { return {id,workspace_id:'00000000-0000-4000-8000-000000000001',title:'報告書',description:'内容',status:'TODO',deadline_type:'EXACT',deadline_label:'9/18',deadline_exact:'2026-09-18T14:59:59.999Z',created_at:now,updated_at:now,revision:1,postponement_count:0,...overrides}; }
function sheet(rows:string[][]):RemoteSheet {return {spreadsheet_id:'test_sheet',version:'v1',grid_rows:1000,rows:[paddedRow(TASK_HEADERS),...rows.map(paddedRow)]};}
async function base(t=task()):Promise<LocalSyncData> {return {tasks:[t],categories:[],conflicts:[],states:[{entity_id:t.id,last_synced_local_revision:t.revision,last_synced_remote_hash:await rowHash(taskRow(t,[]))}]};}
describe('task sync planning',()=>{
  it('accepts title-only rows with a non-urgent deadline without inventing a date',async()=>{
    const remote=sheet([['','スマホから追加']]);const data:LocalSyncData={tasks:[],categories:[],conflicts:[],states:[]};
    const plan=await planTaskSync(data,remote);expect(plan.warnings).toHaveLength(0);
    expect(plan.identify[0].values[2]).toBe('急ぎではない');
    const parsed=incomingTask(plan.identify[0].values,undefined);expect(parsed.deadline).toEqual(nonUrgentDeadline());
    expect(getUrgency(task({deadline_type:'FUZZY_RANGE',deadline_label:'急ぎではない',deadline_exact:null}),new Date('2099-01-01')).tone).toBe('normal');
  });
  it('pushes a saved multiline description update without losing line breaks',async()=>{const data=await base();data.tasks=[task({description:'更新した作業内容\n二行目',revision:2})];const p=await planTaskSync(data,sheet([taskRow(task(),[])]));expect(p.push[0].values[5]).toBe('更新した作業内容\n二行目');expect(p.pull).toHaveLength(0);});
  it('pushes initial local tasks',async()=>{const t=task();const p=await planTaskSync({...await base(t),states:[]},sheet([]));expect(p.push[0].values[0]).toBe(id);expect(p.push[0].row_index).toBe(1);});
  it('does nothing for unchanged rows except confirming the baseline',async()=>{const p=await planTaskSync(await base(),sheet([taskRow(task(),[])]));expect(p.push).toHaveLength(0);expect(p.pull).toHaveLength(0);expect(p.acknowledge).toHaveLength(1);});
  it('pushes a local title change',async()=>{const data=await base();data.tasks=[task({title:'変更後',revision:2})];const p=await planTaskSync(data,sheet([taskRow(task(),[])]));expect(p.push[0].values[1]).toBe('変更後');});
  it('pulls a remote title change',async()=>{const row=taskRow(task(),[]);row[1]='シート編集';const p=await planTaskSync(await base(),sheet([row]));expect(p.pull[0].title).toBe('シート編集');expect(p.pull[0].expected_revision).toBe(1);});
  it('records concurrent changes instead of overwriting',async()=>{const data=await base();data.tasks=[task({title:'ローカル',revision:2})];const row=taskRow(task(),[]);row[1]='リモート';const p=await planTaskSync(data,sheet([row]));expect(p.conflicts).toHaveLength(1);expect(p.push).toHaveLength(0);expect(p.pull).toHaveLength(0);});
  it('applies a conflict choice only to the exact reviewed versions',async()=>{const data=await base();data.tasks=[task({title:'ローカル',revision:2})];const row=taskRow(task(),[]);row[1]='リモート';let p=await planTaskSync(data,sheet([row]));data.conflicts=[{id:'conflict',...p.conflicts[0],resolution:'LOCAL'}];p=await planTaskSync(data,sheet([row]));expect(p.push).toHaveLength(1);row[1]='さらに編集';p=await planTaskSync(data,sheet([row]));expect(p.push).toHaveLength(0);expect(p.conflicts).toHaveLength(1);});
  it('identifies a valid new sheet row before creating anything locally',async()=>{const p=await planTaskSync({tasks:[],categories:[],states:[],conflicts:[]},sheet([['','新規','2026/09/20','作業中','新しい分類']]));expect(p.identify).toHaveLength(1);expect(p.identify[0].values).toHaveLength(1);expect(p.pull).toHaveLength(0);});
  it('rejects impossible dates and includes the cell and row in the warning',async()=>{const p=await planTaskSync(await base(),sheet([[id,'報告書','2026/02/30','未着手']]));expect(p.pull).toHaveLength(0);expect(p.warnings[0]).toContain('行 2');expect(p.warnings[0]).toContain('C列');});
  it('matches by UUID after rows are reordered',async()=>{const a=task();const b=task({id:'22222222-2222-4222-8222-222222222222',title:'2'});const data=await base(a);data.tasks.push({...b,title:'2変更',revision:2});data.states.push((await base(b)).states[0]);const p=await planTaskSync(data,sheet([taskRow(b,[]),taskRow(a,[])]));expect(p.push[0].row_index).toBe(1);expect(p.push[0].values[0]).toBe(b.id);});
  it('blocks every duplicate UUID row',async()=>{const p=await planTaskSync(await base(),sheet([taskRow(task(),[]),taskRow(task(),[])]));expect(p.push).toHaveLength(0);expect(p.pull).toHaveLength(0);expect(p.warnings[0]).toContain('重複');});
  it('does not delete or recreate a physically removed known row',async()=>{const p=await planTaskSync(await base(),sheet([]));expect(p.push).toHaveLength(0);expect(p.pull).toHaveLength(0);expect(p.warnings[0]).toContain('保持');});
  it('pushes local soft delete as a tombstone',async()=>{const data=await base();data.tasks=[task({deleted_at:now,revision:2})];const p=await planTaskSync(data,sheet([taskRow(task(),[])]));expect(p.push[0].values[12]).toBe(now);});
  it('quietly skips a remote tombstone absent on this PC on every sync',async()=>{
    const deleted=task({deleted_at:now,revision:2});
    const remote=sheet([taskRow(deleted,[]),['22222222-2222-4222-8222-222222222222','新規タスク']]);
    for (const states of [[],(await base(deleted)).states]) {
      const data:LocalSyncData={tasks:[],categories:[],conflicts:[],states};
      for (let pass=0;pass<2;pass++) {
        const p=await planTaskSync(data,remote);
        expect(p.warnings).toEqual([]);expect(p.conflicts).toEqual([]);expect(p.push).toEqual([]);expect(p.identify).toEqual([]);
        expect(p.pull.map(t=>t.title)).toEqual(['新規タスク']);
      }
    }
  });
  it('does not warn or recreate a deleted task after its sheet row is removed',async()=>{
    const p=await planTaskSync(await base(task({deleted_at:now,revision:2})),sheet([]));
    expect(p.warnings).toEqual([]);expect(p.conflicts).toEqual([]);expect(p.push).toEqual([]);expect(p.pull).toEqual([]);
  });
  it('does not accept manual deletion-marker edits',async()=>{const row=taskRow(task(),[]);row[12]=now;const p=await planTaskSync(await base(),sheet([row]));expect(p.pull).toHaveLength(0);expect(p.warnings[0]).toContain('削除情報');});
  it('keeps relative deadline labels anchored to their original date',()=>{const t=task({deadline_label:'明日'});const row=taskRow(t,[]);expect(incomingTask(row,t,new Date('2027-01-01')).deadline.exact).toBe(t.deadline_exact);expect(incomingTask(row,undefined,new Date('2027-01-01')).deadline.label).toBe('明日');});
  it('preserves fuzzy ranges across PCs and accepts an edited date range',()=>{const t=task({deadline_type:'FUZZY_RANGE',deadline_label:'今週中',deadline_exact:null,deadline_range_start:'2026-09-13T15:00:00.000Z',deadline_range_end:'2026-09-20T14:59:59.999Z'});const row=taskRow(t,[]);expect(incomingTask(row,undefined).deadline.rangeStart).toBe(t.deadline_range_start);row[2]='2026/10/01 ～ 2026/10/10';expect(incomingTask(row,t).deadline.type).toBe('FUZZY_RANGE');});
  it('rejects invalid status and snooze without damaging local task',async()=>{for (const column of [3,6]) {const row=taskRow(task(),[]);row[column]='INVALID';const p=await planTaskSync(await base(),sheet([row]));expect(p.pull).toHaveLength(0);expect(p.warnings).toHaveLength(1);}});
});
class MemoryTransport implements SyncTransport {
  data:LocalSyncData={tasks:[],categories:[],states:[],conflicts:[]}; remote=sheet([]); failAfterWrite=false; failRead=''; writes=0;
  async local(){return structuredClone(this.data);}
  async read(){if(this.failRead)throw new Error(this.failRead);return structuredClone(this.remote);}
  async write(r:RemoteSheet,patches:Parameters<SyncTransport['write']>[1]){expect(r.version).toBe(this.remote.version);this.writes++;for(const p of patches){const row=this.remote.rows[p.row_index] || paddedRow([]);p.values.forEach((v,i)=>row[i]=v);this.remote.rows[p.row_index]=row;}this.remote.version+=String(this.writes);if(this.failAfterWrite){this.failAfterWrite=false;throw new Error('OFFLINE|response lost');}}
  async apply(_r:RemoteSheet,changes:Parameters<SyncTransport['apply']>[1]){for(const c of changes){const prior=this.data.tasks.find(t=>t.id===c.id);if(prior?.revision !== (c.expected_revision ?? undefined))return ['LOCAL_CHANGED'];const t=task({id:c.id,title:c.title,description:c.description,status:c.status,deadline_type:c.deadline.type,deadline_label:c.deadline.label,deadline_exact:c.deadline.exact,deadline_range_start:c.deadline.rangeStart,deadline_range_end:c.deadline.rangeEnd,revision:(prior?.revision ?? 0)+1});this.data.tasks=this.data.tasks.filter(row=>row.id!==t.id);this.data.tasks.push(t);await this.acknowledge(_r,[{entity_id:t.id,local_revision:t.revision,remote_hash:c.remote_hash}]);}return [];}
  async acknowledge(_r:RemoteSheet,items:Parameters<SyncTransport['acknowledge']>[1]){for(const item of items){this.data.states=this.data.states.filter(s=>s.entity_id!==item.entity_id);this.data.states.push({entity_id:item.entity_id,last_synced_local_revision:item.local_revision,last_synced_remote_hash:item.remote_hash});}}
  async conflicts(_r:RemoteSheet,items:Parameters<SyncTransport['conflicts']>[1]){this.data.conflicts=items.map((c,i)=>({...c,id:String(i),resolution:null}));}
}
describe('sync recovery with mock transport',()=>{
  it('merges independent PC task lists without deduplicating by title',async()=>{
    const a=new MemoryTransport(),b=new MemoryTransport();a.data.tasks=[task()];b.data.tasks=[task({id:'22222222-2222-4222-8222-222222222222'})];
    await synchronizeTasks(a);b.remote=structuredClone(a.remote);await synchronizeTasks(b);a.remote=structuredClone(b.remote);await synchronizeTasks(a);
    expect(a.data.tasks).toHaveLength(2);expect(b.data.tasks).toHaveLength(2);expect(a.remote.rows).toHaveLength(3);
    a.data.tasks[0].description='PC A変更';a.data.tasks[0].revision++;
    const bTask=b.data.tasks.find(t=>t.id===id)!;bTask.description='PC B変更';bTask.revision++;
    await synchronizeTasks(a);b.remote=structuredClone(a.remote);const result=await synchronizeTasks(b);
    expect(result.conflicts).toBe(1);expect(b.data.tasks.find(t=>t.id===id)?.description).toBe('PC B変更');
  });
  it('imports many mobile title-only rows once across two PCs',async()=>{
    const a=new MemoryTransport(),b=new MemoryTransport();a.remote=sheet(Array.from({length:25},(_,i)=>['',`メモ${i}`]));
    await synchronizeTasks(a);b.remote=structuredClone(a.remote);await synchronizeTasks(b);
    expect(a.data.tasks).toHaveLength(25);expect(b.data.tasks).toHaveLength(25);
    expect(new Set(a.data.tasks.map(t=>t.id))).toEqual(new Set(b.data.tasks.map(t=>t.id)));
    expect(b.data.tasks.every(t=>t.deadline_label==='急ぎではない')).toBe(true);
  });
  it('does not duplicate new sheet rows when ID write succeeds but its response is lost',async()=>{const transport=new MemoryTransport();transport.remote=sheet([['','追加','2026/09/18','未着手']]);transport.failAfterWrite=true;await expect(synchronizeTasks(transport)).rejects.toThrow('response lost');expect(transport.data.tasks).toHaveLength(0);await synchronizeTasks(transport);expect(transport.data.tasks).toHaveLength(1);expect(transport.writes).toBe(1);});
  it('acknowledges a successful local push on retry after a lost response',async()=>{const transport=new MemoryTransport();transport.data.tasks=[task()];transport.failAfterWrite=true;await expect(synchronizeTasks(transport)).rejects.toThrow();expect(transport.data.states).toHaveLength(0);await synchronizeTasks(transport);expect(transport.remote.rows).toHaveLength(2);expect(transport.writes).toBe(1);expect(transport.data.states).toHaveLength(1);});
  it.each(['OFFLINE','AUTH_REQUIRED','MISSING_SHEET','PERMISSION'])('keeps local data and its unsynced state on %s',async(error)=>{const transport=new MemoryTransport();transport.data.tasks=[task()];transport.failRead=error;await expect(synchronizeTasks(transport)).rejects.toThrow(error);expect(transport.data.tasks[0].title).toBe('報告書');expect(transport.data.states).toHaveLength(0);});
});
