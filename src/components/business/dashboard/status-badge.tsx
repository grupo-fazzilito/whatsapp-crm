'use client';

import { useT } from '@/i18n/client';
import { cn } from '@/lib/utils';

const STYLE: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  confirmed: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  completed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  cancelled: 'bg-muted text-muted-foreground',
  no_show: 'bg-destructive/10 text-destructive',
};

export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STYLE[status] ?? 'bg-muted text-muted-foreground')}>
      {t(`business.status.${status}`)}
    </span>
  );
}
