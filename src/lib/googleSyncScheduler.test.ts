import { afterEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:mocks.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:mocks.listen}));
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();vi.resetModules();});
it('runs a second sync when a saved mutation arrives during an in-flight sync',async()=>{
  const windowMock=Object.assign(new EventTarget(),{__TAURI_INTERNALS__:{}});
  vi.stubGlobal('window',windowMock);
  let release!:()=>void;
  const firstRead=new Promise<void>(resolve=>{release=resolve;});
  let reads=0;
  mocks.invoke.mockImplementation(async(command:string)=>{
    if(command==='google_status')return {enabled:true,initialized:true,initial_sync_confirmed:true,credential_available:true,auto_sync:true,spreadsheet_url:'synthetic',poll_seconds:60};
    if(command==='google_sync_related')return {warnings:[],changed:false};
    if(command==='google_read_tasks'){
      if(++reads===1)await firstRead;
      return {spreadsheet_id:'synthetic',version:'1',rows:[['task_id','件名','締切','ステータス','分類','作業内容','表示開始','延期回数','登録日','更新日','完了日','revision','deleted_at']],grid_rows:1000};
    }
    if(command==='google_local_sync_data')return {tasks:[],categories:[],conflicts:[],states:[]};
  });
  const {syncNow,syncView}=await import('./googleSync');
  const running=syncNow(false);
  await vi.waitFor(()=>expect(reads).toBe(1));
  await syncNow(false);
  release();await running;
  await vi.waitFor(()=>expect(reads).toBe(2));
  await vi.waitFor(()=>expect(syncView().busy).toBe(false));
  expect(mocks.invoke.mock.calls.filter(c=>c[0]==='google_sync_related')).toHaveLength(4);
});
it('does not read or write sync data until the first merge is confirmed',async()=>{
  vi.stubGlobal('window',Object.assign(new EventTarget(),{__TAURI_INTERNALS__:{}}));
  mocks.invoke.mockResolvedValue({enabled:true,initialized:true,initial_sync_confirmed:false,credential_available:true,auto_sync:true});
  const {syncNow,syncView}=await import('./googleSync');await syncNow();
  expect(mocks.invoke.mock.calls.map(c=>c[0])).toEqual(['google_status']);
  expect(syncView().message).toBe('初回同期の確認待ち');
});
