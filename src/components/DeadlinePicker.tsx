import { useMemo, useState } from 'react';
import type { DeadlineInput } from '../types';
import {
  asapDeadline, nonUrgentDeadline, dayAfterTomorrowDeadline, endOfThisMonthDeadline, exactDeadlineFromDate, exactDeadlineFromDateTime,
  monthSegmentDeadline, nextMonthDeadline, nextWeekDeadline, thisMonthDeadline, thisWeekDeadline, todayDeadline, tomorrowDeadline
} from '../lib/deadline';
import { toLocalDateInput, toLocalDateTimeInput } from '../lib/datetime';

export function DeadlinePicker({ value, onChange, compact = false, presetsOnly = false }: {
  value: DeadlineInput;
  onChange: (value: DeadlineInput) => void;
  compact?: boolean;
  presetsOnly?: boolean;
}) {
  const [showTime, setShowTime] = useState(false);
  const now = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const dateValue = value.type === 'EXACT' && value.exact ? toLocalDateInput(value.exact) : '';
  const dateTimeValue = value.type === 'EXACT' && value.exact ? toLocalDateTimeInput(value.exact) : '';
  const segments = useMemo(() => {
    const [year, monthNumber] = month.split('-').map(Number);
    return [
      monthSegmentDeadline(year, monthNumber, 'EARLY'),
      monthSegmentDeadline(year, monthNumber, 'MID'),
      monthSegmentDeadline(year, monthNumber, 'LATE')
    ];
  }, [month]);

  const quickPresets: Array<{ deadline: DeadlineInput; hint?: string }> = [
    { deadline: todayDeadline() },
    { deadline: tomorrowDeadline() },
    { deadline: dayAfterTomorrowDeadline() },
    { deadline: endOfThisMonthDeadline() },
    { deadline: asapDeadline() },
    { deadline: nonUrgentDeadline() }
  ];
  const rangePresets = [thisWeekDeadline(), nextWeekDeadline(), thisMonthDeadline(), nextMonthDeadline()];

  return <div className={`deadline-picker redesigned ${compact ? 'compact' : ''} ${presetsOnly ? 'presets-only' : ''}`}>
    {!presetsOnly && <>
      <div className="deadline-current">
        <span className="eyebrow">現在の締切</span>
        <strong>{value.label}</strong>
      </div>
      <div className="deadline-primary-field">
        <label className="field"><span>締切日</span><input aria-label="締切日" type="date" value={dateValue} onChange={e => e.target.value && onChange(exactDeadlineFromDate(e.target.value))} /></label>
        <button type="button" className={`text-button time-toggle ${showTime ? 'active' : ''}`} onClick={() => setShowTime(v => !v)}>{showTime ? '時刻指定を閉じる' : '時刻も指定'}</button>
      </div>
      {showTime && <label className="field deadline-time-field"><span>締切日時</span><input aria-label="締切日時" type="datetime-local" value={dateTimeValue} onChange={e => e.target.value && onChange(exactDeadlineFromDateTime(e.target.value))} /></label>}
    </>}

    <div className="deadline-preset-group">
      <div className="deadline-group-label"><strong>すぐ選ぶ</strong><small>よく使う期限</small></div>
      <div className="deadline-preset-grid">
        {quickPresets.map(({ deadline }) => <button key={`${deadline.type}-${deadline.label}`} type="button" className={`deadline-choice ${value.label === deadline.label ? 'active' : ''}`} onClick={() => onChange(deadline)}><strong>{deadline.label}</strong></button>)}
      </div>
    </div>

    <div className="deadline-preset-group">
      <div className="deadline-group-label"><strong>期間で指定</strong><small>日付を決めきれない仕事向け</small></div>
      <div className="deadline-preset-grid ranges">
        {rangePresets.map(deadline => <button key={deadline.label} type="button" className={`deadline-choice ${value.label === deadline.label ? 'active' : ''}`} onClick={() => onChange(deadline)}><strong>{deadline.label}</strong></button>)}
      </div>
    </div>

    <div className="deadline-preset-group fuzzy-group">
      <div className="deadline-group-label"><strong>上旬・中旬・下旬</strong><small>月を選んでざっくり指定</small></div>
      <div className="month-segment-picker redesigned">
        <input aria-label="曖昧期限の月" type="month" value={month} onChange={e => setMonth(e.target.value)} />
        <div className="segment-buttons">{segments.map(deadline => <button key={deadline.label} type="button" className={`deadline-choice ${value.label === deadline.label ? 'active' : ''}`} onClick={() => onChange(deadline)}><strong>{deadline.label.replace(/^\d+月/, '')}</strong></button>)}</div>
      </div>
    </div>
  </div>;
}
