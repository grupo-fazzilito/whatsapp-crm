'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowRight, Bot, CalendarCheck, CheckCircle2, Circle, Hand, MessagesSquare } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { api } from '../api';
import { addDays, safeTimeZone, weekdayOf, zonedNow } from '@/lib/ai/time';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BOOKING_STATUSES, LoadingBlock, PageHeader } from '../shared';
import { StatusBadge } from './status-badge';

type Period = 'today' | 'week';

interface BookingLite {
  id: string;
  status: string;
  booking_date: string;
  booking_time: string;
  customer_name: string | null;
  service: { name: string } | null;
  staff: { name: string } | null;
}

interface Stats {
  bookings: BookingLite[];
  aiMessages: number;
  aiConversations: number;
  handedOver: number;
  setup: { hours: boolean; services: number; staff: number; faqs: number; agents: number };
}

/** UTC instant of 00:00 on `date` in `timeZone`. */
function zonedMidnight(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(guess))
      .map((x) => [x.type, x.value]),
  );
  const asZoned = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return new Date(guess - (asZoned - guess));
}

function periodRange(period: Period, timeZone: string) {
  const today = zonedNow(timeZone).date;
  if (period === 'today') return { from: today, to: today };
  const idx = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(weekdayOf(today));
  const from = addDays(today, -idx);
  return { from, to: addDays(from, 6) };
}

export function BusinessDashboard() {
  const t = useT();
  const { locale } = useI18n();
  const { workspace, modules, label, can } = useWorkspace();
  const [period, setPeriod] = useState<Period>('today');
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const tz = safeTimeZone(workspace?.timezone);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = periodRange(period, tz);
    const since = zonedMidnight(from, tz).toISOString();
    const until = zonedMidnight(addDays(to, 1), tz).toISOString();
    const qs = new URLSearchParams({ from, to, since, until, bookings: modules.bookings ? '1' : '0' });
    try {
      setStats(await api<Stats>(`/api/business/dashboard?${qs}`));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [period, tz, modules.bookings]);

  useEffect(() => {
    if (workspace) load();
  }, [workspace, load]);

  const bookings = stats?.bookings ?? [];
  const byStatus = Object.fromEntries(BOOKING_STATUSES.map((s) => [s, bookings.filter((b) => b.status === s).length]));
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const topServices = Object.entries(
    active.reduce<Record<string, number>>((acc, b) => {
      const n = b.service?.name;
      if (n) acc[n] = (acc[n] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxTop = topServices[0]?.[1] ?? 1;
  const now = zonedNow(tz);
  const upcoming = bookings
    .filter(
      (b) =>
        (b.status === 'pending' || b.status === 'confirmed') &&
        (b.booking_date > now.date || (b.booking_date === now.date && b.booking_time >= now.time)),
    )
    .slice(0, 6);
  const handoverRate = stats && stats.aiConversations > 0 ? Math.round((stats.handedOver / stats.aiConversations) * 100) : 0;
  const bookingPlural = label('bookingPlural');

  const fmtDay = (d: string) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

  const checklist = stats
    ? [
        { done: stats.setup.hours, label: t('business.dashboard.check.hours'), href: '/business/setup?tab=hours', show: true },
        { done: stats.setup.services > 0, label: label('servicePlural'), href: '/business/services', show: modules.services },
        { done: stats.setup.staff > 0, label: label('staffPlural'), href: '/business/staff', show: modules.staff },
        { done: stats.setup.faqs > 0, label: t('business.faqs.title'), href: '/business/faqs', show: true },
        { done: stats.setup.agents > 0, label: t('business.dashboard.check.agents'), href: '/agents', show: true },
      ].filter((c) => c.show)
    : [];
  const pending = checklist.filter((c) => !c.done);

  return (
    <div className="space-y-6">
      <PageHeader
        title={workspace?.name ?? t('business.dashboard.title')}
        description={t('business.dashboard.description')}
        actions={
          <div className="inline-flex rounded-lg bg-muted p-[3px]" role="tablist" aria-label={t('business.dashboard.period')}>
            {(['today', 'week'] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={period === p}
                onClick={() => setPeriod(p)}
                className={cn(
                  'rounded-md px-3 py-1 text-sm font-medium',
                  period === p ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
                )}
              >
                {t(`business.dashboard.${p}`)}
              </button>
            ))}
          </div>
        }
      />

      {loading && !stats ? (
        <LoadingBlock />
      ) : stats ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {modules.bookings && (
              <Kpi
                icon={<CalendarCheck className="size-4" />}
                label={bookingPlural}
                value={active.length}
                hint={t('business.dashboard.bookingsHint', { pending: byStatus.pending, confirmed: byStatus.confirmed })}
              />
            )}
            <Kpi
              icon={<MessagesSquare className="size-4" />}
              label={t('business.dashboard.aiConversations')}
              value={stats.aiConversations}
              hint={t('business.dashboard.aiMessages', { count: stats.aiMessages })}
            />
            <Kpi
              icon={<Bot className="size-4" />}
              label={t('business.dashboard.aiResolved')}
              value={Math.max(0, stats.aiConversations - stats.handedOver)}
              hint={t('business.dashboard.aiResolvedHint')}
            />
            <Kpi
              icon={<Hand className="size-4" />}
              label={t('business.dashboard.handedOver')}
              value={stats.handedOver}
              hint={t('business.dashboard.handoverRate', { rate: handoverRate })}
            />
          </div>

          {can('admin') && pending.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t('business.dashboard.checklistTitle')}</CardTitle>
                <CardDescription>{t('business.dashboard.checklistDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {checklist.map((c) => (
                  <Link
                    key={c.href}
                    href={c.href}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
                      c.done ? 'border-border text-muted-foreground' : 'border-primary/40 text-primary hover:bg-primary/5',
                    )}
                  >
                    {c.done ? <CheckCircle2 className="size-3.5" /> : <Circle className="size-3.5" />}
                    {c.label}
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          {modules.bookings && (
            <div className="grid gap-4 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle>{t('business.dashboard.byStatus', { bookings: bookingPlural })}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {BOOKING_STATUSES.map((s) => (
                    <div key={s} className="flex items-center justify-between text-sm">
                      <StatusBadge status={s} />
                      <span className="font-semibold tabular-nums text-foreground">{byStatus[s]}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('business.dashboard.topServices', { services: label('servicePlural') })}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {topServices.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('business.dashboard.noData')}</p>
                  ) : (
                    topServices.map(([name, count]) => (
                      <div key={name} className="grid gap-1">
                        <div className="flex justify-between gap-2 text-sm">
                          <span className="truncate text-foreground">{name}</span>
                          <span className="tabular-nums text-muted-foreground">{count}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted">
                          <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(count / maxTop) * 100}%` }} />
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('business.dashboard.upcoming')}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {upcoming.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t('business.dashboard.noUpcoming', { bookings: bookingPlural.toLowerCase() })}</p>
                  ) : (
                    upcoming.map((b) => (
                      <div key={b.id} className="flex items-center justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{b.customer_name || '—'}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {[b.service?.name, b.staff?.name].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {period === 'week' ? `${fmtDay(b.booking_date)} ` : ''}
                          {b.booking_time.slice(0, 5)}
                        </span>
                      </div>
                    ))
                  )}
                  <Link href="/business/bookings" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'mt-1 justify-self-start')}>
                    {t('business.dashboard.viewAll', { bookings: bookingPlural.toLowerCase() })}
                    <ArrowRight className="size-3.5" />
                  </Link>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function Kpi({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: number; hint?: string }) {
  return (
    <Card>
      <CardContent className="grid gap-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{label}</span>
          <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</span>
        </div>
        <span className="text-3xl font-bold tabular-nums text-foreground">{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  );
}
