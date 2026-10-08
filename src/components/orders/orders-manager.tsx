'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Bell, BellOff, ChevronRight, Columns3, List, Loader2, Plus, Search, ShoppingBag, X } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, moneyLocale } from '@/lib/workspace/countries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, LoadingBlock, Notice, PageHeader, selectClass } from '@/components/business/shared';
import { cn } from '@/lib/utils';
import { PaymentChip, StatusChip } from './chips';
import { OrderDetailSheet } from './order-detail-sheet';
import { NewOrderDialog } from './new-order-dialog';
import { usePendingOrders } from './use-pending-orders';
import {
  BOARD_STATUSES,
  ORDER_LIST_SELECT,
  ORDER_STATUSES,
  PAYMENT_FILTERS,
  PAYMENT_FILTER_STATUSES,
  nextActions,
  orderErrorMessage,
  type OrderRow,
  type OrderStatus,
  type PaymentFilter,
} from './types';

type View = 'list' | 'board';
type StatusTab = 'all' | OrderStatus;
const LIMIT = 200;
const VIEW_KEY = 'orders:view';
const SOUND_KEY = 'orders:sound';

function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

/** Short two-tone chime (WebAudio, no asset). */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const at = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.start(at);
      osc.stop(at + 0.17);
    });
    setTimeout(() => ctx.close().catch(() => undefined), 800);
  } catch {
    /* autoplay blocked */
  }
}

/** PostgREST `or` values can't carry these characters unescaped. */
const cleanSearch = (s: string) => s.replace(/[,()*%\\]/g, ' ').trim();

export function OrdersManager() {
  const { t, locale } = useI18n();
  const { workspace, modules } = useWorkspace();
  const pendingCount = usePendingOrders();
  const workspaceId = workspace?.id;

  const [view, setView] = useState<View>('list');
  const [sound, setSound] = useState(false);
  useEffect(() => {
    // Per-browser preferences, read after mount (no SSR mismatch).
     
    setView(readPref(VIEW_KEY) === 'board' ? 'board' : 'list');
    setSound(readPref(SOUND_KEY) === '1');
  }, []);

  const [status, setStatus] = useState<StatusTab>('all');
  const [payment, setPayment] = useState<PaymentFilter>('all');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  // Deep link: /orders?order=<id>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('order');
     
    if (id) setSelected(id);
  }, []);

  const openOrder = useCallback((id: string | null) => {
    setSelected(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('order', id);
    else url.searchParams.delete('order');
    window.history.replaceState(null, '', url);
  }, []);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    let q = createClient().from('orders').select(ORDER_LIST_SELECT).eq('workspace_id', workspaceId);
    if (view === 'list' && status !== 'all') q = q.eq('status', status);
    if (view === 'board') q = q.neq('status', 'cancelled');
    if (payment !== 'all') q = q.in('payment_status', PAYMENT_FILTER_STATUSES[payment]);
    const s = cleanSearch(debounced);
    if (s) {
      const num = s.replace(/^#/, '');
      if (/^\d+$/.test(num) && num.length < 10) q = q.or(`number.eq.${num},customer_phone.ilike.%${num}%`);
      else q = q.or(`customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%`);
    }
    if (from) q = q.gte('created_at', new Date(`${from}T00:00:00`).toISOString());
    if (to) q = q.lte('created_at', new Date(`${to}T23:59:59.999`).toISOString());
    const { data, error } = await q.order('created_at', { ascending: false }).limit(LIMIT);
    if (error) {
      toast.error(error.message);
      setOrders([]);
      return;
    }
    setOrders((data ?? []) as unknown as OrderRow[]);
    setTruncated((data?.length ?? 0) >= LIMIT);
  }, [workspaceId, view, status, payment, debounced, from, to]);

  useEffect(() => {
     
    load();
  }, [load]);

  // Realtime: refetch on any change; announce new pending orders.
  const loadRef = useRef(load);
  const soundRef = useRef(sound);
  const selectedRef = useRef(selected);
  useEffect(() => {
    loadRef.current = load;
    soundRef.current = sound;
    selectedRef.current = selected;
  });
  useEffect(() => {
    if (!workspaceId) return;
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`orders-page:${workspaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `workspace_id=eq.${workspaceId}` }, (payload) => {
        const row = payload.new as Partial<OrderRow> | null;
        if (payload.eventType === 'INSERT' && row?.id && row.status === 'pending') {
          const id = row.id;
          toast(t('orders.toast.new', { number: row.number ?? '' }), {
            description: row.customer_name ?? undefined,
            action: { label: t('orders.toast.view'), onClick: () => openOrder(id) },
          });
          if (soundRef.current) chime();
          setFresh((prev) => new Set(prev).add(id));
          setTimeout(() => setFresh((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          }), 8000);
        }
        if (row?.id && row.id === selectedRef.current) setRefreshKey((k) => k + 1);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => loadRef.current(), 300);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [workspaceId, t, openOrder]);

  const money = useCallback(
    (o: OrderRow) => formatMoney(Number(o.total), o.currency, moneyLocale({ locale, country: workspace?.country })),
    [locale, workspace?.country],
  );
  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: workspace?.timezone || undefined }),
    [locale, workspace?.timezone],
  );

  const quickMove = async (o: OrderRow, next: OrderStatus) => {
    setBusyId(o.id);
    try {
      const res = await fetch(`/api/orders/${o.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast.error(orderErrorMessage(t, data.error));
      else toast.success(t('orders.toast.moved', { status: t(`orders.status.${next}`) }));
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const toggleView = (v: View) => {
    setView(v);
    writePref(VIEW_KEY, v);
  };
  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    writePref(SOUND_KEY, next ? '1' : '0');
    if (next) chime();
  };

  const hasFilters = status !== 'all' || payment !== 'all' || !!query || !!from || !!to;
  const clearFilters = () => {
    setStatus('all');
    setPayment('all');
    setQuery('');
    setFrom('');
    setTo('');
  };

  if (workspace && !modules.orders) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('orders.title')} />
        <Notice>{t('orders.moduleOff')}</Notice>
      </div>
    );
  }

  const customerOf = (o: OrderRow) => o.customer_name || o.contact?.name || o.customer_phone || t('orders.detail.noName');

  const quickAction = (o: OrderRow) => {
    const next = nextActions(o.status, o.fulfillment)[0];
    if (!next) return null;
    return (
      <Button
        size="sm"
        variant={o.status === 'pending' ? 'default' : 'outline'}
        disabled={busyId === o.id}
        onClick={(e) => {
          e.stopPropagation();
          quickMove(o, next.status);
        }}
      >
        {busyId === o.id && <Loader2 className="size-3.5 animate-spin" />}
        {t(`orders.actions.${next.key}`)}
      </Button>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('orders.title')}
        description={t('orders.description')}
        actions={
          <>
            <div role="group" aria-label={t('orders.view.label')} className="inline-flex rounded-lg border border-border p-0.5">
              {(['list', 'board'] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => toggleView(v)}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm',
                    view === v ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {v === 'list' ? <List className="size-4" /> : <Columns3 className="size-4" />}
                  {t(`orders.view.${v}`)}
                </button>
              ))}
            </div>
            <Button variant="outline" size="lg" onClick={toggleSound} aria-pressed={sound} title={t('orders.sound.hint')}>
              {sound ? <Bell className="size-4" /> : <BellOff className="size-4" />}
              {sound ? t('orders.sound.on') : t('orders.sound.off')}
            </Button>
            <Button size="lg" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              {t('orders.new.button')}
            </Button>
          </>
        }
      />

      {/* Status tabs (list view only; the board shows every active status). */}
      {view === 'list' && (
        <div role="tablist" aria-label={t('orders.filters.status')} className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {(['all', ...ORDER_STATUSES] as StatusTab[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
              className={cn(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
                status === s ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`orders.tabs.${s}`)}
              {s === 'pending' && pendingCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">{pendingCount}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('orders.filters.search')}
            aria-label={t('orders.filters.search')}
            className="h-9 pl-8"
          />
        </div>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t('orders.filters.payment')}
          <select className={cn(selectClass, 'sm:w-44')} value={payment} onChange={(e) => setPayment(e.target.value as PaymentFilter)}>
            {PAYMENT_FILTERS.map((p) => (
              <option key={p} value={p}>
                {t(`orders.paymentFilter.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t('orders.filters.from')}
          <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9" />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t('orders.filters.to')}
          <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9" />
        </label>
      </div>
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          <X className="size-3.5" />
          {t('orders.filters.clear')}
        </Button>
      )}

      {orders === null ? (
        <LoadingBlock />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="size-5" />}
          title={hasFilters ? t('orders.empty.filteredTitle') : t('orders.empty.title')}
          description={hasFilters ? undefined : t('orders.empty.description')}
        />
      ) : view === 'list' ? (
        <>
          {/* Cards on mobile */}
          <ul className="grid gap-2 md:hidden">
            {orders.map((o) => (
              <li key={o.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => openOrder(o.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openOrder(o.id);
                    }
                  }}
                  className={cn(
                    'grid gap-2 rounded-xl border border-border bg-card p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    fresh.has(o.id) && 'ring-2 ring-primary motion-safe:animate-pulse',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">#{o.number}</span>
                    <span className="font-semibold tabular-nums">{money(o)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{customerOf(o)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{dateFmt.format(new Date(o.created_at))}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusChip status={o.status} />
                    <PaymentChip status={o.payment_status} />
                    <span className="text-xs text-muted-foreground">{t(`orders.fulfillment.${o.fulfillment}`)}</span>
                    <span className="ml-auto">
                      {quickAction(o)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {/* Table on md+ */}
          <div className="hidden overflow-hidden rounded-xl border border-border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('orders.columns.number')}</TableHead>
                  <TableHead>{t('orders.columns.customer')}</TableHead>
                  <TableHead>{t('orders.columns.date')}</TableHead>
                  <TableHead>{t('orders.columns.fulfillment')}</TableHead>
                  <TableHead className="text-right">{t('orders.columns.total')}</TableHead>
                  <TableHead>{t('orders.columns.status')}</TableHead>
                  <TableHead>{t('orders.columns.payment')}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t('orders.columns.actions')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow
                    key={o.id}
                    onClick={() => openOrder(o.id)}
                    className={cn('cursor-pointer', fresh.has(o.id) && 'bg-primary/5 motion-safe:animate-pulse')}
                  >
                    <TableCell className="font-semibold">
                      <button
                        type="button"
                        className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={(e) => {
                          e.stopPropagation();
                          openOrder(o.id);
                        }}
                        aria-label={t('orders.detail.heading', { number: o.number })}
                      >
                        #{o.number}
                      </button>
                    </TableCell>
                    <TableCell className="max-w-48 truncate">{customerOf(o)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{dateFmt.format(new Date(o.created_at))}</TableCell>
                    <TableCell className="whitespace-nowrap">{t(`orders.fulfillment.${o.fulfillment}`)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(o)}</TableCell>
                    <TableCell>
                      <StatusChip status={o.status} />
                    </TableCell>
                    <TableCell>
                      <PaymentChip status={o.payment_status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {quickAction(o)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {truncated && <p className="text-xs text-muted-foreground">{t('orders.truncated', { limit: LIMIT })}</p>}
        </>
      ) : (
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
          {BOARD_STATUSES.map((s) => {
            const col = orders.filter((o) => o.status === s);
            return (
              <section key={s} aria-label={t(`orders.status.${s}`)} className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/40 p-2">
                <header className="flex items-center justify-between px-1">
                  <StatusChip status={s} />
                  <span className="text-xs text-muted-foreground tabular-nums">{col.length}</span>
                </header>
                {col.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">{t('orders.board.empty')}</p>}
                {col.map((o) => (
                  <article
                    key={o.id}
                    className={cn(
                      'grid gap-2 rounded-lg border border-border bg-card p-3 shadow-xs',
                      fresh.has(o.id) && 'ring-2 ring-primary motion-safe:animate-pulse',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openOrder(o.id)}
                      className="grid gap-1 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold">#{o.number}</span>
                        <span className="text-sm font-semibold tabular-nums">{money(o)}</span>
                      </span>
                      <span className="truncate text-sm">{customerOf(o)}</span>
                      <span className="text-xs text-muted-foreground">
                        {dateFmt.format(new Date(o.created_at))} · {t(`orders.fulfillment.${o.fulfillment}`)}
                      </span>
                    </button>
                    <div className="flex items-center justify-between gap-2">
                      <PaymentChip status={o.payment_status} />
                      <span className="flex items-center gap-1">
                        {quickAction(o)}
                        <Button size="icon-sm" variant="ghost" aria-label={t('orders.detail.heading', { number: o.number })} onClick={() => openOrder(o.id)}>
                          <ChevronRight className="size-4" />
                        </Button>
                      </span>
                    </div>
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}

      <OrderDetailSheet
        orderId={selected}
        refreshKey={refreshKey}
        onOpenChange={(open) => !open && openOrder(null)}
        onChanged={load}
      />
      {creating && (
        <NewOrderDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(id) => {
            setCreating(false);
            load();
            openOrder(id);
          }}
        />
      )}
    </div>
  );
}
