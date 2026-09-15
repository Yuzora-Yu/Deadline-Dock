import type { DeadlineInput, Task } from '../types';
import { fromLocalDateInput } from './datetime';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function endOfDayIso(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();
}

function startOfDayIso(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString();
}

export function exactDeadlineFromDate(value: string, label?: string): DeadlineInput {
  return { type: 'EXACT', label: label || value.replaceAll('-', '/'), exact: fromLocalDateInput(value, true) };
}


export function exactDeadlineFromDateTime(value: string): DeadlineInput {
  const d = new Date(value);
  const label = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
  return { type: 'EXACT', label, exact: d.toISOString() };
}

export function todayDeadline(base = new Date()): DeadlineInput {
  return { type: 'EXACT', label: '今日', exact: endOfDayIso(base) };
}

export function tomorrowDeadline(base = new Date()): DeadlineInput {
  const d = new Date(base);
  d.setDate(d.getDate() + 1);
  return { type: 'EXACT', label: '明日', exact: endOfDayIso(d) };
}

export function dayAfterTomorrowDeadline(base = new Date()): DeadlineInput {
  const d = new Date(base);
  d.setDate(d.getDate() + 2);
  return { type: 'EXACT', label: '明後日', exact: endOfDayIso(d) };
}

export function endOfThisMonthDeadline(base = new Date()): DeadlineInput {
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return { type: 'EXACT', label: '月末', exact: endOfDayIso(end) };
}

function weekEnd(base: Date, addWeeks = 0): Date {
  const d = new Date(base);
  const day = d.getDay();
  const daysUntilSunday = (7 - day) % 7;
  d.setDate(d.getDate() + daysUntilSunday + addWeeks * 7);
  return d;
}

function weekStart(base: Date, addWeeks = 0): Date {
  const d = new Date(base);
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + mondayOffset + addWeeks * 7);
  return d;
}

export function thisWeekDeadline(base = new Date()): DeadlineInput {
  const end = weekEnd(base);
  return { type: 'FUZZY_RANGE', label: '今週中', rangeStart: startOfDayIso(base), rangeEnd: endOfDayIso(end) };
}

export function nextWeekDeadline(base = new Date()): DeadlineInput {
  return {
    type: 'FUZZY_RANGE',
    label: '来週中',
    rangeStart: startOfDayIso(weekStart(base, 1)),
    rangeEnd: endOfDayIso(weekEnd(base, 1))
  };
}

export function thisMonthDeadline(base = new Date()): DeadlineInput {
  const start = new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return { type: 'FUZZY_RANGE', label: '今月中', rangeStart: startOfDayIso(start), rangeEnd: endOfDayIso(end) };
}

export function nextMonthDeadline(base = new Date()): DeadlineInput {
  const start = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  const end = new Date(base.getFullYear(), base.getMonth() + 2, 0);
  return { type: 'FUZZY_RANGE', label: '来月中', rangeStart: startOfDayIso(start), rangeEnd: endOfDayIso(end) };
}

export function monthSegmentDeadline(year: number, month: number, segment: 'EARLY' | 'MID' | 'LATE'): DeadlineInput {
  const last = new Date(year, month, 0).getDate();
  const [from, to, suffix] = segment === 'EARLY' ? [1, 10, '上旬'] : segment === 'MID' ? [11, 20, '中旬'] : [21, last, '下旬'];
  const start = new Date(year, month - 1, from);
  const end = new Date(year, month - 1, to);
  return {
    type: 'FUZZY_RANGE',
    label: `${month}月${suffix}`,
    rangeStart: startOfDayIso(start),
    rangeEnd: endOfDayIso(end)
  };
}

export function asapDeadline(): DeadlineInput {
  return { type: 'ASAP', label: 'できるだけ早く' };
}

// An open-ended fuzzy deadline: no invented due date and no overdue alert.
export function nonUrgentDeadline(): DeadlineInput {
  return { type: 'FUZZY_RANGE', label: '急ぎではない', exact: null, rangeStart: null, rangeEnd: null };
}

export function deadlineInputFromTask(task: Task): DeadlineInput {
  return {
    type: task.deadline_type,
    label: task.deadline_label,
    exact: task.deadline_exact,
    rangeStart: task.deadline_range_start,
    rangeEnd: task.deadline_range_end
  };
}

function dayDiff(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.ceil((b - a) / 86_400_000);
}

export type Urgency = {
  rank: number;
  keyDate: number;
  label: string;
  tone: 'danger' | 'warning' | 'attention' | 'normal' | 'muted';
};

export function getUrgency(task: Task, now = new Date()): Urgency {
  if (task.snooze_until && new Date(task.snooze_until) > now) {
    return { rank: 80, keyDate: new Date(task.snooze_until).getTime(), label: '寝かせ中', tone: 'muted' };
  }

  if (task.deadline_type === 'ASAP') {
    return { rank: 25, keyDate: new Date(task.created_at).getTime(), label: 'ASAP', tone: 'danger' };
  }

  const dueRaw = task.deadline_type === 'EXACT' ? task.deadline_exact : task.deadline_range_end;
  if (!dueRaw) return { rank: 70, keyDate: Number.MAX_SAFE_INTEGER, label: task.deadline_label, tone: 'normal' };
  const due = new Date(dueRaw);
  const days = dayDiff(now, due);

  if (task.deadline_type === 'EXACT' && due.getTime() < now.getTime()) {
    const pastDays = Math.max(0, Math.floor((now.getTime() - due.getTime()) / 86_400_000));
    return { rank: 0, keyDate: due.getTime(), label: pastDays > 0 ? `${pastDays}日超過` : '期限超過', tone: 'danger' };
  }
  if (days < 0) return { rank: 0, keyDate: due.getTime(), label: `${Math.abs(days)}日超過`, tone: 'danger' };
  if (days === 0) {
    const isTimed = task.deadline_type === 'EXACT' && !(due.getHours() === 23 && due.getMinutes() === 59);
    const time = isTimed ? new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(due) : '';
    return { rank: 10, keyDate: due.getTime(), label: time ? `今日 ${time}` : '今日', tone: 'danger' };
  }

  if (task.deadline_type === 'FUZZY_RANGE' && task.deadline_range_start) {
    const start = new Date(task.deadline_range_start);
    if (now >= start && now <= due) {
      return { rank: 30, keyDate: due.getTime(), label: task.deadline_label, tone: 'warning' };
    }
  }

  if (days <= 3) return { rank: 40, keyDate: due.getTime(), label: `あと${days}日`, tone: 'warning' };
  if (days <= 7) return { rank: 50, keyDate: due.getTime(), label: `あと${days}日`, tone: 'attention' };
  return { rank: 60, keyDate: due.getTime(), label: task.deadline_label, tone: 'normal' };
}

export function compareUrgency(a: Task, b: Task): number {
  const ua = getUrgency(a);
  const ub = getUrgency(b);
  return ua.rank - ub.rank || ua.keyDate - ub.keyDate || a.created_at.localeCompare(b.created_at);
}

export function describeDeadlineChange(oldDeadline: DeadlineInput, nextDeadline: DeadlineInput): { direction: 'POSTPONED' | 'ADVANCED' | 'CHANGED'; days?: number } {
  const oldDate = oldDeadline.type === 'EXACT' ? oldDeadline.exact : oldDeadline.type === 'FUZZY_RANGE' ? oldDeadline.rangeEnd : null;
  const newDate = nextDeadline.type === 'EXACT' ? nextDeadline.exact : nextDeadline.type === 'FUZZY_RANGE' ? nextDeadline.rangeEnd : null;
  if (!oldDate || !newDate) return { direction: 'CHANGED' };
  const deltaMs = new Date(newDate).getTime() - new Date(oldDate).getTime();
  const days = Math.floor(Math.abs(deltaMs) / 86_400_000);
  if (deltaMs > 0) return { direction: 'POSTPONED', days };
  if (deltaMs < 0) return { direction: 'ADVANCED', days };
  return { direction: 'CHANGED', days: 0 };
}

export function currentMonthSegments(base = new Date()) {
  const y = base.getFullYear();
  const m = base.getMonth() + 1;
  return [
    monthSegmentDeadline(y, m, 'EARLY'),
    monthSegmentDeadline(y, m, 'MID'),
    monthSegmentDeadline(y, m, 'LATE')
  ];
}

export function deadlineDebugKey(d: DeadlineInput) {
  return `${d.type}:${d.label}:${d.exact || ''}:${d.rangeStart || ''}:${d.rangeEnd || ''}:${dateKey(new Date())}`;
}

export function parseDeadlineText(raw: string, base = new Date()): DeadlineInput | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const normalized = text.toLowerCase().replace(/\s/g, '');

  if (['今日', 'きょう', 'today'].includes(normalized)) return todayDeadline(base);
  if (['明日', 'あした', 'tomorrow'].includes(normalized)) return tomorrowDeadline(base);
  if (['明後日', 'あさって'].includes(normalized)) return dayAfterTomorrowDeadline(base);
  if (['今週', '今週中'].includes(normalized)) return thisWeekDeadline(base);
  if (['来週', '来週中'].includes(normalized)) return nextWeekDeadline(base);
  if (['今月', '今月中'].includes(normalized)) return thisMonthDeadline(base);
  if (['来月', '来月中'].includes(normalized)) return nextMonthDeadline(base);
  if (['asap', 'できるだけ早く', 'なるべく早く', 'なる早'].includes(normalized)) return asapDeadline();
  if (['急ぎではない', '急がない', '未定', 'いつか'].includes(normalized)) return nonUrgentDeadline();

  const relativeSegment = normalized.match(/^(今月|来月)(上旬|中旬|下旬)$/);
  if (relativeSegment) {
    const offset = relativeSegment[1] === '来月' ? 1 : 0;
    const target = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    const segment = relativeSegment[2] === '上旬' ? 'EARLY' : relativeSegment[2] === '中旬' ? 'MID' : 'LATE';
    const result = monthSegmentDeadline(target.getFullYear(), target.getMonth() + 1, segment);
    return { ...result, label: text };
  }

  const segmentMatch = text.match(/^(?:(\d{4})年)?(\d{1,2})月(上旬|中旬|下旬)$/);
  if (segmentMatch) {
    const year = segmentMatch[1] ? Number(segmentMatch[1]) : base.getFullYear();
    const month = Number(segmentMatch[2]);
    if (month < 1 || month > 12) return null;
    const segment = segmentMatch[3] === '上旬' ? 'EARLY' : segmentMatch[3] === '中旬' ? 'MID' : 'LATE';
    const result = monthSegmentDeadline(year, month, segment);
    return { ...result, label: text };
  }

  const monthOnlyMatch = text.match(/^(?:(\d{4})年)?(\d{1,2})月中$/);
  if (monthOnlyMatch) {
    const year = monthOnlyMatch[1] ? Number(monthOnlyMatch[1]) : base.getFullYear();
    const month = Number(monthOnlyMatch[2]);
    if (month < 1 || month > 12) return null;
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    return { type: 'FUZZY_RANGE', label: text, rangeStart: startOfDayIso(start), rangeEnd: endOfDayIso(end) };
  }

  if (['月末', '今月末'].includes(normalized)) return { ...endOfThisMonthDeadline(base), label: text };

  const jpDate = text.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2}))?$/);
  const slashDate = text.match(/^(?:(\d{4})[\/-])?(\d{1,2})[\/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
  const parts = jpDate || slashDate;
  if (parts) {
    const year = parts[1] ? Number(parts[1]) : base.getFullYear();
    const month = Number(parts[2]);
    const day = Number(parts[3]);
    const hour = parts[4] === undefined ? null : Number(parts[4]);
    const minute = parts[5] === undefined ? null : Number(parts[5]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    if (hour !== null && (hour < 0 || hour > 23 || minute === null || minute < 0 || minute > 59)) return null;
    const probe = new Date(year, month - 1, day, hour ?? 12, minute ?? 0, 0, 0);
    if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
    const ymd = `${year}-${pad(month)}-${pad(day)}`;
    if (hour === null) return exactDeadlineFromDate(ymd, text);
    const result = exactDeadlineFromDateTime(`${ymd}T${pad(hour)}:${pad(minute!)}`);
    return { ...result, label: text };
  }

  return null;
}
