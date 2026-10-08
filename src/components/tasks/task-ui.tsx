'use client';

import { AlarmClock, CalendarClock, Flag } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { cn } from '@/lib/utils';
import { dueBucket, type TaskPriority } from '@/lib/crm/tasks';

const PRIORITY_CLASS: Record<TaskPriority, string> = {
  low: 'border-border text-muted-foreground',
  normal: 'border-sky-500/40 text-sky-700 dark:text-sky-300',
  high: 'border-amber-500/50 text-amber-700 dark:text-amber-300',
  urgent: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300',
};

export function PriorityChip({ priority, className }: { priority: TaskPriority; className?: string }) {
  const { t } = useI18n();
  if (priority === 'normal') return null;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', PRIORITY_CLASS[priority], className)}>
      <Flag aria-hidden className="size-3" />
      {t(`crm.tasks.priority.${priority}`)}
    </span>
  );
}

/** "Hoy 18:00", "Mañana 09:00", "vie 14 oct 10:00" — prefixed when overdue. */
export function useDueFormatter() {
  const { t, locale } = useI18n();
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const date = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' });
  return (dueAt: string, now: Date = new Date()) => {
    const d = new Date(dueAt);
    const b = dueBucket(dueAt, now);
    const sameDay = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    let label: string;
    if (sameDay) label = t('crm.tasks.due.todayAt', { time: time.format(d) });
    else if (d.toDateString() === tomorrow.toDateString()) label = t('crm.tasks.due.tomorrowAt', { time: time.format(d) });
    else if (d.toDateString() === yesterday.toDateString()) label = t('crm.tasks.due.yesterdayAt', { time: time.format(d) });
    else label = `${date.format(d)} ${time.format(d)}`;
    return { label, overdue: b === 'overdue' };
  };
}

export function DueBadge({ dueAt, done, className }: { dueAt: string | null; done?: boolean; className?: string }) {
  const { t } = useI18n();
  const fmt = useDueFormatter();
  if (!dueAt) return null;
  const { label, overdue } = fmt(dueAt);
  const late = overdue && !done;
  const Icon = late ? AlarmClock : CalendarClock;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        late ? 'font-medium text-red-700 dark:text-red-400' : 'text-muted-foreground',
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5" />
      {late && <span className="sr-only">{t('crm.tasks.due.overdueSr')}</span>}
      {label}
    </span>
  );
}
