'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Phone } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { formatMoney, moneyLocale } from '@/lib/workspace/countries';
import { formatCount, formatUsd } from '@/lib/reports/format';
import { LoadingBlock, Notice, selectClass } from '@/components/business/shared';
import { cn } from '@/lib/utils';
import type { MetaRates, NumberEstimate, NumberUsage } from '@/lib/meta-usage/rates';
import { StatTile } from './charts';
import { ReportCard } from './data-table';

interface NumberRow {
  channelId: string;
  name: string;
  phone: string | null;
  status: string;
  usage: NumberUsage;
  estimate: NumberEstimate;
  projectedService: number;
  projectedOverFree: boolean;
}

interface MetaUsage {
  month: string;
  current: boolean;
  market: string;
  rates: MetaRates;
  freePerNumber: number;
  currency: string;
  usdRate: number | null;
  numbers: NumberRow[];
  totals: { service: number; templates: number; costUsd: number; costLocal: number | null };
}

function lastMonths(count: number, now = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/** Reports → WhatsApp (Meta): free replies used per number and the estimated Meta charge. */
export function MetaUsageSection() {
  const { t, locale } = useI18n();
  const { workspace } = useWorkspace();
  const months = useMemo(() => lastMonths(6), []);
  const [month, setMonth] = useState(months[0]);
  const [result, setResult] = useState<{ key: string; data: MetaUsage | null; error: boolean } | null>(null);
  const key = `${workspace?.id}|${month}`;

  useEffect(() => {
    if (!workspace) return;
    const ctrl = new AbortController();
    fetch(`/api/reports/meta-usage?month=${month}`, { cache: 'no-store', signal: ctrl.signal })
      .then(async (r) => setResult({ key: `${workspace.id}|${month}`, data: r.ok ? await r.json() : null, error: !r.ok }))
      .catch((err) => {
        if (err?.name !== 'AbortError') setResult({ key: `${workspace.id}|${month}`, data: null, error: true });
      });
    return () => ctrl.abort();
  }, [workspace, month]);

  const numLocale = moneyLocale({ locale, country: workspace?.country ?? null });
  const n = (v: number) => formatCount(v, numLocale);
  const usd = (v: number) => formatUsd(v, numLocale);
  const monthLabel = (m: string) => {
    const [y, mo] = m.split('-').map(Number);
    const label = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, mo - 1, 1)));
    return label.charAt(0).toUpperCase() + label.slice(1);
  };

  const data = result?.key === key ? result.data : null;
  const loading = result?.key !== key;
  const local = (v: number) => (data?.usdRate ? formatMoney(v * data.usdRate, data.currency, numLocale) : null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('metaUsage.intro')}</p>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          {t('metaUsage.month')}
          <select value={month} onChange={(e) => setMonth(e.target.value)} className={selectClass}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : !data ? (
        <Notice className="flex items-center gap-2 border-destructive/40 text-destructive">
          <AlertTriangle className="size-4 shrink-0" aria-hidden /> {t('reports.errors.generic')}
        </Notice>
      ) : data.numbers.length === 0 ? (
        <Notice>{t('metaUsage.noNumbers')}</Notice>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile label={t('metaUsage.serviceSent')} value={n(data.totals.service)} sub={t('metaUsage.freePerNumber', { n: n(data.freePerNumber) })} />
            <StatTile label={t('metaUsage.templatesSent')} value={n(data.totals.templates)} sub={t('metaUsage.templatesSub')} />
            <StatTile label={t('metaUsage.costUsd')} value={usd(data.totals.costUsd)} sub={t('metaUsage.estimate')} />
            <StatTile
              label={t('metaUsage.costLocal', { currency: data.currency })}
              value={data.totals.costLocal !== null ? formatMoney(data.totals.costLocal, data.currency, numLocale) : '—'}
              sub={data.usdRate ? t('metaUsage.rate', { rate: String(data.usdRate), currency: data.currency }) : t('reports.ai.noRate')}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {data.numbers.map((row) => {
              const used = row.estimate.freeUsed;
              const pct = Math.min(100, Math.round((used / data.freePerNumber) * 100));
              const over = row.estimate.billableService > 0;
              const near = !over && pct >= 80;
              const templates = row.usage.marketing + row.usage.utility + row.usage.authentication + row.usage.other_template;
              return (
                <ReportCard
                  key={row.channelId}
                  title={row.name}
                  description={
                    row.phone ? (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="size-3" aria-hidden /> {row.phone}
                      </span>
                    ) : undefined
                  }
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium text-foreground">{t('metaUsage.freeUsed', { used: n(used), free: n(data.freePerNumber) })}</span>
                      <span className={cn('tabular-nums', over ? 'text-destructive' : 'text-muted-foreground')}>
                        {over ? t('metaUsage.billable', { n: n(row.estimate.billableService) }) : t('metaUsage.freeLeft', { n: n(row.estimate.freeLeft) })}
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label={t('metaUsage.freeUsed', { used: n(used), free: n(data.freePerNumber) })}
                      aria-valuemin={0}
                      aria-valuemax={data.freePerNumber}
                      aria-valuenow={used}
                      className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
                    >
                      <div
                        className={cn('h-full rounded-full transition-[width]', over ? 'bg-destructive' : near ? 'bg-amber-500' : 'bg-primary')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {data.current && row.projectedOverFree && !over && (
                      <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        {t('metaUsage.projection', { n: n(row.projectedService) })}
                      </p>
                    )}
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <dt className="text-muted-foreground">{t('metaUsage.service')}</dt>
                    <dd className="text-right tabular-nums">{n(row.usage.service)}</dd>
                    <dt className="text-muted-foreground">{t('metaUsage.marketing')}</dt>
                    <dd className="text-right tabular-nums">{n(row.usage.marketing)}</dd>
                    <dt className="text-muted-foreground">{t('metaUsage.utility')}</dt>
                    <dd className="text-right tabular-nums">{n(row.usage.utility + row.usage.other_template)}</dd>
                    <dt className="text-muted-foreground">{t('metaUsage.authentication')}</dt>
                    <dd className="text-right tabular-nums">{n(row.usage.authentication)}</dd>
                    <dt className="border-t border-border pt-1.5 font-medium text-foreground">{t('metaUsage.estimatedCost')}</dt>
                    <dd className="border-t border-border pt-1.5 text-right font-semibold tabular-nums text-foreground">
                      {usd(row.estimate.costUsd.total)}
                      {local(row.estimate.costUsd.total) && <span className="block text-xs font-normal text-muted-foreground">≈ {local(row.estimate.costUsd.total)}</span>}
                    </dd>
                  </dl>
                  {templates === 0 && row.usage.service === 0 && <p className="text-xs text-muted-foreground">{t('metaUsage.nothingYet')}</p>}
                </ReportCard>
              );
            })}
          </div>

          <p className="flex items-start gap-2 rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {t('metaUsage.disclaimer', {
                market: data.market === 'other' ? t('metaUsage.otherMarket') : data.market,
                service: usd(data.rates.service),
                utility: usd(data.rates.utility),
                marketing: usd(data.rates.marketing),
              })}
            </span>
          </p>
        </>
      )}
    </div>
  );
}
