'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Coins, Plus } from 'lucide-react';
import { useWorkspace } from '@/hooks/use-workspace';
import { useI18n } from '@/i18n/client';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Status {
  balance: number;
  reply_cost: number;
  enforce: boolean;
  low: boolean;
  depleted: boolean;
  next_expiry: { at: string; credits: number } | null;
}

/** Dashboard card (admins): AI credits left with a "Top up" button right under the amount. */
export function CreditsCard({ className }: { className?: string }) {
  const { workspace } = useWorkspace();
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);
  const wsId = workspace?.id;

  useEffect(() => {
    if (!wsId) return;
    let alive = true;
    fetch('/api/billing/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Status | null) => alive && setStatus(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [wsId]);

  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE');
  const warn = status?.enforce && (status.depleted || status.low);

  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border bg-card p-5',
        status?.enforce && status.depleted ? 'border-destructive/50' : warn ? 'border-amber-500/50' : 'border-border',
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{t('billing.dashboard.title')}</p>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Coins className="h-4 w-4" aria-hidden />
        </div>
      </div>
      {!status ? (
        <div className="mt-3 h-7 w-24 animate-pulse rounded bg-muted" aria-hidden />
      ) : (
        <>
          <p className={cn('mt-3 text-[28px] leading-none font-bold tabular-nums', status.enforce && status.depleted ? 'text-destructive' : 'text-foreground')}>
            {nf.format(status.balance)}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {status.enforce && status.depleted
              ? t('billing.dashboard.depleted')
              : status.enforce && status.low
                ? t('billing.dashboard.low')
                : t('billing.dashboard.replies', { n: nf.format(Math.floor(status.balance / Math.max(1, status.reply_cost))) })}
          </p>
          {status.next_expiry && (
            <p className="text-xs text-muted-foreground">
              {t('billing.dashboard.expires', {
                credits: nf.format(status.next_expiry.credits),
                date: new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', { dateStyle: 'medium' }).format(new Date(status.next_expiry.at)),
              })}
            </p>
          )}
        </>
      )}
      <Link href="/settings?tab=billing" className={cn(buttonVariants({ size: 'sm', variant: warn ? 'default' : 'outline' }), 'mt-4 w-full')}>
        <Plus className="size-4" aria-hidden />
        {t('billing.dashboard.topup')}
      </Link>
    </div>
  );
}
