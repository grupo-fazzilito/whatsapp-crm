'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AlertCircle, Bot, CalendarClock, CheckCircle2, Clock, Flame, Inbox, ListTodo, MessageSquare, MessagesSquare, ShoppingBag, Target, UserPlus, Users } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { cn } from '@/lib/utils';
import { formatMoney, moneyLocale } from '@/lib/workspace/countries';
import { CHANNEL_STYLE } from '@/components/channels/channel-types';
import type { ChannelType } from '@/lib/channels/types';
import type { WidgetId } from '@/lib/dashboard/widgets';
import type { ActivityItem, ConversationsSeriesPoint, PipelineDonutData, ResponseTimeSummary } from '@/lib/dashboard/types';
import { CreditsCard } from '@/components/billing/credits-card';
import { ConversationsChart } from './conversations-chart';
import { PipelineDonut } from './pipeline-donut';
import { ResponseTimeChart } from './response-time-chart';
import { ActivityFeed } from './activity-feed';
import { QuickActions } from './quick-actions';
import { ConnectedAccounts } from './connected-accounts';

/** KPI data for the widgets on screen (one request, see DashboardGrid). */
export const KpiContext = createContext<{ data: Partial<Record<WidgetId, unknown>> | null; loading: boolean }>({ data: null, loading: true });

type Num = number;
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

async function section<T>(name: string, key: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams({ section: name, tz: tz(), ...params });
  const res = await fetch(`/api/dashboard?${qs}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json())[key] as T;
}

/** Card shell shared by the KPI widgets. */
function Kpi({ title, icon: Icon, children, tone }: { title: string; icon: typeof Inbox; children: ReactNode; tone?: 'warn' | 'good' }) {
  return (
    <div className={cn('flex h-full flex-col rounded-xl border bg-card p-5', tone === 'warn' ? 'border-amber-500/50' : 'border-border')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', tone === 'warn' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300' : 'bg-muted text-muted-foreground')} aria-hidden>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 flex flex-1 flex-col gap-1">{children}</div>
    </div>
  );
}

function Big({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-[28px] leading-none font-bold tabular-nums text-foreground', className)}>{children}</p>;
}

function Sub({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function Skeleton() {
  return (
    <div className="h-full min-h-[132px] animate-pulse rounded-xl border border-border bg-card p-5" aria-hidden>
      <div className="h-3 w-24 rounded bg-muted" />
      <div className="mt-4 h-7 w-16 rounded bg-muted" />
    </div>
  );
}

function useKpi<T>(id: WidgetId): { value: T | null; loading: boolean } {
  const { data, loading } = useContext(KpiContext);
  return { value: (data?.[id] as T | undefined) ?? null, loading };
}

function minutes(m: number | null, locale: string) {
  if (m === null || !Number.isFinite(m)) return '—';
  if (m < 1) return locale === 'en' ? '< 1 min' : '< 1 min';
  if (m < 60) return `${Math.round(m)} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${Math.round(m % 60)} min`;
}

function since(iso: string | null, locale: string) {
  if (!iso) return '';
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  return minutes(mins, locale);
}

// ── Charts that load their own data ──────────────────────────────

function ConversationsChartWidget() {
  const [series, setSeries] = useState<Record<7 | 30 | 90, ConversationsSeriesPoint[] | null>>({ 7: null, 30: null, 90: null });
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (series[range]) return;
    let alive = true;
    section<ConversationsSeriesPoint[]>('series', 'series', { range: String(range) })
      .then((s) => alive && setSeries((p) => ({ ...p, [range]: s })))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [range, series]);
  return <ConversationsChart series={series} loading={loading && !series[range]} range={range} onRangeChange={setRange} />;
}

function useSection<T>(name: string, key: string, params?: Record<string, string>) {
  const [value, setValue] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const qs = JSON.stringify(params ?? {});
  useEffect(() => {
    let alive = true;
    section<T>(name, key, JSON.parse(qs))
      .then((v) => alive && setValue(v))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [name, key, qs]);
  return { value, loading };
}

function PipelineWidget() {
  const { value, loading } = useSection<PipelineDonutData>('pipeline', 'pipeline');
  return <PipelineDonut data={value} loading={loading} />;
}

function ResponseTimeWidget() {
  const { value, loading } = useSection<ResponseTimeSummary>('response-time', 'responseTime');
  return <ResponseTimeChart data={value} loading={loading} />;
}

function ActivityWidget() {
  const { value, loading } = useSection<ActivityItem[]>('activity', 'activity', { limit: '50' });
  return <ActivityFeed items={value} loading={loading} />;
}

function MetaFreeRepliesWidget() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<{ freePerNumber: number; numbers: { channelId: string; name: string; estimate: { freeUsed: number; billableService: number } }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/reports/meta-usage', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE');
  if (!data) return <Skeleton />;
  return (
    <Kpi title={t('dash.w.meta_free_replies.title')} icon={MessageSquare}>
      {data.numbers.length === 0 ? (
        <Sub>{t('dash.w.meta_free_replies.none')}</Sub>
      ) : (
        <ul className="grid gap-3">
          {data.numbers.map((n) => {
            const pct = Math.min(100, Math.round((n.estimate.freeUsed / data.freePerNumber) * 100));
            const over = n.estimate.billableService > 0;
            return (
              <li key={n.channelId} className="grid gap-1">
                <div className="flex justify-between gap-2 text-sm">
                  <span className="truncate text-foreground">{n.name}</span>
                  <span className={cn('tabular-nums', over ? 'text-destructive' : 'text-muted-foreground')}>
                    {t('dash.w.meta_free_replies.used', { used: nf.format(n.estimate.freeUsed), free: nf.format(data.freePerNumber) })}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={data.freePerNumber} aria-valuenow={n.estimate.freeUsed} aria-label={n.name}>
                  <div className={cn('h-full rounded-full', over ? 'bg-destructive' : pct >= 80 ? 'bg-amber-500' : 'bg-primary')} style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Link href="/reports" className="mt-auto pt-2 text-xs font-medium text-primary hover:underline">
        {t('reports.navTitle')} →
      </Link>
    </Kpi>
  );
}

// ── KPI widgets ─────────────────────────────────────────────────

function KpiWidget({ id }: { id: WidgetId }) {
  const { t, locale } = useI18n();
  const { workspace } = useWorkspace();
  const { value, loading } = useKpi<Record<string, unknown>>(id);
  if (loading && !value) return <Skeleton />;
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE');
  const n = (k: string) => Number((value as Record<string, unknown> | null)?.[k] ?? 0) as Num;
  const money = (v: number, currency?: unknown) =>
    formatMoney(v, String(currency || workspace?.currency || 'USD'), moneyLocale({ locale, country: workspace?.country ?? null }), { whole: true });
  const title = t(`dash.w.${id}.title`);

  switch (id) {
    case 'conversations_handled':
      return (
        <Kpi title={title} icon={MessagesSquare}>
          <Big>{nf.format(n('total'))}</Big>
          <div className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Bot className="size-3.5" aria-hidden /> {t('dash.w.conversations_handled.ai')}: <b className="font-semibold text-foreground">{nf.format(n('ai'))}</b>
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" aria-hidden /> {t('dash.w.conversations_handled.human')}: <b className="font-semibold text-foreground">{nf.format(n('human'))}</b>
            </span>
          </div>
          <Sub>{t('dash.w.conversations_handled.vsYesterday', { n: nf.format(n('yesterday')) })}</Sub>
        </Kpi>
      );
    case 'new_leads':
      return (
        <Kpi title={title} icon={UserPlus}>
          <Big>{nf.format(n('current'))}</Big>
          <Sub>{t('dash.w.new_leads.vsYesterday', { n: nf.format(n('previous')) })}</Sub>
        </Kpi>
      );
    case 'active_conversations':
      return (
        <Kpi title={title} icon={Inbox}>
          <Big>{nf.format(n('current'))}</Big>
          <Sub>{t('dash.w.active_conversations.newToday', { n: nf.format(n('previous')) })}</Sub>
        </Kpi>
      );
    case 'unanswered': {
      const count = n('count');
      return (
        <Kpi title={title} icon={count ? AlertCircle : CheckCircle2} tone={count ? 'warn' : undefined}>
          <Big className={count ? 'text-amber-600 dark:text-amber-300' : undefined}>{nf.format(count)}</Big>
          <Sub>
            {count
              ? t('dash.w.unanswered.oldest', { t: since(String((value as Record<string, unknown>)?.oldestSince ?? ''), locale) })
              : t('dash.w.unanswered.allClear')}
          </Sub>
          {count > 0 && (
            <Link href="/inbox" className="mt-auto pt-1 text-xs font-medium text-primary hover:underline">
              {t('nav.inbox')} →
            </Link>
          )}
        </Kpi>
      );
    }
    case 'messages_today':
      return (
        <Kpi title={title} icon={MessageSquare}>
          <div className="flex items-end gap-6">
            <div>
              <Big>{nf.format(n('inbound'))}</Big>
              <Sub>{t('dash.w.messages_today.in')}</Sub>
            </div>
            <div>
              <Big>{nf.format(n('outbound'))}</Big>
              <Sub>{t('dash.w.messages_today.out')}</Sub>
            </div>
          </div>
        </Kpi>
      );
    case 'first_response': {
      const cur = (value as { thisWeekAvg: number | null } | null)?.thisWeekAvg ?? null;
      const prev = (value as { lastWeekAvg: number | null } | null)?.lastWeekAvg ?? null;
      return (
        <Kpi title={title} icon={Clock}>
          <Big>{cur === null ? '—' : minutes(cur, locale)}</Big>
          <Sub>{cur === null && prev === null ? t('dash.w.first_response.noData') : t('dash.w.first_response.lastWeek', { t: minutes(prev, locale) })}</Sub>
        </Kpi>
      );
    }
    case 'ai_today':
      return (
        <Kpi title={title} icon={Bot}>
          <Big>
            {nf.format(n('replies'))} <span className="text-base font-medium text-muted-foreground">{t('dash.w.ai_today.replies')}</span>
          </Big>
          <dl className="mt-1 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">{t('dash.w.ai_today.handovers')}</dt>
              <dd className="font-semibold tabular-nums text-foreground">{nf.format(n('handovers'))}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('dash.w.ai_today.tokens')}</dt>
              <dd className="font-semibold tabular-nums text-foreground">{nf.format(n('tokens'))}</dd>
            </div>
          </dl>
        </Kpi>
      );
    case 'open_deals':
      return (
        <Kpi title={title} icon={Target}>
          <Big>{money(n('value'), (value as Record<string, unknown> | null)?.currency)}</Big>
          <Sub>{t('dash.w.open_deals.count', { n: nf.format(n('count')) })}</Sub>
        </Kpi>
      );
    case 'tasks_due': {
      const overdue = n('overdue');
      return (
        <Kpi title={title} icon={ListTodo} tone={overdue ? 'warn' : undefined}>
          <div className="flex items-end gap-6">
            <div>
              <Big className={overdue ? 'text-amber-600 dark:text-amber-300' : undefined}>{nf.format(overdue)}</Big>
              <Sub>{t('dash.w.tasks_due.overdue')}</Sub>
            </div>
            <div>
              <Big>{nf.format(n('today'))}</Big>
              <Sub>{t('dash.w.tasks_due.today')}</Sub>
            </div>
          </div>
          <Link href="/tasks" className="mt-auto pt-1 text-xs font-medium text-primary hover:underline">
            {t('dash.w.tasks_due.open', { n: nf.format(n('open')) })} →
          </Link>
        </Kpi>
      );
    }
    case 'bookings_today': {
      const upcoming = ((value as { upcoming?: { id: string; date: string; time: string; customer_name: string | null; service: string | null; product: string | null }[] } | null)?.upcoming ?? []);
      const df = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
      return (
        <Kpi title={title} icon={CalendarClock}>
          <Big>{t('dash.w.bookings_today.today', { n: nf.format(n('today')) })}</Big>
          {upcoming.length === 0 ? (
            <Sub>{t('dash.w.bookings_today.none')}</Sub>
          ) : (
            <ul className="mt-1 divide-y divide-border text-sm">
              {upcoming.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate text-foreground">{b.customer_name || '—'} <span className="text-muted-foreground">· {b.service || b.product || ''}</span></span>
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {df.format(new Date(`${b.date}T00:00:00Z`))} {b.time}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Kpi>
      );
    }
    case 'orders_today':
      return (
        <Kpi title={title} icon={ShoppingBag}>
          <Big>{nf.format(n('today'))}</Big>
          <Sub>{money(n('revenue'), (value as Record<string, unknown> | null)?.currency)}</Sub>
          {n('pending') > 0 && (
            <Link href="/orders" className="mt-auto pt-1 text-xs font-medium text-primary hover:underline">
              {t('dash.w.orders_today.pending', { n: nf.format(n('pending')) })} →
            </Link>
          )}
        </Kpi>
      );
    case 'hot_leads':
      return (
        <Kpi title={title} icon={Flame}>
          <Big>{nf.format(n('hot'))}</Big>
          <Sub>
            {t('dash.w.hot_leads.warm', { n: nf.format(n('warm')) })} · {t('dash.w.hot_leads.week', { n: nf.format(n('qualifiedWeek')) })}
          </Sub>
        </Kpi>
      );
    case 'channel_breakdown': {
      const rows = (value as unknown as { type: string; inbound: number; conversations: number }[] | null) ?? [];
      const max = Math.max(1, ...rows.map((r) => r.conversations));
      return (
        <Kpi title={title} icon={MessagesSquare}>
          {rows.length === 0 ? (
            <Sub>{t('dash.w.channel_breakdown.none')}</Sub>
          ) : (
            <ul className="grid gap-2.5">
              {rows.map((r) => {
                const style = CHANNEL_STYLE[r.type as ChannelType];
                return (
                  <li key={r.type} className="grid gap-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="inline-flex items-center gap-2 text-foreground">
                        {style && (
                          <span className={cn('flex size-5 items-center justify-center rounded-full', style.tile)} aria-hidden>
                            <style.icon className="size-3" />
                          </span>
                        )}
                        {style?.label ?? r.type}
                      </span>
                      <span className="tabular-nums text-muted-foreground">{t('dash.w.channel_breakdown.conversations', { n: nf.format(r.conversations) })}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(r.conversations / max) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Kpi>
      );
    }
    default:
      return null;
  }
}

/** Renders one widget by id. */
export function WidgetView({ id }: { id: WidgetId }) {
  switch (id) {
    case 'tokens':
      return <CreditsCard className="h-full" />;
    case 'connected_accounts':
      return <ConnectedAccounts />;
    case 'conversations_chart':
      return <ConversationsChartWidget />;
    case 'pipeline_chart':
      return <PipelineWidget />;
    case 'response_time_chart':
      return <ResponseTimeWidget />;
    case 'activity':
      return <ActivityWidget />;
    case 'quick_actions':
      return <QuickActions />;
    case 'meta_free_replies':
      return <MetaFreeRepliesWidget />;
    default:
      return <KpiWidget id={id} />;
  }
}
