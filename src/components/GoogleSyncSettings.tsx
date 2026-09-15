import { useEffect, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { syncNow, subscribeSync, syncView, type Connection } from '../lib/googleSync';
import type { LocalSyncData } from '../lib/googleSyncCore';
import { SyncConflictDialog } from './SyncConflictDialog';
export function GoogleSyncSettings() {
  const desktop = '__TAURI_INTERNALS__' in window;
  const [connection, setConnection] = useState<Connection | null>(null);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [candidates, setCandidates] = useState<Array<{id:string;name:string}>>([]);
  const [operationBusy, setBusy] = useState(false);
  const progress = useSyncExternalStore(subscribeSync, syncView);
  const busy = operationBusy || progress.busy;
  const [data, setData] = useState<LocalSyncData | null>(null);
  const [message, setMessage] = useState('');
  async function refresh() { const status = await invoke<Connection>('google_status'); setConnection(status); setClientId(value => value || status.client_id); setData(await invoke<LocalSyncData>('google_local_sync_data')); }
  useEffect(() => { if (desktop) void refresh().catch(e => setMessage(String(e))); }, [desktop, progress]);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage('');
    try { await action(); setMessage(success); } catch (e) { setMessage(String(e)); }
    finally { try { await refresh(); } catch (e) { setMessage(String(e)); } setBusy(false); }
  }
  return <section className="settings-section">
    <div className="settings-section-head"><div><span className="eyebrow">GOOGLE SHEETS</span><h3>Google Sheets 連携</h3></div><p>Googleアカウントと接続し、専用スプレッドシートを作成します。</p></div>
    <div className="settings-card data-card">
      {!desktop ? <p>Google連携はデスクトップ版のみ利用できます。</p> : <>
        {!connection?.email && <>
          <label>OAuth Client ID<input style={{width:'100%'}} value={clientId} disabled={busy} onChange={e => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" /></label>
          <label>クライアントシークレット<input style={{width:'100%'}} type="password" autoComplete="off" value={secret} disabled={busy} onChange={e => setSecret(e.target.value)} /></label>
          <button className="button secondary" disabled={busy || !clientId || !secret} onClick={() => void run(async () => { await invoke('google_configure', {clientId, clientSecret:secret}); setSecret(''); }, 'OAuth設定をWindows資格情報へ保存しました。')}>OAuth設定を保存</button>
        </>}
        <div className="settings-action-row"><div><strong>{connection?.email || '未接続'}</strong><small>{connection?.email && !connection.credential_available ? '認証が必要です。再接続してください。' : '連携解除後もGoogle Driveのファイルは保持されます。'}</small></div><button className="button primary" disabled={busy || !connection?.client_id} onClick={() => void run(async () => { await invoke('google_connect'); await syncNow(); }, 'Google連携が完了しました。専用スプレッドシートを開けます。')}>{busy ? '処理中…' : connection?.email ? '再接続' : 'Google アカウントと連携'}</button></div>
        {connection?.email && <>
          {connection.spreadsheet_url && <p style={{overflowWrap:'anywhere'}}>{connection.spreadsheet_url}</p>}
          <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
            <button className="button secondary" disabled={busy || !connection.spreadsheet_url} onClick={() => void run(() => invoke('google_open_sheet'), '')}>スプレッドシートを開く</button>
            <button className="button secondary" disabled={busy || !connection.spreadsheet_url} onClick={() => void run(() => navigator.clipboard.writeText(connection.spreadsheet_url!), 'URLをコピーしました。')}>URLをコピー</button>
            <button className="button secondary" disabled={busy} onClick={() => void run(async () => { await invoke('google_prepare_sheet'); await syncNow(); }, '同期先を確認しました。')}>{connection.initialized ? '接続を確認' : 'シート作成を再試行'}</button>
            <button className="button secondary" disabled={busy} onClick={() => void run(() => invoke('google_disconnect'), 'このPCのGoogle連携を解除しました。')}>Google連携を解除</button>
          </div>
          <details><summary>同期先の復旧・変更</summary>
            <p>既存の同期シートを選ぶか、新しく作成できます。現在のファイルは削除しません。</p>
            <div className="sync-actions"><button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{const files=await invoke<Array<{id:string;name:string}>>('google_find_sheets');setCandidates(files);if(!files.length)throw new Error('既存の同期シートは見つかりませんでした。');},'')}>既存の同期シートを探す</button>
            <button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{await invoke('google_new_sheet');await syncNow();},'新しい同期先を作成しました。')}>新しい同期シートを作成</button></div>
            {candidates.map(file=><div className="settings-action-row" key={file.id}><span>{file.name}<small> {file.id}</small></span><button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{await invoke('google_select_sheet',{spreadsheetId:file.id});setCandidates([]);await syncNow();},'同期先を切り替えました。')}>このシートを使用</button></div>)}
          </details>
        </>}
        {connection?.email && <>
          <div className="settings-action-row"><div><strong>{progress.message}</strong><small>最終同期: {connection.last_success_at ? new Date(connection.last_success_at.replace(' ','T')+'Z').toLocaleString('ja-JP') : 'まだありません'}</small></div><button className="button primary" disabled={busy || !connection.initialized} onClick={() => void run(() => syncNow(), '')}>今すぐ同期</button></div>
          <div className="settings-action-row"><label><input type="checkbox" checked={connection.auto_sync} disabled={busy} onChange={e => void run(() => invoke('google_sync_preferences',{autoSync:e.target.checked,pollSeconds:connection.poll_seconds}), '')} /> 自動同期</label><select aria-label="同期間隔" value={connection.poll_seconds} disabled={busy} onChange={e=>void run(()=>invoke('google_sync_preferences',{autoSync:connection.auto_sync,pollSeconds:Number(e.target.value)}),'')}><option value={60}>60秒ごと</option><option value={120}>2分ごと</option><option value={300}>5分ごと</option></select></div>
          {(progress.warnings.length>0 || connection.last_error) && <div className="settings-message" role="status">{(progress.warnings.length ? progress.warnings : [connection.last_error!]).map((text,i)=><p key={i}>{text}</p>)}</div>}
          {data && <SyncConflictDialog conflicts={data.conflicts} categories={data.categories} busy={busy} onResolve={(id,resolution)=>void run(async()=>{await invoke('google_resolve_conflict',{id,resolution});await syncNow();},'')} />}
          <p>タスク一覧を双方向に同期します。シートの行を削除してもローカルのタスクは削除しません。関連データのタブは準備中です。</p>
        </>}
      </>}
      {message && <div className="settings-message" role="status">{message}</div>}
    </div>
  </section>;
}
