'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Send } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { cn } from '@/lib/utils';

interface Quota {
  limit: number | null;
  used: number;
  remaining: number | null;
  resets_at: string;
}

/** Free plan: broadcast recipients used this month out of the limit, with the way to remove it. */
export function BroadcastQuota() {
  const { t, locale } = useI18n();
  const [q, setQ] = useState<Quota | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/broadcasts/quota', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Quota | null) => alive && d && setQ(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!q || q.limit === null) return null;
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE');
  const pct = Math.min(100, Math.round((q.used / q.limit) * 100));
  const out = (q.remaining ?? 0) === 0;
  const resets = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', { dateStyle: 'medium' }).format(new Date(q.resets_at));

  return (
    <div className={cn('rounded-xl border p-4', out ? 'border-amber-500/40 bg-amber-500/10' : 'border-border bg-card')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Send className="size-4 text-primary" aria-hidden />
          {t('bc.limit.usage', { used: nf.format(q.used), limit: nf.format(q.limit) })}
        </p>
        <Link href="/settings?tab=invoicing" className="text-sm font-medium text-primary hover:underline">
          {t('bc.limit.upgrade')}
        </Link>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={q.limit} aria-valuenow={q.used} aria-label={t('bc.limit.usage', { used: nf.format(q.used), limit: nf.format(q.limit) })}>
        <div className={cn('h-full rounded-full', out ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t(out ? 'bc.limit.out' : 'bc.limit.help', { date: resets })}</p>
    </div>
  );
}
