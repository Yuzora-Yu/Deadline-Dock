import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Task } from '../types';
import { formatShortDate, formatShortDateTime } from '../lib/datetime';
import { getUrgency } from '../lib/deadline';
import { categoryColor } from '../lib/categoryColors';

const RENDER_BATCH = 160;

function statusLabel(status: Task['status']) {
  return status === 'TODO' ? '未着手' : status === 'IN_PROGRESS' ? '作業中' : '完了';
}

export function TaskList({ tasks, selectedId, onSelect, emptyText = 'タスクはありません', mode = 'ACTIVE' }: { tasks: Task[]; selectedId?: string | null; onSelect: (task: Task) => void; emptyText?: string; mode?: 'ACTIVE' | 'ARCHIVE' }) {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(RENDER_BATCH, tasks.length));
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(Math.min(RENDER_BATCH, tasks.length));
  }, [tasks]);

  useEffect(() => {
    if (!selectedId) return;
    const selectedIndex = tasks.findIndex(task => task.id === selectedId);
    if (selectedIndex >= visibleCount) {
      setVisibleCount(Math.min(tasks.length, Math.ceil((selectedIndex + 1) / RENDER_BATCH) * RENDER_BATCH));
    }
  }, [selectedId, tasks, visibleCount]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || visibleCount >= tasks.length || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisibleCount(current => Math.min(tasks.length, current + RENDER_BATCH));
      }
    }, { rootMargin: '500px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [tasks.length, visibleCount]);

  const visibleTasks = useMemo(() => tasks.slice(0, visibleCount), [tasks, visibleCount]);

  if (!tasks.length) return <div className="empty-state"><div className="empty-mark">✓</div><p>{emptyText}</p></div>;
  return <div className="task-list">
    {visibleTasks.map(task => {
      const urgency = getUrgency(task);
      const archive = mode === 'ARCHIVE';
      const color = categoryColor(task.category_color);
      const categoryStyle = task.category_name ? { '--category-tint': color.tint, '--category-accent': color.accent } as CSSProperties : undefined;
      return <button type="button" key={task.id} aria-current={selectedId === task.id ? 'true' : undefined} style={categoryStyle} className={`task-row ${selectedId === task.id ? 'selected' : ''} ${task.category_name ? 'has-category-color' : ''}`} onClick={() => onSelect(task)}>
        <span className={`urgency-dot ${archive ? 'muted' : urgency.tone}`} aria-hidden="true" />
        <span className="task-main">
          <span className="task-title">{task.title}</span>
          <span className="task-meta">
            {archive
              ? <><span className="deadline-label normal">締切 {task.deadline_label}</span>{task.completed_at && <span>完了 {formatShortDate(task.completed_at)}</span>}</>
              : <span className={`deadline-label ${urgency.tone}`}>{urgency.label}</span>}
            {task.category_name && <span className="category-meta"><i style={{ background: color.accent }} />{task.category_name}</span>}
            {!archive && task.status !== 'TODO' && <span>{statusLabel(task.status)}</span>}
            {task.postponement_count > 0 && <span className="postponed">↪ 延期{task.postponement_count}回</span>}
          </span>
          {task.description.trim() && <span className="task-preview">{task.description}</span>}
          {!archive && task.next_event_at && <span className="next-event">📅 {formatShortDateTime(task.next_event_at)} {task.next_event_title}</span>}
        </span>
      </button>;
    })}
    {visibleCount < tasks.length && <div ref={sentinelRef} className="task-list-sentinel" aria-label="続きを読み込み中">{visibleCount.toLocaleString()} / {tasks.length.toLocaleString()}件を表示</div>}
  </div>;
}
