import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
interface Connection { client_id: string; email: string | null; spreadsheet_url: string | null; enabled: boolean; initialized: boolean; credential_available: boolean }
export function GoogleSyncSettings() {
  const desktop = '__TAURI_INTERNALS__' in window;
  const [connection, setConnection] = useState<Connection | null>(null);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function refresh() { const status = await invoke<Connection>('google_status'); setConnection(status); setClientId(status.client_id); }
  useEffect(() => { if (desktop) void refresh().catch(e => setMessage(String(e))); }, [desktop]);
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
        <div className="settings-action-row"><div><strong>{connection?.email || '未接続'}</strong><small>{connection?.email && !connection.credential_available ? '認証が必要です。再接続してください。' : '連携解除後もGoogle Driveのファイルは保持されます。'}</small></div><button className="button primary" disabled={busy || !connection?.client_id} onClick={() => void run(() => invoke('google_connect'), 'Google連携が完了しました。専用スプレッドシートを開けます。')}>{busy ? '処理中…' : connection?.email ? '再接続' : 'Google アカウントと連携'}</button></div>
        {connection?.email && <>
          {connection.spreadsheet_url && <p style={{overflowWrap:'anywhere'}}>{connection.spreadsheet_url}</p>}
          <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
            <button className="button secondary" disabled={busy || !connection.spreadsheet_url} onClick={() => void run(() => invoke('google_open_sheet'), '')}>スプレッドシートを開く</button>
            <button className="button secondary" disabled={busy || !connection.spreadsheet_url} onClick={() => void run(() => navigator.clipboard.writeText(connection.spreadsheet_url!), 'URLをコピーしました。')}>URLをコピー</button>
            <button className="button secondary" disabled={busy} onClick={() => void run(() => invoke('google_prepare_sheet'), '同期先を確認しました。')}>{connection.initialized ? '接続を確認' : 'シート作成を再試行'}</button>
            <button className="button secondary" disabled={busy} onClick={() => void run(() => invoke('google_disconnect'), 'このPCのGoogle連携を解除しました。')}>Google連携を解除</button>
          </div>
        </>}
        <p>接続・シート作成を先行実装しています。タスクの自動同期はまだ開始しません。</p>
      </>}
      {message && <div className="settings-message" role="status">{message}</div>}
    </div>
  </section>;
}
