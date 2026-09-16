import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import type { TaskComposerInitial } from './types';
import type { Repository } from './lib/repository';
import { getRepository } from './lib/repository';
import { App } from './App';
import { MiniApp } from './components/MiniApp';
import { QuickAdd } from './components/QuickAdd';
import { hideCurrentWindow, listenForComposeTask, notifyTaskCreated, syncQuickAddShortcut } from './lib/platform';
import { getQuickAddShortcut } from './lib/preferences';
import './styles.css';

function QuickWindow({ repo }: { repo: Repository }) {
  const [initial, setInitial] = useState<TaskComposerInitial | undefined>(undefined);
  const [session, setSession] = useState(0);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | null = null;
    listenForComposeTask(nextInitial => {
      setInitial(nextInitial);
      setSession(value => value + 1);
    }).then(unlisten => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => { disposed = true; stop?.(); };
  }, []);

  return <QuickAdd
    key={session}
    standalone
    repo={repo}
    initial={initial}
    onCancel={hideCurrentWindow}
    onCreated={async task => {
      await notifyTaskCreated(task.id);
      await hideCurrentWindow();
    }}
  />;
}

async function bootstrap() {
  const repo = await getRepository();
  const mode = new URLSearchParams(location.search).get('mode') || 'main';
  const root = ReactDOM.createRoot(document.getElementById('root')!);
  if (mode === 'main') {
    try { await syncQuickAddShortcut(getQuickAddShortcut()); } catch (error) { console.error('Global shortcut registration failed', error); }
  }
  if (mode === 'mini') {
    root.render(<React.StrictMode><MiniApp repo={repo} /></React.StrictMode>);
  } else if (mode === 'quick') {
    root.render(<React.StrictMode><QuickWindow repo={repo} /></React.StrictMode>);
  } else {
    root.render(<React.StrictMode><App repo={repo} /></React.StrictMode>);
  }
}

bootstrap().catch(err => {
  console.error(err);
  document.getElementById('root')!.innerHTML = `<div style="font-family:sans-serif;padding:24px"><h2>起動に失敗しました</h2><pre>${String(err)}</pre></div>`;
});

import './refined.css';
