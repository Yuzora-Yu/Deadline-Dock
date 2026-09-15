import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Category, CheckItem, DeadlineInput, Resource, ResourceType, ScheduleEvent, TaskDetails, TaskStatus } from '../types';
import type { Repository } from '../lib/repository';
import { deadlineInputFromTask } from '../lib/deadline';
import { formatDate, fromLocalDateTimeInput, toLocalDateTimeInput } from '../lib/datetime';
import { chooseLocalPath, openResource } from '../lib/platform';
import { DeadlinePicker } from './DeadlinePicker';
import { categoryColor } from '../lib/categoryColors';

function statusText(status: TaskStatus) { return status === 'TODO' ? '未着手' : status === 'IN_PROGRESS' ? '作業中' : '完了'; }

function parseMaybeJson(value?: string | null) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return value; }
}

function historyText(entry: TaskDetails['history'][number]) {
  const oldV = parseMaybeJson(entry.old_value);
  const newV = parseMaybeJson(entry.new_value);
  switch (entry.event_type) {
    case 'TASK_CREATED': return 'タスクを登録';
    case 'TASK_DUPLICATED': return '過去タスクから複写';
    case 'TASK_DELETED': return 'タスクを削除';
    case 'TASK_RESTORED': return '削除を取り消して復元';
    case 'TITLE_CHANGED': return `件名変更：「${oldV}」→「${newV}」`;
    case 'STATUS_CHANGED': return `状態変更：${statusText(oldV as TaskStatus)} → ${statusText(newV as TaskStatus)}`;
    case 'CATEGORY_CHANGED': return '分類を変更';
    case 'DESCRIPTION_CHANGED': return '作業内容を変更';
    case 'SNOOZE_CHANGED': return '表示開始日を変更';
    case 'DEADLINE_CHANGED': {
      const oldLabel = oldV?.label || '—'; const newLabel = newV?.label || '—';
      const tail = newV?.direction === 'POSTPONED' ? (newV.days ? `（${newV.days}日延期）` : '（延期）') : newV?.direction === 'ADVANCED' ? (newV.days ? `（${newV.days}日前倒し）` : '（前倒し）') : '';
      return `締切変更：${oldLabel} → ${newLabel}${tail}`;
    }
    case 'EVENT_ADDED': return `予定追加：${newV?.title || ''}`;
    case 'EVENT_CHANGED': return `予定変更：${newV?.title || ''}`;
    case 'EVENT_DELETED': return `予定削除：${oldV?.title || ''}`;
    case 'RESOURCE_ADDED': return `関連先追加：${newV?.label || newV?.value || ''}`;
    case 'RESOURCE_CHANGED': return `関連先変更：${newV?.label || newV?.value || ''}`;
    case 'RESOURCE_DELETED': return `関連先削除：${oldV?.label || oldV?.value || ''}`;
    case 'CHECKITEM_ADDED': return `チェック項目追加：${newV?.text || ''}`;
    case 'CHECKITEM_CHANGED': return `チェック項目変更：「${oldV || ''}」→「${newV || ''}」`;
    case 'CHECKITEM_TOGGLED': return `${newV?.checked ? '✓ ' : '未完了に戻す：'}${newV?.text || ''}`;
    case 'CHECKITEM_DELETED': return `チェック項目削除：${oldV?.text || ''}`;
    case 'CHECKITEM_REORDERED': return 'チェック項目の並び順を変更';
    default: return entry.event_type;
  }
}

function CheckItemRow({ item, index, total, repo, onChanged }: {
  item: CheckItem;
  index: number;
  total: number;
  repo: Repository;
  onChanged: () => Promise<void> | void;
}) {
  const [text, setText] = useState(item.text);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(item.text), [item.id, item.text]);

  async function saveText() {
    const value = text.trim();
    if (!value) { setText(item.text); return; }
    if (value === item.text || busy) return;
    setBusy(true);
    try { await repo.updateCheckItem(item.id, value); await onChanged(); } finally { setBusy(false); }
  }
  async function toggle(checked: boolean) {
    if (busy) return;
    setBusy(true);
    try { await repo.toggleCheckItem(item.id, checked); await onChanged(); } finally { setBusy(false); }
  }
  async function move(direction: 'UP' | 'DOWN') {
    if (busy) return;
    setBusy(true);
    try { await repo.moveCheckItem(item.id, direction); await onChanged(); } finally { setBusy(false); }
  }
  async function remove() {
    if (busy) return;
    setBusy(true);
    try { await repo.deleteCheckItem(item.id); await onChanged(); } finally { setBusy(false); }
  }

  return <div className={`task-check-row ${item.checked ? 'done' : ''}`}>
    <input className="check-toggle" type="checkbox" checked={Boolean(item.checked)} disabled={busy} onChange={event => void toggle(event.target.checked)} aria-label={`${item.text} を完了にする`} />
    <input className="task-check-text" value={text} disabled={busy} onChange={event => setText(event.target.value)} onBlur={() => void saveText()} onKeyDown={event => {
      if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === 'Escape') { setText(item.text); event.currentTarget.blur(); }
    }} />
    <div className="check-order-actions"><button type="button" className="mini-edit" disabled={busy || index === 0} onClick={() => void move('UP')} title="上へ">↑</button><button type="button" className="mini-edit" disabled={busy || index === total - 1} onClick={() => void move('DOWN')} title="下へ">↓</button></div>
    <button type="button" className="icon-button danger-text" disabled={busy} onClick={() => void remove()} aria-label="チェック項目を削除">×</button>
  </div>;
}

export function TaskDetail({ details, categories, repo, onChanged, onDeleted, onDuplicateRequested, onUndoable }: {
  details: TaskDetails;
  categories: Category[];
  repo: Repository;
  onChanged: () => Promise<void> | void;
  onDeleted: () => void;
  onDuplicateRequested: (details: TaskDetails) => void;
  onUndoable?: (message: string, taskId: string, undo: () => Promise<void>) => void;
}) {
  const { task } = details;
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [categoryId, setCategoryId] = useState(task.category_id || '');
  const [deadline, setDeadline] = useState<DeadlineInput>(() => deadlineInputFromTask(task));
  const [snooze, setSnooze] = useState(toLocalDateTimeInput(task.snooze_until));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const previousTask = useRef(task);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventStart, setEventStart] = useState('');
  const [eventEnd, setEventEnd] = useState('');
  const [resourceType, setResourceType] = useState<ResourceType>('FOLDER');
  const [resourceLabel, setResourceLabel] = useState('');
  const [resourceValue, setResourceValue] = useState('');
  const [checkText, setCheckText] = useState('');
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [editEventTitle, setEditEventTitle] = useState('');
  const [editEventStart, setEditEventStart] = useState('');
  const [editEventEnd, setEditEventEnd] = useState('');
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [editResourceType, setEditResourceType] = useState<ResourceType>('FOLDER');
  const [editResourceLabel, setEditResourceLabel] = useState('');
  const [editResourceValue, setEditResourceValue] = useState('');

  useEffect(() => {
    const previous=previousTask.current;
    const changedTask=previous.id!==task.id;
    setTitle(value=>changedTask || value===previous.title ? task.title : value);
    setDescription(value=>changedTask || value===previous.description ? task.description : value);
    setCategoryId(value=>changedTask || value===(previous.category_id || '') ? task.category_id || '' : value);
    setDeadline(value=>changedTask || JSON.stringify(value)===JSON.stringify(deadlineInputFromTask(previous)) ? deadlineInputFromTask(task) : value);
    setSnooze(value=>changedTask || value===toLocalDateTimeInput(previous.snooze_until) ? toLocalDateTimeInput(task.snooze_until) : value);
    previousTask.current=task;
  }, [task.id, task.updated_at]);

  async function saveBase() {
    if (!title.trim()) return;
    setSaving(true); setSaveError('');
    try {
      await repo.updateTaskFields(task.id, { title, description, categoryId: categoryId || null, snoozeUntil: snooze ? fromLocalDateTimeInput(snooze) : null });
      await repo.updateDeadline(task.id, deadline);
      await onChanged();
    } catch(e) {setSaveError(String(e));} finally { setSaving(false); }
  }

  async function saveDescription() {
    if (description===task.description || saving) return;
    setSaveError('');
    try {await repo.updateTaskFields(task.id,{description}); await onChanged();}
    catch(e){setSaveError(String(e));}
  }

  async function setStatus(status: TaskStatus) {
    const previous = task.status;
    if (previous === status) return;
    await repo.setStatus(task.id, status);
    await onChanged();
    if (status === 'COMPLETED' && previous !== 'COMPLETED') {
      onUndoable?.('タスクを完了しました', task.id, async () => { await repo.setStatus(task.id, previous); });
    }
  }
  async function removeTask() {
    if (!confirm(`「${task.title}」を削除しますか？`)) return;
    await repo.deleteTask(task.id);
    onDeleted();
    onUndoable?.('タスクを削除しました', task.id, async () => { await repo.restoreTask(task.id); });
  }
  async function addEvent() {
    if (!eventTitle.trim() || !eventStart) return;
    await repo.addEvent(task.id, { title: eventTitle, startsAt: fromLocalDateTimeInput(eventStart), endsAt: eventEnd ? fromLocalDateTimeInput(eventEnd) : null });
    setEventTitle(''); setEventStart(''); setEventEnd(''); await onChanged();
  }

  async function addCheckItem() {
    const value = checkText.trim();
    if (!value) return;
    await repo.addCheckItem(task.id, value);
    setCheckText('');
    await onChanged();
  }

  async function addResource() {
    if (!resourceValue.trim()) return;
    await repo.addResource(task.id, { type: resourceType, label: resourceLabel || resourceValue.split(/[\\/]/).pop() || resourceValue, value: resourceValue });
    setResourceLabel(''); setResourceValue(''); await onChanged();
  }

  function beginEventEdit(event: ScheduleEvent) {
    setEditingEvent(event); setEditEventTitle(event.title); setEditEventStart(toLocalDateTimeInput(event.starts_at)); setEditEventEnd(toLocalDateTimeInput(event.ends_at));
  }
  async function saveEventEdit() {
    if (!editingEvent || !editEventTitle.trim() || !editEventStart) return;
    await repo.updateEvent(editingEvent.id, { title: editEventTitle, startsAt: fromLocalDateTimeInput(editEventStart), endsAt: editEventEnd ? fromLocalDateTimeInput(editEventEnd) : null });
    setEditingEvent(null); await onChanged();
  }
  function beginResourceEdit(resource: Resource) {
    setEditingResource(resource); setEditResourceType(resource.type); setEditResourceLabel(resource.label); setEditResourceValue(resource.value);
  }
  async function saveResourceEdit() {
    if (!editingResource || !editResourceValue.trim()) return;
    await repo.updateResource(editingResource.id, { type: editResourceType, label: editResourceLabel, value: editResourceValue });
    setEditingResource(null); await onChanged();
  }
  async function pickEditPath(type: 'FILE' | 'FOLDER') {
    const path = await chooseLocalPath(type);
    if (path) { setEditResourceType(type); setEditResourceValue(path); if (!editResourceLabel) setEditResourceLabel(path.split(/[\\/]/).pop() || path); }
  }

  async function pickPath(type: 'FILE' | 'FOLDER') {
    const path = await chooseLocalPath(type);
    if (path) { setResourceType(type); setResourceValue(path); if (!resourceLabel) setResourceLabel(path.split(/[\\/]/).pop() || path); }
  }

  const detailColor = categoryColor(task.category_color);
  const detailStyle = task.category_name ? { '--category-tint': detailColor.tint, '--category-accent': detailColor.accent } as CSSProperties : undefined;

  return <div className={`detail-scroll ${task.category_name ? 'has-category-color' : ''}`} style={detailStyle}>
    <header className="detail-header">
      <div>
        <span className="eyebrow">TASK DETAIL</span>
        <div className="status-line">
          {(['TODO', 'IN_PROGRESS', 'COMPLETED'] as TaskStatus[]).map(s => <button type="button" key={s} className={`status-pill ${task.status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>{statusText(s)}</button>)}
        </div>
      </div>
      <div className="header-actions">
        <button type="button" className="button secondary" onClick={() => onDuplicateRequested(details)}>複写</button>
        <button type="button" className="button primary" disabled={saving || !title.trim()} onClick={saveBase}>{saving ? '保存中…' : '保存'}</button>
      </div>
    </header>

    <section className="form-section">
      <label className="field"><span>件名</span><input className="detail-title-input" value={title} onChange={e => setTitle(e.target.value)} /></label>
      <div className="form-grid two">
        <label className="field"><span>分類</span><select value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">未分類</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field"><span>表示開始（任意）</span><input type="datetime-local" value={snooze} onChange={e => setSnooze(e.target.value)} /></label>
      </div>
      <label className="field"><span>作業内容</span><textarea rows={5} placeholder="補足、手順、確認事項など" value={description} onChange={e => setDescription(e.target.value)} onBlur={()=>void saveDescription()} /><small className="field-help">{description!==task.description ? '編集中 · 入力欄を離れると保存します' : '保存済み · Google連携中は自動同期します'}</small></label>
      {saveError && <p className="settings-message" role="alert">保存できませんでした：{saveError}</p>}
      <div className="task-checklist-block">
        <div className="section-title compact"><div><span className="eyebrow">CHECKLIST</span><h3>チェック項目</h3></div><span className="count-badge">{details.checkItems.filter(item => item.checked).length}/{details.checkItems.length}</span></div>
        <div className="task-check-list">{details.checkItems.map((item, index) => <CheckItemRow key={item.id} item={item} index={index} total={details.checkItems.length} repo={repo} onChanged={onChanged} />)}</div>
        {details.checkItems.length === 0 && <div className="check-empty">段階的な作業がある場合は、ここにチェック項目を追加できます。</div>}
        <div className="check-add-row detail-check-add"><input placeholder="チェック項目を追加" value={checkText} onChange={e => setCheckText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void addCheckItem(); } }} /><button type="button" className="button secondary" disabled={!checkText.trim()} onClick={() => void addCheckItem()}>＋追加</button></div>
      </div>
    </section>

    <section className="form-section deadline-section">
      <div className="section-title"><div><span className="eyebrow">DEADLINE</span><h3>締切</h3></div>{task.postponement_count > 0 && <span className="warning-badge">↪ 延期 {task.postponement_count}回</span>}</div>
      <DeadlinePicker value={deadline} onChange={setDeadline} />
    </section>

    <section className="form-section">
      <div className="section-title"><div><span className="eyebrow">SCHEDULE</span><h3>会議・イベント</h3></div><span className="count-badge">{details.events.length}</span></div>
      <div className="stack-list">
        {details.events.map(e => <div className="stack-item" key={e.id}>
          <div><strong>{e.title}</strong><small>{formatDate(e.starts_at, true)}{e.ends_at ? ` ～ ${formatDate(e.ends_at, true)}` : ''}</small></div>
          <div className="stack-actions"><button type="button" className="mini-edit" onClick={() => beginEventEdit(e)}>編集</button><button type="button" className="icon-button danger-text" onClick={async () => { await repo.deleteEvent(e.id); await onChanged(); }}>×</button></div>
        </div>)}
      </div>
      <div className="add-box">
        <input placeholder="予定名（例：部長レビュー）" value={eventTitle} onChange={e => setEventTitle(e.target.value)} />
        <div className="form-grid two"><label className="field mini"><span>開始</span><input type="datetime-local" value={eventStart} onChange={e => setEventStart(e.target.value)} /></label><label className="field mini"><span>終了（任意）</span><input type="datetime-local" value={eventEnd} onChange={e => setEventEnd(e.target.value)} /></label></div>
        <button type="button" className="button secondary" onClick={addEvent} disabled={!eventTitle.trim() || !eventStart}>＋ 予定を追加</button>
      </div>
    </section>

    <section className="form-section">
      <div className="section-title"><div><span className="eyebrow">RESOURCES</span><h3>作業場所・URL</h3></div><span className="count-badge">{details.resources.length}</span></div>
      <div className="stack-list">
        {details.resources.map(r => <div className="stack-item resource-item" key={r.id}>
          <button type="button" className="resource-open" onClick={() => openResource(r.type, r.value)}>
            <span className="resource-icon">{r.type === 'FOLDER' ? '📁' : r.type === 'FILE' ? '📄' : '🔗'}</span>
            <span><strong>{r.label}</strong><small>{r.value}</small></span>
          </button>
          <div className="stack-actions"><button type="button" className="mini-edit" onClick={() => beginResourceEdit(r)}>編集</button><button type="button" className="icon-button danger-text" onClick={async () => { await repo.deleteResource(r.id); await onChanged(); }}>×</button></div>
        </div>)}
      </div>
      <div className="add-box">
        <div className="resource-type-row">
          {(['FOLDER', 'FILE', 'URL'] as ResourceType[]).map(t => <button type="button" key={t} className={`chip ${resourceType === t ? 'active' : ''}`} onClick={() => setResourceType(t)}>{t === 'FOLDER' ? '📁 フォルダ' : t === 'FILE' ? '📄 ファイル' : '🔗 URL'}</button>)}
        </div>
        <input placeholder="表示名（任意）" value={resourceLabel} onChange={e => setResourceLabel(e.target.value)} />
        <div className="inline-form">
          <input placeholder={resourceType === 'URL' ? 'https://...' : 'パス'} value={resourceValue} onChange={e => setResourceValue(e.target.value)} />
          {resourceType !== 'URL' && <button type="button" className="button secondary" onClick={() => pickPath(resourceType)}>選択</button>}
        </div>
        <button type="button" className="button secondary" onClick={addResource} disabled={!resourceValue.trim()}>＋ 関連先を追加</button>
      </div>
    </section>

    <section className="form-section history-section">
      <button type="button" className="history-toggle" onClick={() => setHistoryOpen(v => !v)}><span>変更履歴</span><span>{details.history.length}件 {historyOpen ? '▲' : '▼'}</span></button>
      {historyOpen && <div className="timeline">{details.history.map(h => <div className="timeline-item" key={h.id}><div className="timeline-dot" /><div><strong>{historyText(h)}</strong><small>{formatDate(h.created_at, true)}{h.actor_name?.startsWith('Google Sheets') ? ` · ${h.actor_name}` : ''}</small></div></div>)}</div>}
    </section>

    <div className="danger-zone"><button type="button" className="text-button danger-text" onClick={removeTask}>このタスクを削除</button></div>

    {editingEvent && <div className="modal-backdrop" onMouseDown={e => { if (e.currentTarget === e.target) setEditingEvent(null); }}>
      <div className="quick-card edit-card">
        <div className="quick-head"><div><span className="eyebrow">EDIT SCHEDULE</span><h2>予定を編集</h2></div><button className="icon-button" onClick={() => setEditingEvent(null)}>×</button></div>
        <input value={editEventTitle} onChange={e => setEditEventTitle(e.target.value)} placeholder="予定名" />
        <div className="form-grid two"><label className="field"><span>開始</span><input type="datetime-local" value={editEventStart} onChange={e => setEditEventStart(e.target.value)} /></label><label className="field"><span>終了（任意）</span><input type="datetime-local" value={editEventEnd} onChange={e => setEditEventEnd(e.target.value)} /></label></div>
        <div className="quick-actions"><span /><button className="button primary" onClick={saveEventEdit}>変更を保存</button></div>
      </div>
    </div>}

    {editingResource && <div className="modal-backdrop" onMouseDown={e => { if (e.currentTarget === e.target) setEditingResource(null); }}>
      <div className="quick-card edit-card">
        <div className="quick-head"><div><span className="eyebrow">EDIT RESOURCE</span><h2>作業場所・URLを編集</h2></div><button className="icon-button" onClick={() => setEditingResource(null)}>×</button></div>
        <div className="resource-type-row">{(['FOLDER','FILE','URL'] as ResourceType[]).map(t => <button type="button" key={t} className={`chip ${editResourceType === t ? 'active' : ''}`} onClick={() => setEditResourceType(t)}>{t === 'FOLDER' ? '📁 フォルダ' : t === 'FILE' ? '📄 ファイル' : '🔗 URL'}</button>)}</div>
        <input value={editResourceLabel} onChange={e => setEditResourceLabel(e.target.value)} placeholder="表示名" />
        <div className="inline-form"><input value={editResourceValue} onChange={e => setEditResourceValue(e.target.value)} placeholder={editResourceType === 'URL' ? 'https://...' : 'パス'} />{editResourceType !== 'URL' && <button className="button secondary" onClick={() => pickEditPath(editResourceType)}>選択</button>}</div>
        <div className="quick-actions"><span /><button className="button primary" onClick={saveResourceEdit}>変更を保存</button></div>
      </div>
    </div>}

  </div>;
}
