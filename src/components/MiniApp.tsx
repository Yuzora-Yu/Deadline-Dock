import { useEffect, useState, type CSSProperties } from 'react';
import type { Task } from '../types';
import type { Repository } from '../lib/repository';
import { compareUrgency, getUrgency } from '../lib/deadline';
import { formatShortDateTime } from '../lib/datetime';
import { listenForTaskCreated, openTaskComposer, openTaskInMainWindow, setCurrentAlwaysOnTop } from '../lib/platform';
import { QuickAdd } from './QuickAdd';
import { categoryColor } from '../lib/categoryColors';

export function MiniApp({ repo }: { repo: Repository }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showAddFallback, setShowAddFallback] = useState(false);
  const [pinned, setPinned] = useState(() => localStorage.getItem('deadline-dock-mini-pinned') !== 'false');
  async function load() { const rows = await repo.listTasks({ sort: 'URGENCY' }); setTasks(rows.sort(compareUrgency).slice(0, 7)); }
  useEffect(() => {
    void load();
    void setCurrentAlwaysOnTop(pinned);
    const refresh = () => { void load(); };
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener('focus', refresh);

    let disposed = false;
    let stop: (() => void) | null = null;
    void listenForTaskCreated(() => load()).then(unlisten => {
      if (disposed) unlisten();
      else stop = unlisten;
    });

    return () => {
      disposed = true;
      stop?.();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  async function togglePin() { const next = !pinned; setPinned(next); localStorage.setItem('deadline-dock-mini-pinned', String(next)); await setCurrentAlwaysOnTop(next); }
  async function addTask() {
    if (await openTaskComposer()) return;
    // Browser preview fallback only. The desktop app always opens the dedicated composer window.
    setShowAddFallback(true);
  }

  return <div className="mini-shell">
    <header className="mini-header"><strong>Deadline Dock</strong><div><button className="mini-action" onClick={() => { void addTask(); }} title="タスクを登録">＋</button><button className={`mini-action ${pinned ? 'active' : ''}`} onClick={togglePin} title="常に手前に表示">◆</button></div></header>
    <div className="mini-list">
      {tasks.map(t => {
        const u = getUrgency(t);
        const color = categoryColor(t.category_color);
        const style = t.category_name ? { '--category-tint': color.tint, '--category-accent': color.accent } as CSSProperties : undefined;
        const open = () => { void openTaskInMainWindow(t.id); };
        return <button
          type="button"
          className={`mini-task ${t.category_name ? 'has-category-color' : ''}`}
          style={style}
          key={t.id}
          onClick={open}
          title="クリックでメイン画面の詳細を開く"
        ><span className={`urgency-dot ${u.tone}`} /><span className="mini-task-main"><strong>{t.title}</strong><span><b className={u.tone}>{u.label}</b>{t.category_name && <>　<i className="mini-category-dot" style={{ background: color.accent }} />{t.category_name}</>}{t.postponement_count > 0 && `　↪${t.postponement_count}`}</span>{t.next_event_at && <small>📅 {formatShortDateTime(t.next_event_at)} {t.next_event_title}</small>}</span></button>;
      })}
      {!tasks.length && <div className="mini-empty">現在のタスクはありません</div>}
    </div>
    {showAddFallback && <QuickAdd compact repo={repo} onCancel={() => setShowAddFallback(false)} onCreated={async () => { setShowAddFallback(false); await load(); }} />}
  </div>;
}
