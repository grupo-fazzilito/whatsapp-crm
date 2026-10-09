'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Check, LayoutGrid, Loader2, Plus, RotateCcw, X } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { KPI_WIDGETS, WIDGETS, WIDGET_IDS, widgetAvailable, type WidgetCategory, type WidgetId } from '@/lib/dashboard/widgets';
import { KpiContext, WidgetView } from './widget-views';
import { SetupProgress } from './setup-progress';

const SPAN: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'col-span-1',
  md: 'col-span-1 sm:col-span-2',
  lg: 'col-span-1 sm:col-span-2 xl:col-span-4',
};
const CATEGORIES: WidgetCategory[] = ['account', 'attention', 'sales', 'ai', 'team'];

/** Customizable dashboard: the user's widgets, edit mode and the catalog. */
export function DashboardGrid() {
  const { t } = useI18n();
  const { workspace, can, modules } = useWorkspace();
  const [layout, setLayout] = useState<WidgetId[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [catalog, setCatalog] = useState(false);
  const [saving, setSaving] = useState(false);
  // KPI data keyed by the set of widgets it was fetched for.
  const [kpiResult, setKpiResult] = useState<{ key: string; data: Partial<Record<WidgetId, unknown>> } | null>(null);
  const [setupShowing, setSetupShowing] = useState(false);

  const ctx = useMemo(
    () => ({ isAdmin: can('admin'), modules: { bookings: modules.bookings, orders: modules.orders }, industry: workspace?.industry }),
    [can, modules.bookings, modules.orders, workspace?.industry],
  );

  useEffect(() => {
    if (!workspace) return;
    let alive = true;
    fetch('/api/dashboard/layout', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { widgets: WidgetId[] } | null) => alive && setLayout(d?.widgets ?? []))
      .catch(() => alive && setLayout([]));
    return () => {
      alive = false;
    };
  }, [workspace]);

  // While the getting-started checklist shows, "Connected accounts" is redundant.
  const visible = useMemo(() => (layout ?? []).filter((id) => !(setupShowing && id === 'connected_accounts' && !editing)), [layout, setupShowing, editing]);
  const kpiKey = visible.filter((id) => KPI_WIDGETS.includes(id)).sort().join(',');

  useEffect(() => {
    if (!workspace || !kpiKey) return;
    const qs = new URLSearchParams({ ids: kpiKey, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    fetch(`/api/dashboard/widgets?${qs}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { data?: Partial<Record<WidgetId, unknown>> } | null) => setKpiResult({ key: kpiKey, data: d?.data ?? {} }))
      .catch(() => setKpiResult({ key: kpiKey, data: {} }));
  }, [workspace, kpiKey]);
  const kpis = useMemo(
    () => (kpiResult?.key === kpiKey ? { data: kpiResult.data, loading: false } : { data: kpiResult?.data ?? null, loading: !!kpiKey }),
    [kpiResult, kpiKey],
  );

  const persist = useCallback(
    async (widgets: WidgetId[] | null) => {
      setSaving(true);
      const res = await fetch('/api/dashboard/layout', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ widgets }) }).catch(() => null);
      setSaving(false);
      if (!res?.ok) {
        toast.error(t('common.error'));
        return;
      }
      const d = (await res.json()) as { widgets: WidgetId[] };
      setLayout(d.widgets);
    },
    [t],
  );

  const move = (id: WidgetId, dir: -1 | 1) =>
    setLayout((l) => {
      if (!l) return l;
      const i = l.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= l.length) return l;
      const next = [...l];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (id: WidgetId) => setLayout((l) => (l ? l.filter((x) => x !== id) : l));
  const add = (id: WidgetId) => setLayout((l) => (l && !l.includes(id) ? [...l, id] : l));

  const finish = async () => {
    await persist(layout ?? []);
    setEditing(false);
    toast.success(t('dash.saved'));
  };

  const available = WIDGET_IDS.filter((id) => widgetAvailable(id, ctx));
  const missing = available.filter((id) => !(layout ?? []).includes(id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('dash.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{editing ? t('dash.editHint') : t('dash.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button variant="outline" onClick={() => setCatalog(true)}>
                <Plus className="size-4" aria-hidden /> {t('dash.add')}
              </Button>
              <Button variant="ghost" onClick={() => void persist(null)} disabled={saving}>
                <RotateCcw className="size-4" aria-hidden /> {t('dash.reset')}
              </Button>
              <Button onClick={finish} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />} {t('dash.done')}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <LayoutGrid className="size-4" aria-hidden /> {t('dash.customize')}
            </Button>
          )}
        </div>
      </div>

      <SetupProgress onState={setSetupShowing} />

      {layout === null ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl border border-border bg-card" aria-hidden />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">{t('dash.empty')}</p>
      ) : (
        <KpiContext.Provider value={kpis}>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('dash.title')}>
            {visible.map((id, i) => (
              <li key={id} className={cn('relative min-w-0', SPAN[WIDGETS[id].size], editing && 'rounded-xl ring-2 ring-dashed ring-primary/40 ring-offset-2 ring-offset-background')}>
                <WidgetView id={id} />
                {editing && (
                  <div className="absolute right-2 top-2 z-10 flex gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-sm">
                    <span className="sr-only">{t(`dash.w.${id}.title`)}</span>
                    <button type="button" onClick={() => move(id, -1)} disabled={i === 0} aria-label={`${t('dash.moveUp')}: ${t(`dash.w.${id}.title`)}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <ArrowUp className="size-4" aria-hidden />
                    </button>
                    <button type="button" onClick={() => move(id, 1)} disabled={i === visible.length - 1} aria-label={`${t('dash.moveDown')}: ${t(`dash.w.${id}.title`)}`} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <ArrowDown className="size-4" aria-hidden />
                    </button>
                    <button type="button" onClick={() => remove(id)} aria-label={`${t('dash.remove')}: ${t(`dash.w.${id}.title`)}`} className="rounded p-1 text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                )}
              </li>
            ))}
            {editing && (
              <li className="col-span-1">
                <button type="button" onClick={() => setCatalog(true)} className="flex h-full min-h-36 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Plus className="size-5" aria-hidden /> {t('dash.add')}
                </button>
              </li>
            )}
          </ul>
        </KpiContext.Provider>
      )}

      <Sheet open={catalog} onOpenChange={setCatalog}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t('dash.catalogTitle')}</SheetTitle>
            <SheetDescription>{t('dash.catalogDescription')}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-5 px-4 pb-6">
            {missing.length === 0 && <p className="text-sm text-muted-foreground">{t('dash.allAdded')}</p>}
            {CATEGORIES.map((cat) => {
              const items = available.filter((id) => WIDGETS[id].category === cat);
              if (!items.length) return null;
              return (
                <section key={cat} aria-labelledby={`cat-${cat}`}>
                  <h3 id={`cat-${cat}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t(`dash.category.${cat}`)}
                  </h3>
                  <ul className="grid gap-2">
                    {items.map((id) => {
                      const on = (layout ?? []).includes(id);
                      return (
                        <li key={id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{t(`dash.w.${id}.title`)}</p>
                            <p className="text-xs text-muted-foreground">{t(`dash.w.${id}.desc`)}</p>
                          </div>
                          {on ? (
                            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                              <Check className="size-3.5" aria-hidden /> {t('dash.added')}
                            </span>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => add(id)} className="shrink-0">
                              <Plus className="size-3.5" aria-hidden /> {t('dash.add')}
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
