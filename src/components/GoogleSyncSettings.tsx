import { useEffect, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { syncNow, subscribeSync, syncView, type Connection } from '../lib/googleSync';
import type { LocalSyncData } from '../lib/googleSyncCore';
import { SyncConflictDialog } from './SyncConflictDialog';
interface MergePreview {fingerprint:string;local_tasks:number;remote_tasks:number;shared_ids:number;same_title_separate_ids:number}
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
  const [mergePreview,setMergePreview]=useState<MergePreview|null>(null);
  async function previewMerge(){setMergePreview(await invoke<MergePreview>('google_preview_merge'));}
  async function refresh() { const status = await invoke<Connection>('google_status'); setConnection(status); setClientId(value => value || status.client_id); setData(await invoke<LocalSyncData>('google_local_sync_data')); }
  useEffect(() => { if (desktop) void refresh().catch(e => setMessage(String(e))); }, [desktop, progress]);
  useEffect(()=>{if(connection?.initialized && !connection.initial_sync_confirmed) void previewMerge().catch(e=>setMessage(String(e)));},[connection?.initialized,connection?.initial_sync_confirmed]);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setMessage('');
    try { await action(); setMessage(success); } catch (e) { setMessage(String(e)); }
    finally { try { await refresh(); } catch (e) { setMessage(String(e)); } setBusy(false); }
  }
  return <section className="settings-section">
    <div className="settings-section-head"><div><span className="eyebrow">GOOGLE SHEETS</span><h3>Google Sheets 連携</h3></div><p>アプリとシート、どちらからでも更新。</p></div>
    <div className="settings-card google-sync-card">
      {!desktop ? <p>Google連携はデスクトップ版のみ利用できます。</p> : <>
        {!connection?.email && <>
          <div className="google-sync-intro"><span className="google-sheet-icon" aria-hidden="true">▦</span><div><h4>いつものGoogleアカウントで、すぐに連携</h4><p>専用シートを自動作成。タスク・分類・チェック項目をまとめて同期します。</p></div></div>
          <ol className="google-sync-steps"><li><span>1</span>アカウントを選ぶ</li><li><span>2</span>アクセスを許可</li><li><span>3</span>同期スタート</li></ol>
          {connection && !connection.oauth_ready && <div className="settings-message" role="status">この開発版はGoogle連携の準備中です。開発者がアプリ共通の設定を組み込むと、この画面から接続できます。</div>}
        </>}
        <div className="settings-action-row google-account-row"><div><strong><span className={`google-connection-dot ${connection?.credential_available?'connected':''}`} />{connection?.email || 'まだ連携していません'}</strong><small>{connection?.email ? connection.credential_available ? '接続済み · このアカウントのGoogle Driveへ同期' : '認証が必要です。再接続してください。' : 'ブラウザで接続します。既存の連携シートは再利用します。'}</small></div><button className={`button ${connection?.email?'secondary':'primary'}`} disabled={busy || !connection?.oauth_ready} onClick={() => void run(async () => { await invoke('google_connect'); await syncNow(); }, 'Google連携が完了しました。')}>{operationBusy ? '処理中…' : connection?.email ? '再接続' : 'Googleと連携'}</button></div>
        {!connection?.email && <p className="google-privacy-note">同期対象のデータを選んだアカウントへ送信します。連携を解除してもシートは残ります。</p>}
        {!connection?.email && <details className="google-advanced"><summary>開発者向け設定</summary><div className="google-advanced-body">
          <p>独自のGoogle OAuthクライアントで検証する場合のみ設定します。通常の利用では入力不要です。</p>
          <label>OAuth Client ID<input style={{width:'100%'}} value={clientId} disabled={busy} onChange={e => setClientId(e.target.value)} placeholder="…apps.googleusercontent.com" /></label>
          <label>クライアントシークレット<input style={{width:'100%'}} type="password" autoComplete="off" value={secret} disabled={busy} onChange={e => setSecret(e.target.value)} /></label>
          <button className="button secondary" disabled={busy || !clientId || !secret} onClick={() => void run(async () => { await invoke('google_configure', {clientId, clientSecret:secret}); setSecret(''); }, 'OAuth設定をWindows資格情報へ保存しました。')}>OAuth設定を保存</button>
        </div></details>}
        {connection?.email && <>
          {!connection.initial_sync_confirmed && <div className="settings-action-row"><div><strong>初回同期の確認待ち</strong><small>このPCとシートのタスクを確認してから同期します。</small></div><button className="button primary" disabled={busy} onClick={()=>void run(previewMerge,'')}>初回同期を確認</button></div>}
          <div className="google-sheet-actions">
            <button className="button secondary" disabled={busy || !connection.spreadsheet_url} onClick={() => void run(() => invoke('google_open_sheet'), '')}>スプレッドシートを開く</button>
            <button className="button secondary" disabled={busy || !connection.spreadsheet_url} onClick={() => void run(() => navigator.clipboard.writeText(connection.spreadsheet_url!), 'URLをコピーしました。')}>URLをコピー</button>
          </div>
          <div className="settings-action-row"><div><strong>シートのレイアウト</strong><small>入力内容を保ったまま、列幅・見出し・入力候補を整えます。不足するタブは同期時にも自動追加します。</small></div><button className="button secondary" disabled={busy || !connection.initialized} onClick={()=>void run(async()=>{await invoke('google_repair_sheet');await syncNow();},'シートのレイアウトを整えました。')}>レイアウトを整える</button></div>
          <details className="google-advanced"><summary>接続の管理・同期先の変更</summary><div className="google-advanced-body">
            <div className="sync-actions"><button className="button secondary" disabled={busy} onClick={() => void run(async () => { await invoke('google_prepare_sheet'); await syncNow(); }, '同期先を確認しました。')}>{connection.initialized ? '接続を確認' : 'シート作成を再試行'}</button>
            <button className="button secondary" disabled={busy} onClick={() => void run(() => invoke('google_disconnect'), 'このPCのGoogle連携を解除しました。')}>Google連携を解除</button></div>
            <p>既存の同期シートを選ぶか、新しく作成できます。現在のファイルは削除しません。</p>
            <div className="sync-actions"><button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{const files=await invoke<Array<{id:string;name:string}>>('google_find_sheets');setCandidates(files);if(!files.length)throw new Error('既存の同期シートは見つかりませんでした。');},'')}>既存の同期シートを探す</button>
            <button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{await invoke('google_new_sheet');await syncNow();},'新しい同期先を作成しました。')}>新しい同期シートを作成</button></div>
            {candidates.map(file=><div className="settings-action-row" key={file.id}><span>{file.name}<small> {file.id}</small></span><button className="button secondary" disabled={busy} onClick={()=>void run(async()=>{await invoke('google_select_sheet',{spreadsheetId:file.id});setCandidates([]);await syncNow();},'同期先を切り替えました。')}>このシートを使用</button></div>)}
          </div></details>
        </>}
        {connection?.email && <>
          <div className="settings-action-row"><div><strong>{progress.message}</strong><small>最終同期: {connection.last_success_at ? new Date(connection.last_success_at.replace(' ','T')+'Z').toLocaleString('ja-JP') : 'まだありません'}</small></div><button className="button primary" disabled={busy || !connection.initialized} onClick={() => void run(() => syncNow(), '')}>今すぐ同期</button></div>
          <div className="settings-action-row"><div><label className="google-auto-label"><input type="checkbox" checked={connection.auto_sync} disabled={busy} onChange={e => void run(() => invoke('google_sync_preferences',{autoSync:e.target.checked,pollSeconds:connection.poll_seconds}), '')} /> 自動同期</label><small>保存後は約3秒、削除・取消はすぐに同期を開始します。オフライン中は接続回復後に反映します。</small></div><select aria-label="シートの確認間隔" value={connection.poll_seconds} disabled={busy} onChange={e=>void run(()=>invoke('google_sync_preferences',{autoSync:connection.auto_sync,pollSeconds:Number(e.target.value)}),'')}><option value={60}>1分ごとに確認</option><option value={120}>2分ごとに確認</option><option value={300}>5分ごとに確認</option></select></div>
          {(progress.warnings.length>0 || connection.last_error) && <div className="settings-message" role="status">{(progress.warnings.length ? progress.warnings : [connection.last_error!]).map((text,i)=><p key={i}>{text}</p>)}</div>}
          {data && <SyncConflictDialog conflicts={data.conflicts} categories={data.categories} busy={busy} onResolve={(id,resolution)=>void run(async()=>{await invoke('google_resolve_conflict',{id,resolution});await syncNow();},'')} />}
          <p className="google-privacy-note">同期対象：タスク・分類・チェック項目。アプリでタスクを削除すると、シートの該当行と関連するチェック項目・予定・リンクの行も削除します。シートで直接行を削除してもアプリのデータは残ります。予定・関連リンクの内容の同期は準備中です。</p>
        </>}
      </>}
      {message && <div className="settings-message" role="status">{message}</div>}
    </div>
    {mergePreview && <div className="modal-backdrop"><section className="merge-dialog" role="dialog" aria-modal="true" aria-labelledby="merge-title">
      <span className="eyebrow">FIRST SYNC</span><h3 id="merge-title">両方のタスクを残して同期しますか？</h3>
      <div className="merge-counts"><div><strong>{mergePreview.local_tasks}</strong><span>このPCのタスク</span></div><div><strong>{mergePreview.remote_tasks}</strong><span>シートのタスク</span></div></div>
      <ul><li>別々に登録されたタスクは、両方とも残します。</li><li>同じIDは同じタスクとして扱います（{mergePreview.shared_ids}件）。内容が違う場合は競合画面で選べます。</li><li>件名が同じでもIDが違うものは自動でまとめません（候補{mergePreview.same_title_separate_ids}件）。</li><li>同名の分類は対応づけます。色などの違いは競合画面で確認します。</li></ul>
      <p>同期開始後は、どちらのPCからの変更もこのシートを通して反映されます。</p>
      {message && <p role="alert">{message}</p>}
      <div className="sync-actions"><button className="button secondary" disabled={busy} onClick={()=>setMergePreview(null)}>あとで確認</button><button className="button secondary" disabled={busy} onClick={()=>void run(previewMerge,'')}>最新の件数を確認</button><button className="button primary" disabled={busy} onClick={()=>void run(async()=>{await invoke('google_confirm_merge',{fingerprint:mergePreview.fingerprint});setMergePreview(null);await syncNow();},'初回同期を開始しました。')}>両方を残して同期</button></div>
    </section></div>}
  </section>;
}
