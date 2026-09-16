import { useEffect, useState } from 'react';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallCard() {
  const [prompt, setPrompt] = useState<InstallPrompt>();
  const [installed, setInstalled] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const media = matchMedia('(display-mode: standalone)');
    const update = () => setInstalled(media.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
    const available = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const done = () => { setInstalled(true); setPrompt(undefined); setMessage('ホーム画面から開けます。'); };
    update();
    media.addEventListener('change', update);
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', done);
    return () => { media.removeEventListener('change', update); window.removeEventListener('beforeinstallprompt', available); window.removeEventListener('appinstalled', done); };
  }, []);
  return <section className="card install-card">
    <div className="install-heading"><img src="./icon-192.png" width="48" height="48" alt="" /><div><h2>{installed ? 'アプリとして利用中' : 'ホーム画面から、すぐに'}</h2><p>Deadline Dockをスマホのホーム画面に。</p></div></div>
    {!installed && (prompt ? <button className="primary" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await prompt.prompt(); const result = await prompt.userChoice; setMessage(result.outcome === 'accepted' ? 'インストールを開始しました。' : 'また必要なときに追加できます。'); }
      catch { setMessage('ブラウザのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。'); }
      finally { setPrompt(undefined); setBusy(false); }
    }}>アプリをインストール</button> : <div className="install-guide">
      <p><strong>iPhone・iPad</strong><br />Safariの共有メニュー →「ホーム画面に追加」→「追加」。表示される場合は「Webアプリとして開く」をオンにします。</p>
      <p><strong>Android</strong><br />Chromeのメニュー →「ホーム画面に追加」または「アプリをインストール」。</p>
    </div>)}
    <p>一度開けば通信がない場所でも登録できます。Google同期はアプリを開いて通信できるときに行います。</p>
    {!installed && <small>ホーム画面版が別の保存領域になる端末では、同じGoogleシートに連携するとタスクを引き継げます。</small>}
    {message && <p role="status">{message}</p>}
  </section>;
}
