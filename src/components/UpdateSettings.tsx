import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime, openResource } from '../lib/platform';
import { version } from '../../package.json';

interface UpdateInfo { current:string; version:string; available:boolean; notes:string; url:string; size:number }
export function UpdateSettings() {
  const [info,setInfo]=useState<UpdateInfo>();
  const [busy,setBusy]=useState(false);
  const [ready,setReady]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(e){setError(String(e));}finally{setBusy(false);}};
  return <section className="settings-section">
    <div className="settings-section-head"><div><span className="eyebrow">APP UPDATE</span><h3>アプリの更新</h3></div><p>現在のバージョン：v{version}</p></div>
    <div className="settings-card data-card">
      <div className="settings-action-row"><div><strong>新しいバージョンを確認</strong><p>GitHubの正式リリースから更新します。タスクと連携設定はそのまま引き継ぎます。</p></div>
        <button className="button" disabled={busy||!isTauriRuntime()} onClick={()=>void run(async()=>{setReady(false);const result=await invoke<UpdateInfo>('check_app_update');setInfo(result);setMessage(result.available?`v${result.version} が利用できます。`:'最新版を使用しています。');})}>{busy?'確認・処理中…':'更新を確認'}</button>
      </div>
      {info?.available&&<div style={{padding:20}}><h4>v{info.version} · {(info.size/1000000).toFixed(2)} MB</h4><p style={{whiteSpace:'pre-wrap',maxHeight:220,overflow:'auto'}}>{info.notes}</p>
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button className="button" onClick={()=>void openResource('URL',info.url)}>更新内容をGitHubで見る</button>
        {!ready?<button className="button primary" disabled={busy} onClick={()=>void run(async()=>{setMessage('更新をダウンロードして検証しています…');await invoke('download_app_update',{expectedVersion:info.version});setReady(true);setMessage('検証が完了しました。作業中の編集を保存してから更新を開始してください。');})}>更新をダウンロード</button>:<button className="button primary" disabled={busy} onClick={()=>void run(async()=>{if(!confirm('Deadline Dockを終了して更新インストーラーを開きます。\n別ウィンドウで編集中の内容も保存済みですか？'))return;await invoke('install_app_update');})}>アプリを終了して更新</button>}</div>
        <small>更新はインストーラーの案内に沿って進みます。</small>
      </div>}
    </div>
    {message&&<p className="settings-message" role="status">{message}</p>}
    {error&&<p className="settings-message" role="alert">{error}</p>}
  </section>;
}
