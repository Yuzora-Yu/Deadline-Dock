import brandIcon from "../assets/branding/deadline-dock-oauth-120.png";
import { SyncStatusBadge } from './components/SyncStatusBadge';
import { startGoogleSync } from './lib/googleSync';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Category, DeadlineType, Task, TaskComposerInitial, TaskDetails, TaskFilters, TaskStatus } from './types';
import type { Repository } from './lib/repository';
import { compareUrgency, deadlineInputFromTask } from './lib/deadline';
import { QuickAdd } from './components/QuickAdd';
import { TaskList } from './components/TaskList';
import { TaskDetail } from './components/TaskDetail';
import { CategorySettings } from './components/CategorySettings';
import { ScheduleView } from './components/ScheduleView';
import { listenForOpenTask, listenForTaskCreated, openTaskComposer, showMiniWindow } from './lib/platform';

type View = 'ACTIVE' | 'SCHEDULE' | 'ARCHIVE' | 'SETTINGS';

function sortTasks(tasks: Task[], sort: TaskFilters['sort'] = 'URGENCY') {
  const rows = [...tasks];
  if (sort === 'URGENCY') return rows.sort(compareUrgency);
  if (sort === 'TITLE') return rows.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
  if (sort === 'CREATED') return rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (sort === 'UPDATED') return rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  if (sort === 'COMPLETED') return rows.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
  return rows.sort((a, b) => (a.deadline_exact || a.deadline_range_end || '9999').localeCompare(b.deadline_exact || b.deadline_range_end || '9999'));
}

export function App({ repo }: { repo: Repository }) {
  useEffect(() => startGoogleSync(), []);
  useEffect(() => {
    const refresh = () => setRefreshNonce(value => value + 1);
    window.addEventListener('deadline-dock-sync-applied', refresh);
    return () => window.removeEventListener('deadline-dock-sync-applied', refresh);
  }, []);
  const [view, setView] = useState<View>('ACTIVE');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selection = useRef(selectedId);
  selection.current = selectedId;
  const detailRequest = useRef(0);
  const [details, setDetails] = useState<TaskDetails | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [composerInitial, setComposerInitial] = useState<TaskComposerInitial | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('ALL');
  const [postponed, setPostponed] = useState<'ALL' | 'YES' | 'NO'>('ALL');
  const [status, setStatus] = useState<TaskStatus | 'ALL'>('ALL');
  const [deadlineType, setDeadlineType] = useState<DeadlineType | 'ALL'>('ALL');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [completedFrom, setCompletedFrom] = useState('');
  const [completedTo, setCompletedTo] = useState('');
  const [advancedFilters, setAdvancedFilters] = useState(false);
  const [sort, setSort] = useState<TaskFilters['sort']>('URGENCY');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [undoAction, setUndoAction] = useState<{ message: string; taskId: string; view: View; undo: () => Promise<void> } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

  const filters = useMemo<TaskFilters>(() => ({
    query, categoryId: category as TaskFilters['categoryId'], postponed, deadlineType, createdFrom, createdTo,
    completedFrom: view === 'ARCHIVE' ? completedFrom : '', completedTo: view === 'ARCHIVE' ? completedTo : '', sort,
    includeCompleted: view === 'ARCHIVE', status: view === 'ARCHIVE' ? 'COMPLETED' : status
  }), [query, category, postponed, deadlineType, createdFrom, createdTo, completedFrom, completedTo, sort, status, view]);

  async function loadCategories() { setCategories(await repo.listCategories()); }
  async function loadTasks(selectFirst = false): Promise<Task[]> {
    try {
      setError(''); setLoading(true);
      const rows = sortTasks(await repo.listTasks(filters), sort);
      setTasks(rows);
      if (selectedId && !rows.some(t => t.id === selectedId)) { setSelectedId(null); setDetails(null); }
      if (selectFirst && !selectedId && rows[0]) setSelectedId(rows[0].id);
      return rows;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return [];
    } finally { setLoading(false); }
  }
  async function loadDetails(id = selectedId) {
    if (!id) { setDetails(null); return; }
    const request = ++detailRequest.current;
    try {
      const next = await repo.getTaskDetails(id);
      if (request === detailRequest.current && selection.current === id) setDetails(next);
    } catch (e) { if (request === detailRequest.current && selection.current === id) setError(e instanceof Error ? e.message : String(e)); }
  }
  async function reloadAll() {
    const currentId = selectedId;
    const [rows] = await Promise.all([loadTasks(), loadCategories()]);
    if (currentId && rows.some(t => t.id === currentId)) await loadDetails(currentId);
    else setDetails(null);
  }

  useEffect(() => { loadCategories(); }, [repo, refreshNonce]);
  useEffect(() => { if (view === 'ACTIVE' || view === 'ARCHIVE') loadTasks(true); }, [view, query, category, postponed, deadlineType, createdFrom, createdTo, completedFrom, completedTo, status, sort, refreshNonce]);
  useEffect(() => { if (selectedId) loadDetails(selectedId); }, [selectedId, refreshNonce]);
  useEffect(() => {
    if (!undoAction) return;
    const timer = window.setTimeout(() => setUndoAction(null), 7000);
    return () => window.clearTimeout(timer);
  }, [undoAction]);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | null = null;
    listenForOpenTask(async taskId => {
      try {
        setView('ACTIVE');
        resetFilters();
        setSort('URGENCY');
        setSelectedId(taskId);
        setDetails(await repo.getTaskDetails(taskId));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; });
    return () => { disposed = true; stop?.(); };
  }, [repo]);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | null = null;
    listenForTaskCreated(async taskId => {
      try {
        setView('ACTIVE');
        resetFilters();
        setSort('URGENCY');
        setSelectedId(taskId);
        setRefreshNonce(value => value + 1);
        setDetails(await repo.getTaskDetails(taskId));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }).then(unlisten => { if (disposed) unlisten(); else stop = unlisten; });
    return () => { disposed = true; stop?.(); };
  }, [repo]);

  async function launchComposer(initial?: TaskComposerInitial) {
    try {
      if (await openTaskComposer(initial)) return;
      // Browser preview fallback. The desktop app always uses the dedicated composer window.
      setComposerInitial(initial);
      setShowAdd(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function chooseView(next: View) {
    setView(next); setSelectedId(null); setDetails(null);
    if (next === 'ARCHIVE') setSort('COMPLETED'); else if (view === 'ARCHIVE') setSort('URGENCY');
  }

  async function openTask(id: string) { setView('ACTIVE'); setSelectedId(id); setDetails(await repo.getTaskDetails(id)); }

  function resetFilters() {
    setQuery(''); setCategory('ALL'); setPostponed('ALL'); setStatus('ALL'); setDeadlineType('ALL');
    setCreatedFrom(''); setCreatedTo(''); setCompletedFrom(''); setCompletedTo('');
  }

  function offerUndo(message: string, taskId: string, undo: () => Promise<void>) {
    setUndoAction({ message, taskId, view, undo });
  }

  async function runUndo() {
    if (!undoAction || undoBusy) return;
    const action = undoAction;
    setUndoBusy(true);
    try {
      await action.undo();
      setView(action.view);
      setSelectedId(action.taskId);
      setRefreshNonce(n => n + 1);
      await loadCategories();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUndoBusy(false); setUndoAction(null);
    }
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><img className="brand-mark" src={brandIcon} alt="" /><div><strong>Deadline Dock</strong><small>締切から仕事を見る</small></div></div>
      <nav className="nav-tabs">
        <button className={view === 'ACTIVE' ? 'active' : ''} onClick={() => chooseView('ACTIVE')}>期限</button>
        <button className={view === 'SCHEDULE' ? 'active' : ''} onClick={() => chooseView('SCHEDULE')}>予定</button>
        <button className={view === 'ARCHIVE' ? 'active' : ''} onClick={() => chooseView('ARCHIVE')}>完了済み</button>
      </nav>
      <div className="top-actions"><SyncStatusBadge onClick={() => chooseView('SETTINGS')} /><button className="button secondary mini-open-button" title="ミニ画面を開く" onClick={() => { void showMiniWindow().catch(e => setError(e instanceof Error ? e.message : String(e))); }}>▣ ミニ</button><button className="icon-button" title="設定" onClick={() => chooseView('SETTINGS')}>⚙</button><button className="button primary add-button" onClick={() => { void launchComposer(); }}>＋ タスク</button></div>
    </header>

    {error && <div className="error-banner">{error}<button onClick={() => setError('')}>×</button></div>}

    {(view === 'ACTIVE' || view === 'ARCHIVE') && <main className="workspace">
      <aside className="list-pane">
        <div className="filterbar">
          <div className="search-box"><span>⌕</span><input placeholder={view === 'ARCHIVE' ? '完了済みを検索…' : 'タスクを検索…'} value={query} onChange={e => setQuery(e.target.value)} /></div>
          <div className="filters-row">
            <select value={category} onChange={e => setCategory(e.target.value)}><option value="ALL">すべての分類</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select value={postponed} onChange={e => setPostponed(e.target.value as typeof postponed)}><option value="ALL">延期：すべて</option><option value="YES">延期あり</option><option value="NO">延期なし</option></select>
            <select value={sort} onChange={e => setSort(e.target.value as TaskFilters['sort'])}>
              {view !== 'ARCHIVE' && <option value="URGENCY">今ヤバい順</option>}
              <option value="DEADLINE">締切順</option><option value="UPDATED">更新順</option><option value="CREATED">登録順</option>{view === 'ARCHIVE' && <option value="COMPLETED">完了日の新しい順</option>}<option value="TITLE">件名順</option>
            </select>
            <button className={`filter-toggle ${advancedFilters ? 'active' : ''}`} onClick={() => setAdvancedFilters(v => !v)}>詳細 {advancedFilters ? '▲' : '▼'}</button>
          </div>
          {advancedFilters && <div className="advanced-filters">
            {view !== 'ARCHIVE' && <label><span>状態</span><select value={status} onChange={e => setStatus(e.target.value as TaskStatus | 'ALL')}><option value="ALL">すべて</option><option value="TODO">未着手</option><option value="IN_PROGRESS">作業中</option></select></label>}
            <label><span>締切種別</span><select value={deadlineType} onChange={e => setDeadlineType(e.target.value as DeadlineType | 'ALL')}><option value="ALL">すべて</option><option value="EXACT">日付・日時</option><option value="FUZZY_RANGE">上旬・中旬・下旬</option><option value="ASAP">ASAP</option></select></label>
            <label><span>登録日 From</span><input type="date" value={createdFrom} onChange={e => setCreatedFrom(e.target.value)} /></label>
            <label><span>登録日 To</span><input type="date" value={createdTo} onChange={e => setCreatedTo(e.target.value)} /></label>
            {view === 'ARCHIVE' && <><label><span>完了日 From</span><input type="date" value={completedFrom} onChange={e => setCompletedFrom(e.target.value)} /></label><label><span>完了日 To</span><input type="date" value={completedTo} onChange={e => setCompletedTo(e.target.value)} /></label></>}
            <button className="text-button filter-reset" onClick={resetFilters}>条件をクリア</button>
          </div>}
        </div>
        <div className="list-summary"><strong>{view === 'ARCHIVE' ? '完了済み' : 'タスク'}</strong><span>{tasks.length}件</span></div>
        {loading ? <div className="empty-state"><p>読み込み中…</p></div> : <TaskList tasks={tasks} selectedId={selectedId} onSelect={t => setSelectedId(t.id)} emptyText={view === 'ARCHIVE' ? '条件に合う完了タスクはありません' : '現在のタスクはありません'} mode={view === 'ARCHIVE' ? 'ARCHIVE' : 'ACTIVE'} />}
      </aside>
      <section className="detail-pane">
        {details ? <TaskDetail details={details} categories={categories} repo={repo} onChanged={reloadAll} onDeleted={async () => { setSelectedId(null); setDetails(null); await loadTasks(); }} onDuplicateRequested={source => {
          void launchComposer({
            title: source.task.title,
            deadline: deadlineInputFromTask(source.task),
            description: source.task.description,
            categoryId: source.task.category_id,
            snoozeUntil: source.task.snooze_until,
            duplicatedFromTaskId: source.task.id,
            sourceTitle: source.task.title,
            events: source.events.map(event => ({ title: event.title, startsAt: event.starts_at, endsAt: event.ends_at })),
            resources: source.resources.map(resource => ({ type: resource.type, label: resource.label, value: resource.value })),
            checkItems: source.checkItems.map(item => ({ text: item.text, checked: false }))
          });
        }} onUndoable={offerUndo} /> : <div className="detail-empty"><div className="empty-mark large">↙</div><h3>タスクを選択</h3><p>一覧からタスクを選ぶと、締切・予定・作業場所・変更履歴を確認できます。</p></div>}
      </section>
    </main>}

    {view === 'SCHEDULE' && <main className="single-page"><ScheduleView repo={repo} onOpenTask={openTask} /></main>}
    {view === 'SETTINGS' && <main className="single-page"><CategorySettings repo={repo} categories={categories} onChanged={async () => { await loadCategories(); setRefreshNonce(n => n + 1); }} /></main>}

    {showAdd && <QuickAdd repo={repo} initial={composerInitial} onCancel={() => { setShowAdd(false); setComposerInitial(undefined); }} onCreated={task => { setShowAdd(false); setComposerInitial(undefined); setView('ACTIVE'); resetFilters(); setSort('URGENCY'); setSelectedId(task.id); setRefreshNonce(n => n + 1); }} />}

    {undoAction && <div className="undo-toast"><span>{undoAction.message}</span><button disabled={undoBusy} onClick={runUndo}>{undoBusy ? '復元中…' : '元に戻す'}</button><button className="undo-close" onClick={() => setUndoAction(null)}>×</button></div>}
  </div>;
}
