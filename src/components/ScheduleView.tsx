import { useEffect, useState } from 'react';
import type { ScheduleEvent } from '../types';
import type { Repository } from '../lib/repository';
import { formatDate } from '../lib/datetime';

type EventRow = ScheduleEvent & { taskTitle: string; taskId: string };

export function ScheduleView({ repo, onOpenTask }: { repo: Repository; onOpenTask: (id: string) => void }) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    repo.listTasks({ sort: 'URGENCY' }).then(tasks => Promise.all(tasks.map(t => repo.getTaskDetails(t.id).catch(() => null)))).then(details => {
      if (cancelled) return;
      const rows = details.flatMap(d => d ? d.events.map(e => ({ ...e, taskTitle: d.task.title, taskId: d.task.id })) : []).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      setEvents(rows); setLoading(false);
    });
    return () => { cancelled = true; };
  }, [repo]);

  const now = Date.now();
  return <div className="schedule-page">
    <div className="page-intro"><span className="eyebrow">SCHEDULE</span><h2>予定</h2><p>締切とは別に登録した会議・イベントを時系列で確認します。</p></div>
    {loading ? <div className="empty-state"><p>読み込み中…</p></div> : <div className="schedule-list">
      {events.map(e => <button key={e.id} className={`schedule-row ${new Date(e.starts_at).getTime() < now ? 'past' : ''}`} onClick={() => onOpenTask(e.taskId)}>
        <span className="schedule-date">{formatDate(e.starts_at, true)}</span>
        <span><strong>{e.title}</strong><small>{e.taskTitle}</small></span>
      </button>)}
      {!events.length && <div className="empty-state"><div className="empty-mark">📅</div><p>予定はまだありません。</p></div>}
    </div>}
  </div>;
}
