'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { CheckCircle2, Clock, Download, ExternalLink, Link2, Loader2, Pencil, Play, Plus, Rss, ShieldCheck, Trash2, Unplug, XCircle } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button, buttonVariants } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { LoadingBlock, Notice, PageHeader } from '@/components/business/shared';
import { cn } from '@/lib/utils';
import { FeedDialog } from './feed-dialog';
import { FileImport } from './file-import';
import { apiErrorText } from './errors';
import type { Feed, Overview, Run } from './types';

function useDate() {
  const { locale } = useI18n();
  return (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale === 'en' ? 'en-US' : 'es-PE', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
}

function Section({ id, title, icon, children, actions }: { id: string; title: string; icon: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-xl border bg-card p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 id={id} className="flex flex-1 items-center gap-2 text-base font-semibold">
          {icon} {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function RunLine({ run }: { run: Run | undefined }) {
  const t = useT();
  const date = useDate();
  if (!run) return <p className="text-sm text-muted-foreground">{t('portals.runs.never')}</p>;
  if (run.status === 'running') return <p className="text-sm text-muted-foreground">{t('portals.runs.running')}</p>;
  return (
    <div className="space-y-1 text-sm">
      <p className="flex flex-wrap items-center gap-1.5">
        {run.status === 'error' ? <XCircle className="size-4 text-red-600" aria-hidden /> : <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />}
        <span className="font-medium">{t(`portals.runs.status.${run.status}`)}</span>
        <span className="text-muted-foreground">· {date(run.finished_at ?? run.started_at)}</span>
      </p>
      {run.error ? (
        <p className="text-red-700 dark:text-red-300">{apiErrorText(t, run.error)}</p>
      ) : (
        <p className="text-muted-foreground">
          {t('portals.runs.summary', { total: run.total, created: run.created, updated: run.updated, deactivated: run.deactivated, failed: run.failed })}
          {run.notes?.foreign_currency ? ` · ${t('portals.runs.foreign', { count: run.notes.foreign_currency })}` : ''}
          {run.notes?.deactivation_skipped ? ` · ${t('portals.runs.deactivationSkipped')}` : ''}
        </p>
      )}
    </div>
  );
}

export function PortalsManager() {
  const t = useT();
  const date = useDate();
  const { workspace, can, label } = useWorkspace();
  const [data, setData] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedDialog, setFeedDialog] = useState<{ open: boolean; feed: Feed | null; n: number }>({ open: false, feed: null, n: 0 });
  const [confirm, setConfirm] = useState<{ kind: 'disconnect' } | { kind: 'feed'; feed: Feed } | null>(null);

  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    fetch('/api/real-estate/portals', { cache: 'no-store' }).then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) setLoadError(String(body.error ?? res.status));
      else setData(body as Overview);
    });
    return () => {
      cancelled = true;
    };
  }, [workspace, version]);

  // Result of the Mercado Libre OAuth round trip (?ml=connected|denied|...).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ml = params.get('ml');
    if (!ml) return;
    if (ml === 'connected') toast.success(t('portals.ml.connectedToast'));
    else toast.error(apiErrorText(t, `ml_${ml}`));
    params.delete('ml');
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
  }, [t]);

  const afterRun = (res: Response, body: { error?: string; summary?: { created: number; updated: number; deactivated: number; failed: number } }) => {
    if (res.status === 409) toast.error(t('portals.apiErrors.busy'));
    else if (!res.ok || body.error || !body.summary) toast.error(apiErrorText(t, body.error));
    else toast.success(t('portals.runs.toast', body.summary));
  };

  const importMl = async () => {
    setBusy('ml');
    const res = await fetch('/api/real-estate/portals/mercadolibre/import', { method: 'POST' });
    afterRun(res, await res.json().catch(() => ({})));
    setBusy(null);
    load();
  };

  const runFeed = async (feed: Feed) => {
    setBusy(feed.id);
    const res = await fetch(`/api/real-estate/portals/feeds/${feed.id}/run`, { method: 'POST' });
    afterRun(res, await res.json().catch(() => ({})));
    setBusy(null);
    load();
  };

  const toggleAuto = async (value: boolean) => {
    const res = await fetch('/api/real-estate/portals/mercadolibre', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ auto_import: value }) });
    if (!res.ok) toast.error(t('common.error'));
    load();
  };

  const doConfirm = async () => {
    if (!confirm) return;
    const res =
      confirm.kind === 'disconnect'
        ? await fetch('/api/real-estate/portals/mercadolibre', { method: 'DELETE' })
        : await fetch(`/api/real-estate/portals/feeds/${confirm.feed.id}`, { method: 'DELETE' });
    if (!res.ok) toast.error(t('common.error'));
    setConfirm(null);
    load();
  };

  if (workspace && (workspace.industry !== 'real_estate' || !can('admin'))) {
    return <Notice>{t('portals.onlyAdmins')}</Notice>;
  }
  if (loadError) return <Notice>{apiErrorText(t, loadError)}</Notice>;
  if (!data) return <LoadingBlock />;

  const ml = data.mercadolibre;
  const mlRun = data.runs.find((r) => r.source === 'mercadolibre');
  const fileRun = data.runs.find((r) => r.source === 'file');

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('portals.title')}
        description={t('portals.subtitle')}
        actions={
          <Link href="/catalog" className={buttonVariants({ variant: 'outline' })}>
            {t('portals.backToCatalog', { items: label('productPlural') })}
          </Link>
        }
      />

      <Notice className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
        <span>{t('portals.ownDataNotice')}</span>
      </Notice>

      <p className="text-sm text-muted-foreground">{t('portals.importedCount', { count: data.imported, items: label('productPlural').toLowerCase() })}</p>

      {/* Mercado Libre */}
      <Section id="portals-ml" title={t('portals.ml.title')} icon={<Link2 className="size-4 text-emerald-600" aria-hidden />}>
        <p className="mb-3 text-sm text-muted-foreground">{t('portals.ml.description')}</p>
        {!ml.available ? (
          <Notice>{t('portals.ml.notAvailable')}</Notice>
        ) : !ml.connection ? (
          <a href="/api/real-estate/portals/mercadolibre/connect" className={cn(buttonVariants(), 'gap-2')}>
            <Link2 className="size-4" aria-hidden /> {t('portals.ml.connect')}
          </a>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', ml.connection.status === 'active' ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300' : 'border-red-500/40 text-red-700 dark:text-red-300')}>
                {t(`portals.ml.status.${ml.connection.status}`)}
              </span>
              <span>{t('portals.ml.account', { name: ml.connection.nickname ?? ml.connection.user_id })}</span>
              <span className="text-muted-foreground">· {t('portals.ml.since', { date: date(ml.connection.connected_at) })}</span>
            </div>
            {ml.connection.status !== 'active' && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                {apiErrorText(t, ml.connection.last_error ?? 'reconnect')}{' '}
                <a className="underline" href="/api/real-estate/portals/mercadolibre/connect">{t('portals.ml.reconnect')}</a>
              </p>
            )}
            <RunLine run={mlRun} />
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={importMl} disabled={busy === 'ml'}>
                {busy === 'ml' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
                {busy === 'ml' ? t('portals.importing') : t('portals.ml.importNow')}
              </Button>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={ml.connection.auto_import} onCheckedChange={(v: boolean) => toggleAuto(v)} aria-label={t('portals.ml.autoImport')} />
                {t('portals.ml.autoImport')}
              </label>
              <Button variant="ghost" className="text-red-700 dark:text-red-300" onClick={() => setConfirm({ kind: 'disconnect' })}>
                <Unplug className="size-4" aria-hidden /> {t('portals.ml.disconnect')}
              </Button>
            </div>
          </div>
        )}
      </Section>

      {/* Feeds */}
      <Section
        id="portals-feeds"
        title={t('portals.feeds.title')}
        icon={<Rss className="size-4 text-emerald-600" aria-hidden />}
        actions={
          <Button onClick={() => setFeedDialog((d) => ({ open: true, feed: null, n: d.n + 1 }))}>
            <Plus className="size-4" aria-hidden /> {t('portals.feeds.add')}
          </Button>
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">{t('portals.feeds.description')}</p>
        {data.feeds.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('portals.feeds.empty')}</p>
        ) : (
          <ul className="space-y-3">
            {data.feeds.map((f) => (
              <li key={f.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{f.name}</span>
                  <span className="rounded-full border px-2 py-0.5 text-xs">{t(`portals.portalNames.${f.portal}`)}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" aria-hidden /> {f.schedule === 'daily' ? t('portals.feeds.daily') : t('portals.feeds.manual')}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => runFeed(f)} disabled={busy === f.id}>
                      {busy === f.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
                      {t('portals.feeds.runNow')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setFeedDialog((d) => ({ open: true, feed: f, n: d.n + 1 }))} aria-label={t('portals.feeds.editNamed', { name: f.name })}>
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: 'feed', feed: f })} aria-label={t('portals.feeds.deleteNamed', { name: f.name })}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground underline-offset-2 hover:underline">
                  <span className="truncate">{f.url}</span> <ExternalLink className="size-3 shrink-0" aria-hidden />
                </a>
                <div className="mt-2">
                  <RunLine run={data.runs.find((r) => r.feed_id === f.id)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* File */}
      <Section id="portals-file" title={t('portals.file.title')} icon={<Download className="size-4 text-emerald-600" aria-hidden />}>
        <p className="mb-3 text-sm text-muted-foreground">{t('portals.file.description')}</p>
        {fileRun && (
          <div className="mb-3">
            <RunLine run={fileRun} />
          </div>
        )}
        <FileImport onImported={load} />
      </Section>

      {/* History */}
      <Section id="portals-history" title={t('portals.runs.title')} icon={<Clock className="size-4 text-emerald-600" aria-hidden />}>
        {data.runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('portals.runs.never')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('portals.runs.title')}</caption>
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-3">{t('portals.runs.when')}</th>
                  <th scope="col" className="py-2 pr-3">{t('portals.runs.source')}</th>
                  <th scope="col" className="py-2 pr-3">{t('portals.runs.result')}</th>
                  <th scope="col" className="py-2 pr-3 text-right">{t('portals.runs.created')}</th>
                  <th scope="col" className="py-2 pr-3 text-right">{t('portals.runs.updated')}</th>
                  <th scope="col" className="py-2 pr-3 text-right">{t('portals.runs.deactivated')}</th>
                  <th scope="col" className="py-2 text-right">{t('portals.runs.failed')}</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{date(r.started_at)}</td>
                    <td className="py-2 pr-3">
                      {r.source === 'feed' ? data.feeds.find((f) => f.id === r.feed_id)?.name ?? t('portals.runs.sources.feed') : t(`portals.runs.sources.${r.source}`)}
                      {r.trigger === 'schedule' && <span className="ml-1 text-xs text-muted-foreground">({t('portals.runs.scheduled')})</span>}
                    </td>
                    <td className="py-2 pr-3">
                      {t(`portals.runs.status.${r.status}`)}
                      {r.error && <span className="block text-xs text-red-700 dark:text-red-300">{apiErrorText(t, r.error)}</span>}
                      {r.errors?.length > 0 && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-muted-foreground">{t('portals.runs.showErrors', { count: r.errors.length })}</summary>
                          <ul className="mt-1 space-y-0.5">
                            {r.errors.map((e, i) => (
                              <li key={i}>
                                <span className="font-mono">{e.ref}</span>: {e.error}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.created}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.updated}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.deactivated}</td>
                    <td className="py-2 text-right tabular-nums">{r.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <FeedDialog
        key={feedDialog.n}
        open={feedDialog.open}
        feed={feedDialog.feed}
        onOpenChange={(open) => setFeedDialog((s) => ({ ...s, open }))}
        onSaved={(feed, runNow) => {
          load();
          if (runNow) runFeed(feed);
        }}
      />
      <ConfirmationDialog
        isOpen={!!confirm}
        variant="destructive"
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm?.kind === 'disconnect' ? t('portals.ml.disconnectTitle') : t('portals.feeds.deleteTitle')}
        description={confirm?.kind === 'disconnect' ? t('portals.ml.disconnectBody') : t('portals.feeds.deleteBody')}
        confirmText={confirm?.kind === 'disconnect' ? t('portals.ml.disconnect') : t('common.delete')}
        onConfirm={doConfirm}
      />
    </div>
  );
}
