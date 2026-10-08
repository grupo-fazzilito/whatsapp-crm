'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Bot, Camera, HousePlus, LayoutGrid, List, MapPin, Plus, Search, UserRound } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { formatMoney } from '@/lib/workspace/countries';
import { CAPTURE_STATUSES, type CaptureStatus } from '@/lib/real-estate/captures-core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, LoadingBlock, PageHeader, moneyLocale, selectClass } from '@/components/business/shared';
import { useMembers } from '@/components/crm';
import { cn } from '@/lib/utils';
import { CaptureSheet } from './capture-sheet';
import { STATUS_TONE, type CaptureListItem } from './types';

type View = 'board' | 'list';
const VIEW_KEY = 'captures:view';
const VIEW_EVENT = 'captures:view-change';
let sessionView: View | null = null;
function readView(): View {
  if (sessionView) return sessionView;
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board';
  } catch {
    return 'board';
  }
}
function subscribeView(cb: () => void) {
  window.addEventListener(VIEW_EVENT, cb);
  return () => window.removeEventListener(VIEW_EVENT, cb);
}

export function CapturesManager() {
  const t = useT();
  const { locale } = useI18n();
  const { workspace } = useWorkspace();
  const { members, meId } = useMembers();
  const view = useSyncExternalStore(subscribeView, readView, () => 'board' as View);
  const [items, setItems] = useState<CaptureListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | CaptureStatus>('');
  const [mine, setMine] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Deep link: /captures?id=<id> (notifications).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) setOpenId(id);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setQuery(queryInput.trim()), 300);
    return () => clearTimeout(id);
  }, [queryInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (query) sp.set('q', query);
      if (mine) sp.set('mine', '1');
      const res = await fetch(`/api/captures?${sp}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { captures: CaptureListItem[] };
      setItems(body.captures ?? []);
    } catch {
      toast.error(t('realestate.captures.toast.error'));
    } finally {
      setLoading(false);
    }
  }, [query, mine, t]);

  useEffect(() => {
    if (workspace) void load();
  }, [workspace, load]);

  const changeView = (v: View) => {
    sessionView = v;
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new Event(VIEW_EVENT));
  };

  const memberName = useMemo(() => new Map(members.map((m) => [m.userId, m.name])), [members]);
  const visible = status ? items.filter((c) => c.status === status) : items;
  const byStatus = useMemo(() => {
    const m = new Map<CaptureStatus, CaptureListItem[]>(CAPTURE_STATUSES.map((s) => [s, []]));
    for (const c of items) m.get(c.status)?.push(c);
    return m;
  }, [items]);

  const typeLabel = (v: string) => {
    const map: Record<string, Record<'es' | 'en', string>> = {
      house: { es: 'Casa', en: 'House' },
      apartment: { es: 'Departamento', en: 'Apartment' },
      land: { es: 'Terreno', en: 'Land' },
      office: { es: 'Oficina', en: 'Office' },
      commercial: { es: 'Local comercial', en: 'Retail' },
    };
    return map[v]?.[locale] ?? v;
  };
  const owner = (c: CaptureListItem) => c.owner_name || c.contact?.name || t('realestate.captures.noOwner');
  const summary = (c: CaptureListItem) =>
    [c.operation ? t(`realestate.captures.operation.${c.operation}`) : null, c.property_type ? typeLabel(c.property_type) : null]
      .filter(Boolean)
      .join(' · ');
  const price = (c: CaptureListItem) =>
    c.expected_price != null
      ? formatMoney(Number(c.expected_price), c.currency || workspace?.currency || 'PEN', moneyLocale(locale, workspace?.country))
      : null;
  const age = (iso: string) => new Date(iso).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-PE', { day: 'numeric', month: 'short' });

  const statusChip = (s: CaptureStatus) => (
    <span className={cn('inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold', STATUS_TONE[s])}>{t(`realestate.captures.status.${s}`)}</span>
  );

  const card = (c: CaptureListItem) => (
    <li key={c.id}>
      <button
        type="button"
        onClick={() => setOpenId(c.id)}
        className="grid w-full gap-2 rounded-lg border border-border bg-card p-3 text-left shadow-sm transition hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {c.cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.cover} alt="" loading="lazy" className="aspect-[16/9] w-full rounded-md object-cover" />
        )}
        <span className="flex items-start justify-between gap-2">
          <span className="font-medium text-foreground">{owner(c)}</span>
          {c.source === 'ai' && (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1 text-[10px] font-medium text-muted-foreground">
              <Bot className="size-3" aria-hidden />
              {t('realestate.captures.source.ai')}
            </span>
          )}
        </span>
        {summary(c) && <span className="text-xs text-muted-foreground">{summary(c)}</span>}
        {c.district && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="size-3" aria-hidden />
            {c.district}
          </span>
        )}
        <span className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-foreground">{price(c) ?? ''}</span>
          <span className="flex items-center gap-2 text-muted-foreground">
            {c.photos.length > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Camera className="size-3" aria-hidden />
                <span className="sr-only">{t('realestate.captures.photosCount', { count: c.photos.length })}</span>
                <span aria-hidden>{c.photos.length}</span>
              </span>
            )}
            <span className="inline-flex items-center gap-0.5">
              <UserRound className="size-3" aria-hidden />
              {c.assigned_user_id ? (memberName.get(c.assigned_user_id) ?? '—') : t('realestate.captures.unassigned')}
            </span>
          </span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('realestate.captures.title')}
        description={t('realestate.captures.description')}
        actions={
          <Button onClick={() => setOpenId('new')}>
            <Plus className="size-4" aria-hidden />
            {t('realestate.captures.new')}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            className="pl-8"
            type="search"
            placeholder={t('realestate.captures.search')}
            aria-label={t('realestate.captures.search')}
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
          />
        </div>
        {view === 'list' && (
          <select
            className={cn(selectClass, 'w-auto')}
            aria-label={t('realestate.captures.field.status')}
            value={status}
            onChange={(e) => setStatus(e.target.value as '' | CaptureStatus)}
          >
            <option value="">{t('realestate.captures.allStatuses')}</option>
            {CAPTURE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`realestate.captures.status.${s}`)}
              </option>
            ))}
          </select>
        )}
        {meId && (
          <Button variant={mine ? 'default' : 'outline'} aria-pressed={mine} onClick={() => setMine((v) => !v)} className="h-9">
            {t('realestate.captures.mine')}
          </Button>
        )}
        <div className="ml-auto flex rounded-lg border border-border p-0.5" role="group" aria-label={t('realestate.captures.view.label')}>
          <Button variant={view === 'board' ? 'secondary' : 'ghost'} size="icon-sm" aria-pressed={view === 'board'} aria-label={t('realestate.captures.view.board')} onClick={() => changeView('board')}>
            <LayoutGrid className="size-4" aria-hidden />
          </Button>
          <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="icon-sm" aria-pressed={view === 'list'} aria-label={t('realestate.captures.view.list')} onClick={() => changeView('list')}>
            <List className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <LoadingBlock />
      ) : items.length === 0 && !query && !mine ? (
        <EmptyState
          icon={<HousePlus className="size-6" />}
          title={t('realestate.captures.empty')}
          description={t('realestate.captures.emptyDescription')}
          action={
            <Button onClick={() => setOpenId('new')}>
              <Plus className="size-4" aria-hidden />
              {t('realestate.captures.new')}
            </Button>
          }
        />
      ) : view === 'board' ? (
        <div className={cn('-mx-1 flex gap-3 overflow-x-auto px-1 pb-2', loading && 'opacity-60')} aria-busy={loading}>
          {CAPTURE_STATUSES.map((s) => {
            const list = byStatus.get(s) ?? [];
            return (
              <section key={s} aria-labelledby={`cap-col-${s}`} className="flex w-72 shrink-0 flex-col gap-2 rounded-xl border border-border bg-muted/30 p-2">
                <h2 id={`cap-col-${s}`} className="flex items-center justify-between gap-2 px-1 text-sm font-semibold text-foreground">
                  {statusChip(s)}
                  <span className="tabular-nums text-xs text-muted-foreground">{list.length}</span>
                </h2>
                {list.length === 0 ? (
                  <p className="px-1 py-4 text-center text-xs text-muted-foreground">{t('realestate.captures.columnEmpty')}</p>
                ) : (
                  <ul className="grid gap-2">{list.map(card)}</ul>
                )}
              </section>
            );
          })}
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">{t('realestate.captures.noResults')}</p>
      ) : (
        <div className={cn('overflow-x-auto rounded-xl border border-border', loading && 'opacity-60')} aria-busy={loading}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('realestate.captures.field.owner')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('realestate.captures.field.propertyType')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('realestate.captures.field.district')}</TableHead>
                <TableHead>{t('realestate.captures.field.expectedPrice')}</TableHead>
                <TableHead>{t('realestate.captures.field.status')}</TableHead>
                <TableHead className="hidden lg:table-cell">{t('realestate.captures.field.assigned')}</TableHead>
                <TableHead className="hidden lg:table-cell">{t('realestate.captures.field.created')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="max-w-56 whitespace-normal">
                    <button type="button" onClick={() => setOpenId(c.id)} className="text-left font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {owner(c)}
                    </button>
                    {c.source === 'ai' && <span className="ml-1.5 text-[10px] text-muted-foreground">{t('realestate.captures.source.ai')}</span>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{summary(c) || '—'}</TableCell>
                  <TableCell className="hidden sm:table-cell">{c.district || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{price(c) ?? '—'}</TableCell>
                  <TableCell>{statusChip(c.status)}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {c.assigned_user_id ? (memberName.get(c.assigned_user_id) ?? '—') : t('realestate.captures.unassigned')}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap lg:table-cell">{age(c.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {openId && (
        <CaptureSheet
          key={openId}
          captureId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}
