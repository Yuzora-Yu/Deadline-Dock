import type { Category, Task } from '../types';
import { taskRow, type SyncConflict } from '../lib/googleSyncCore';
export function SyncConflictDialog({conflicts,categories,busy,onResolve}:{conflicts:SyncConflict[];categories:Category[];busy:boolean;onResolve:(id:string,choice:'LOCAL'|'REMOTE')=>void}) {
  return <div aria-label="同期競合">
    {conflicts.map(conflict=>{
      if (conflict.entity_type && conflict.entity_type!=='TASK') {
        let local:string[],remote:string[];
        try {local=JSON.parse(conflict.local_json);remote=JSON.parse(conflict.remote_json);} catch {return <p key={conflict.id}>競合データを表示できません。</p>;}
        const category=conflict.entity_type==='CATEGORY';
        const fields:Array<[string,number]>=category?[['分類名',1],['色',2],['並び順',3],['削除日時',5]]:[['タスク',2],['完了',3],['チェック項目',4],['並び順',5],['削除日時',7]];
        return <details className="sync-conflict" key={conflict.id} open><summary><strong>{category?'分類':'チェック項目'}：{local[category?1:4]}</strong> — 同期競合</summary>
          <table><thead><tr><th>項目</th><th>Deadline Dock</th><th>Google Sheets</th></tr></thead><tbody>{fields.map(([label,index])=><tr key={label}><th>{label}</th><td>{local[index] || '—'}</td><td>{remote[index] || '—'}</td></tr>)}</tbody></table>
          <div className="sync-actions"><button className="button secondary" disabled={busy} onClick={()=>onResolve(conflict.id,'LOCAL')}>Deadline Dockを採用</button><button className="button secondary" disabled={busy} onClick={()=>onResolve(conflict.id,'REMOTE')}>Google Sheetsを採用</button></div>
        </details>;
      }
      let local:Task;let remote:string[];
      try {local=JSON.parse(conflict.local_json);remote=JSON.parse(conflict.remote_json);} catch {return <p key={conflict.id}>競合データを表示できません。</p>;}
      const localValues=taskRow(local,categories);
      return <details className="sync-conflict" key={conflict.id} open>
        <summary><strong>{local.title}</strong> — 同期競合{conflict.resolution && '（選択を反映待ち）'}</summary>
        <table><thead><tr><th>項目</th><th>Deadline Dock</th><th>Google Sheets</th></tr></thead><tbody>
          {['件名','締切','ステータス','分類','作業内容','表示開始'].map((label,index)=><tr key={label}><th>{label}</th><td>{localValues[index+1] || '—'}</td><td>{remote[index+1] || '—'}</td></tr>)}
        </tbody></table>
        {local.deleted_at && <p>アプリ側では削除済みです。Google Sheetsを採用すると復元します。</p>}
        <div className="sync-actions"><button className="button secondary" disabled={busy} onClick={()=>onResolve(conflict.id,'LOCAL')}>Deadline Dockを採用</button><button className="button secondary" disabled={busy} onClick={()=>onResolve(conflict.id,'REMOTE')}>Google Sheetsを採用{local.deleted_at ? 'して復元' : ''}</button></div>
      </details>;
    })}
  </div>;
}
