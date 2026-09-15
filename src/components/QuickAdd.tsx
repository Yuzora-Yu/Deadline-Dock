import { useEffect, useMemo, useRef, useState } from 'react';
import type { Category, DeadlineInput, ResourceType, Task, TaskComposerInitial } from '../types';
import type { Repository } from '../lib/repository';
import { exactDeadlineFromDate, parseDeadlineText, todayDeadline } from '../lib/deadline';
import { fromLocalDateTimeInput, toLocalDateInput, toLocalDateTimeInput } from '../lib/datetime';
import { categoryColor } from '../lib/categoryColors';
import { chooseLocalPath, resizeQuickAddWindow } from '../lib/platform';
import { DeadlinePicker } from './DeadlinePicker';


type EventDraft = { id: string; title: string; start: string; end: string };
type ResourceDraft = { id: string; type: ResourceType; label: string; value: string };
type CheckDraft = { id: string; text: string; checked: boolean };
const draftId = () => crypto.randomUUID();

function eventDrafts(initial?: TaskComposerInitial): EventDraft[] {
  return (initial?.events || []).map(event => ({ id: draftId(), title: event.title, start: toLocalDateTimeInput(event.startsAt), end: toLocalDateTimeInput(event.endsAt) }));
}
function resourceDrafts(initial?: TaskComposerInitial): ResourceDraft[] {
  return (initial?.resources || []).map(resource => ({ id: draftId(), ...resource }));
}
function checkDrafts(initial?: TaskComposerInitial): CheckDraft[] {
  return (initial?.checkItems || []).map(item => ({ id: draftId(), text: item.text, checked: Boolean(item.checked) }));
}

export function QuickAdd({ repo, onCreated, onCancel, standalone = false, compact = false, initial }: {
  repo: Repository;
  onCreated: (task: Task) => void;
  onCancel: () => void;
  standalone?: boolean;
  compact?: boolean;
  initial?: TaskComposerInitial;
}) {
  const initialDeadline = initial?.deadline || todayDeadline();
  const [categories, setCategories] = useState<Category[]>([]);
  const [title, setTitle] = useState(initial?.title || '');
  const [deadline, setDeadline] = useState<DeadlineInput>(initialDeadline);
  const [showCandidates, setShowCandidates] = useState(false);
  const [candidateText, setCandidateText] = useState('');
  const [candidateError, setCandidateError] = useState('');
  const [showDetails, setShowDetails] = useState(Boolean(initial?.duplicatedFromTaskId || initial?.description || initial?.categoryId || initial?.events?.length || initial?.resources?.length || initial?.checkItems?.length || initial?.snoozeUntil));
  const [description, setDescription] = useState(initial?.description || '');
  const [categoryId, setCategoryId] = useState(initial?.categoryId || '');
  const [snooze, setSnooze] = useState(toLocalDateTimeInput(initial?.snoozeUntil));
  const [events, setEvents] = useState<EventDraft[]>(() => eventDrafts(initial));
  const [resources, setResources] = useState<ResourceDraft[]>(() => resourceDrafts(initial));
  const [checkItems, setCheckItems] = useState<CheckDraft[]>(() => checkDrafts(initial));
  const [checkText, setCheckText] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventStart, setEventStart] = useState('');
  const [eventEnd, setEventEnd] = useState('');
  const [resourceType, setResourceType] = useState<ResourceType>('FOLDER');
  const [resourceLabel, setResourceLabel] = useState('');
  const [resourceValue, setResourceValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  const deadlineDate = deadline.type === 'EXACT' && deadline.exact ? toLocalDateInput(deadline.exact) : '';
  const selectedCategory = useMemo(() => categories.find(category => category.id === categoryId), [categories, categoryId]);

  useEffect(() => { void repo.listCategories().then(setCategories); }, [repo]);
  useEffect(() => {
    inputRef.current?.focus();
    const focusTitle = () => window.setTimeout(() => inputRef.current?.focus(), 60);
    window.addEventListener('focus', focusTitle);
    return () => window.removeEventListener('focus', focusTitle);
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);
  useEffect(() => {
    if (!standalone) return;
    const mode = showDetails ? 'details' : showCandidates ? 'candidates' : 'compact';
    void resizeQuickAddWindow(mode);
  }, [standalone, showCandidates, showDetails]);

  function resetForm() {
    const next = todayDeadline();
    setTitle(''); setDeadline(next); setShowCandidates(false); setCandidateText(''); setCandidateError('');
    setShowDetails(false); setDescription(''); setCategoryId(''); setSnooze(''); setEvents([]); setResources([]); setCheckItems([]); setCheckText('');
    setEventTitle(''); setEventStart(''); setEventEnd(''); setResourceType('FOLDER'); setResourceLabel(''); setResourceValue(''); setError('');
  }

  function applyCandidateText() {
    const parsed = parseDeadlineText(candidateText);
    if (!parsed) { setCandidateError('認識できません。例：明後日、9/18、9月中旬、今週中、ASAP'); return; }
    setDeadline(parsed); setCandidateError(''); setCandidateText(''); setShowCandidates(false);
  }

  function addEventDraft() {
    if (!eventTitle.trim() || !eventStart) return;
    setEvents(rows => [...rows, { id: draftId(), title: eventTitle.trim(), start: eventStart, end: eventEnd }]);
    setEventTitle(''); setEventStart(''); setEventEnd('');
  }

  function addResourceDraft() {
    if (!resourceValue.trim()) return;
    const value = resourceValue.trim();
    setResources(rows => [...rows, { id: draftId(), type: resourceType, label: resourceLabel.trim() || value.split(/[\\/]/).pop() || value, value }]);
    setResourceLabel(''); setResourceValue('');
  }

  function addCheckDraft() {
    const value = checkText.trim();
    if (!value) return;
    setCheckItems(rows => [...rows, { id: draftId(), text: value, checked: false }]);
    setCheckText('');
  }

  function moveCheckDraft(id: string, direction: 'UP' | 'DOWN') {
    setCheckItems(rows => {
      const next = [...rows];
      const index = next.findIndex(row => row.id === id);
      const target = direction === 'UP' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= next.length) return rows;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function pickPath(type: 'FILE' | 'FOLDER') {
    const path = await chooseLocalPath(type);
    if (!path) return;
    setResourceType(type); setResourceValue(path);
    if (!resourceLabel) setResourceLabel(path.split(/[\\/]/).pop() || path);
  }

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!title.trim() || busy) return;
    if (!deadline.label) { setError('締切を指定してください。'); return; }
    setBusy(true); setError('');
    try {
      const task = await repo.createTask({
        title,
        deadline,
        description,
        categoryId: categoryId || null,
        snoozeUntil: snooze ? fromLocalDateTimeInput(snooze) : null,
        duplicatedFromTaskId: initial?.duplicatedFromTaskId || null,
        events: events.filter(row => row.title.trim() && row.start).map(row => ({ title: row.title.trim(), startsAt: fromLocalDateTimeInput(row.start), endsAt: row.end ? fromLocalDateTimeInput(row.end) : null })),
        resources: resources.filter(row => row.value.trim()).map(row => ({ type: row.type, label: row.label.trim() || row.value.trim(), value: row.value.trim() })),
        checkItems: checkItems.filter(row => row.text.trim()).map(row => ({ text: row.text.trim(), checked: row.checked }))
      });
      resetForm();
      onCreated(task);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return <div className={standalone ? 'quick-standalone' : 'modal-backdrop'} onMouseDown={event => { if (!standalone && event.currentTarget === event.target) onCancel(); }}>
    <form className={`${standalone ? 'quick-card standalone' : 'quick-card'} ${showDetails ? 'composer-detailed' : ''}`} onSubmit={submit}>
      <div className="quick-head">
        <div><span className="eyebrow">{initial?.duplicatedFromTaskId ? 'DUPLICATE TASK' : 'NEW TASK'}</span><h2>{initial?.duplicatedFromTaskId ? '複写して新規作成' : 'タスクを登録'}</h2>{initial?.sourceTitle && <small className="composer-source">複写元：{initial.sourceTitle}（内容を編集してから登録できます）</small>}</div>
        {!standalone && <button type="button" className="icon-button" onClick={onCancel} aria-label="閉じる">×</button>}
      </div>

      <div className="composer-scroll">
      <div className="composer-basic">
        <label className="field composer-title"><span>件名</span><input ref={inputRef} className="title-input" placeholder="何をする？" value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); dateRef.current?.focus(); }
        }} /></label>

        <div className="composer-deadline-row">
          <label className="field"><span>締切日</span><input ref={dateRef} type="date" value={deadlineDate} onChange={event => event.target.value && setDeadline(exactDeadlineFromDate(event.target.value))} /></label>
          <div className="composer-deadline-actions">
            <span className="current-deadline-label">{deadline.label}</span>
            <button type="button" className={`button secondary ${showCandidates ? 'active' : ''}`} onClick={() => setShowCandidates(value => !value)}>{showCandidates ? '候補を閉じる' : '候補から選ぶ'}</button>
          </div>
        </div>
      </div>

      {showCandidates && <div className="quick-deadline-options redesigned-options">
        <DeadlinePicker value={deadline} onChange={value => { setDeadline(value); setShowCandidates(false); }} compact presetsOnly />
        <div className="direct-deadline-entry">
          <div><strong>文字で入力</strong><small>「明後日」「9/18」「9月中旬」「今週中」「ASAP」など</small></div>
          <div className="inline-form"><input value={candidateText} onChange={event => { setCandidateText(event.target.value); setCandidateError(''); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); applyCandidateText(); } }} placeholder="例：明後日" /><button type="button" className="button secondary" disabled={!candidateText.trim()} onClick={applyCandidateText}>適用</button></div>
          {candidateError && <small className="field-error">{candidateError}</small>}
        </div>
      </div>}

      <div className="composer-mode-row">
        <button type="button" className={`composer-detail-toggle ${showDetails ? 'active' : ''}`} onClick={() => setShowDetails(value => !value)}><span>{showDetails ? '−' : '＋'}</span><strong>詳細入力</strong><small>分類・作業内容・チェック項目・予定・作業場所など</small></button>
      </div>

      {showDetails && <div className="composer-details">
        <div className="form-grid two composer-detail-grid">
          <label className="field"><span>分類（任意）</span><div className="category-select-wrap"><span className="category-dot" style={{ background: selectedCategory ? categoryColor(selectedCategory.color).accent : '#c8cbc5' }} /><select value={categoryId} onChange={event => setCategoryId(event.target.value)}><option value="">未分類</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div></label>
          <label className="field"><span>表示開始（任意）</span><input type="datetime-local" value={snooze} onChange={event => setSnooze(event.target.value)} /></label>
        </div>
        <label className="field"><span>作業内容（任意）</span><textarea rows={3} placeholder="補足、手順、確認事項など" value={description} onChange={event => setDescription(event.target.value)} /></label>

        <div className="composer-subsection checklist-composer">
          <div className="composer-subsection-head"><div><strong>チェック項目</strong><small>細かい作業手順を並べて、あとから✓できます</small></div><span>{checkItems.filter(item => item.checked).length}/{checkItems.length}</span></div>
          {checkItems.length > 0 && <div className="draft-list checklist-draft-list">{checkItems.map((row, index) => <div className="check-draft-row" key={row.id}>
            <input className="check-toggle" type="checkbox" checked={row.checked} onChange={event => setCheckItems(rows => rows.map(item => item.id === row.id ? { ...item, checked: event.target.checked } : item))} aria-label={`${row.text} を完了にする`} />
            <input className={row.checked ? 'check-text done' : 'check-text'} value={row.text} onChange={event => setCheckItems(rows => rows.map(item => item.id === row.id ? { ...item, text: event.target.value } : item))} />
            <div className="check-order-actions"><button type="button" className="mini-edit" disabled={index === 0} onClick={() => moveCheckDraft(row.id, 'UP')} title="上へ">↑</button><button type="button" className="mini-edit" disabled={index === checkItems.length - 1} onClick={() => moveCheckDraft(row.id, 'DOWN')} title="下へ">↓</button></div>
            <button type="button" className="icon-button danger-text" onClick={() => setCheckItems(rows => rows.filter(item => item.id !== row.id))} aria-label="チェック項目を削除">×</button>
          </div>)}</div>}
          <div className="check-add-row"><input placeholder="チェック項目を追加（例：資料を集める）" value={checkText} onChange={event => setCheckText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addCheckDraft(); } }} /><button type="button" className="button secondary" disabled={!checkText.trim()} onClick={addCheckDraft}>＋追加</button></div>
        </div>

        <div className="composer-subsection">
          <div className="composer-subsection-head"><div><strong>会議・イベント</strong><small>0件でも登録できます</small></div><span>{events.length}件</span></div>
          {events.length > 0 && <div className="draft-list">{events.map(row => <div className="draft-row event-draft" key={row.id}>
            <input aria-label="予定名" value={row.title} onChange={event => setEvents(rows => rows.map(item => item.id === row.id ? { ...item, title: event.target.value } : item))} />
            <input aria-label="予定開始" type="datetime-local" value={row.start} onChange={event => setEvents(rows => rows.map(item => item.id === row.id ? { ...item, start: event.target.value } : item))} />
            <input aria-label="予定終了" type="datetime-local" value={row.end} onChange={event => setEvents(rows => rows.map(item => item.id === row.id ? { ...item, end: event.target.value } : item))} />
            <button type="button" className="icon-button danger-text" onClick={() => setEvents(rows => rows.filter(item => item.id !== row.id))}>×</button>
          </div>)}</div>}
          <div className="draft-add-grid event-add-grid"><input placeholder="予定名" value={eventTitle} onChange={event => setEventTitle(event.target.value)} /><input type="datetime-local" value={eventStart} onChange={event => setEventStart(event.target.value)} /><input type="datetime-local" value={eventEnd} onChange={event => setEventEnd(event.target.value)} /><button type="button" className="button secondary" disabled={!eventTitle.trim() || !eventStart} onClick={addEventDraft}>＋追加</button></div>
        </div>

        <div className="composer-subsection">
          <div className="composer-subsection-head"><div><strong>作業フォルダ・ファイル・URL</strong><small>複数登録できます</small></div><span>{resources.length}件</span></div>
          {resources.length > 0 && <div className="draft-list">{resources.map(row => <div className="draft-row resource-draft" key={row.id}>
            <select aria-label="関連先種別" value={row.type} onChange={event => setResources(rows => rows.map(item => item.id === row.id ? { ...item, type: event.target.value as ResourceType } : item))}><option value="FOLDER">📁 フォルダ</option><option value="FILE">📄 ファイル</option><option value="URL">🔗 URL</option></select>
            <input aria-label="関連先表示名" value={row.label} onChange={event => setResources(rows => rows.map(item => item.id === row.id ? { ...item, label: event.target.value } : item))} />
            <input aria-label="関連先" value={row.value} onChange={event => setResources(rows => rows.map(item => item.id === row.id ? { ...item, value: event.target.value } : item))} />
            <button type="button" className="icon-button danger-text" onClick={() => setResources(rows => rows.filter(item => item.id !== row.id))}>×</button>
          </div>)}</div>}
          <div className="resource-type-row composer-resource-types">{(['FOLDER', 'FILE', 'URL'] as ResourceType[]).map(type => <button type="button" key={type} className={`chip ${resourceType === type ? 'active' : ''}`} onClick={() => setResourceType(type)}>{type === 'FOLDER' ? '📁 フォルダ' : type === 'FILE' ? '📄 ファイル' : '🔗 URL'}</button>)}</div>
          <div className="draft-add-grid resource-add-grid"><input placeholder="表示名（任意）" value={resourceLabel} onChange={event => setResourceLabel(event.target.value)} /><input placeholder={resourceType === 'URL' ? 'https://...' : 'パス'} value={resourceValue} onChange={event => setResourceValue(event.target.value)} />{resourceType !== 'URL' && <button type="button" className="button secondary" onClick={() => pickPath(resourceType)}>選択</button>}<button type="button" className="button secondary" disabled={!resourceValue.trim()} onClick={addResourceDraft}>＋追加</button></div>
        </div>
      </div>}

      {error && <div className="composer-error">{error}</div>}
      </div>
      <div className="quick-actions composer-actions">
        <span className="hint">急ぐときは件名＋締切だけ。必要なときだけ「詳細入力」を開けます。</span>
        <button className="button primary register-task-button" disabled={!title.trim() || busy}>{busy ? '登録中…' : 'タスクを登録'}</button>
      </div>
    </form>
  </div>;
}
