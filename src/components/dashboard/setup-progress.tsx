'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Rocket } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Steps {
  account: boolean;
  business: boolean;
  agent: boolean;
  training: boolean;
  test: boolean;
  channel: boolean;
  firstAgentId: string | null;
}

const ORDER = ['account', 'business', 'agent', 'training', 'test', 'channel'] as const;
type StepKey = (typeof ORDER)[number];

function href(step: StepKey, s: Steps): string {
  switch (step) {
    case 'business':
      return '/business/setup';
    case 'agent':
      return '/agents?new=1';
    case 'training':
      return s.firstAgentId ? `/agents/${s.firstAgentId}?tab=training` : '/agents';
    case 'test':
      return s.firstAgentId ? `/agents/${s.firstAgentId}?tab=test` : '/agents';
    case 'channel':
      return '/channels';
    default:
      return '/dashboard';
  }
}

/**
 * Getting-started checklist. Shown until the business connects its first
 * channel; then the dashboard shows the Connected accounts widget instead.
 * `onState` tells the page whether it is showing.
 */
export function SetupProgress({ onState }: { onState?: (showing: boolean) => void }) {
  const { t } = useI18n();
  const { workspace, can } = useWorkspace();
  const [steps, setSteps] = useState<Steps | null>(null);

  useEffect(() => {
    if (!workspace) return;
    let alive = true;
    fetch('/api/dashboard/setup', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { steps: Steps } | null) => {
        if (!alive || !d) return;
        setSteps(d.steps);
        onState?.(!d.steps.channel);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workspace, onState]);

  if (!steps || steps.channel) return null;
  const done = ORDER.filter((k) => steps[k]).length;
  const next = ORDER.find((k) => !steps[k]) ?? 'channel';
  const pct = Math.round((done / ORDER.length) * 100);
  const isAdmin = can('admin');

  return (
    <section aria-labelledby="setup-title" className="overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card">
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden>
              <Rocket className="size-5" />
            </span>
            <div>
              <h2 id="setup-title" className="text-lg font-semibold text-foreground">
                {t('dash.setup.title')}
              </h2>
              <p className="text-sm text-muted-foreground">{t('dash.setup.subtitle')}</p>
            </div>
          </div>
          <span className="text-sm font-semibold text-primary tabular-nums">{t('dash.setup.progress', { done, total: ORDER.length })}</span>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={ORDER.length} aria-valuenow={done} aria-label={t('dash.setup.progress', { done, total: ORDER.length })}>
          <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>

        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ORDER.map((k, i) => {
            const ok = steps[k];
            const current = k === next;
            return (
              <li
                key={k}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3',
                  ok ? 'border-emerald-500/40 bg-emerald-500/10' : current ? 'border-primary bg-card shadow-sm' : 'border-border bg-card/60',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    ok ? 'bg-emerald-500 text-white' : current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                  )}
                  aria-hidden
                >
                  {ok ? <Check className="size-3.5" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium', ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground')}>
                    {t(`dash.setup.steps.${k}.title`)}
                    {ok && <span className="sr-only"> — {t('dash.setup.done')}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">{t(`dash.setup.steps.${k}.desc`)}</p>
                  {current && !ok && k !== 'account' && (isAdmin || k === 'test') && (
                    <Link href={href(k, steps)} className={cn(buttonVariants({ size: 'sm' }), 'mt-2')}>
                      {t(`dash.setup.steps.${k}.cta`)}
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
