'use client';

import { useId } from 'react';
import { useI18n } from '@/i18n/client';
import { Input } from '@/components/ui/input';
import { selectClass } from '@/components/business/shared';
import { cn } from '@/lib/utils';
import { DUE_PRESETS, TASK_PRIORITIES, fromLocalInput, presetDue, toLocalInput, type TaskPriority } from '@/lib/crm/tasks';
import type { MemberOption } from '@/components/crm/use-members';

/** Due date: quick presets + a datetime-local input. Value is an ISO string or null. */
export function DueField({ value, onChange, label }: { value: string | null; onChange: (iso: string | null) => void; label?: string }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label ?? t('crm.tasks.fields.due')}
      </label>
      <div className="flex flex-wrap gap-1" role="group" aria-label={t('crm.tasks.fields.duePresets')}>
        {DUE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(presetDue(p)?.toISOString() ?? null)}
            className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t(`crm.tasks.presets.${p}`)}
          </button>
        ))}
      </div>
      <Input id={id} type="datetime-local" value={toLocalInput(value)} onChange={(e) => onChange(fromLocalInput(e.target.value))} className="h-9" />
    </div>
  );
}

export function PrioritySelect({ value, onChange, className }: { value: TaskPriority; onChange: (p: TaskPriority) => void; className?: string }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className={cn('grid gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {t('crm.tasks.fields.priority')}
      </label>
      <select id={id} className={selectClass} value={value} onChange={(e) => onChange(e.target.value as TaskPriority)}>
        {TASK_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {t(`crm.tasks.priority.${p}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AssigneeSelect({
  value,
  onChange,
  members,
  meId,
  className,
}: {
  value: string | null;
  onChange: (userId: string | null) => void;
  members: MemberOption[];
  meId: string | null;
  className?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className={cn('grid gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {t('crm.tasks.fields.assignee')}
      </label>
      <select id={id} className={selectClass} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t('crm.tasks.unassigned')}</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.userId === meId ? t('crm.tasks.me', { name: m.name }) : m.name}
          </option>
        ))}
      </select>
    </div>
  );
}
