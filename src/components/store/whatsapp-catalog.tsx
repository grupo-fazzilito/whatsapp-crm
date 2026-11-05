'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Search, Unplug } from 'lucide-react';
import { CopyField } from '@/components/channels/copy-field';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { LoadingBlock, Notice, selectClass } from '@/components/business/shared';
import type { CatalogStatus } from '@/lib/meta-catalog/connection';

const card = 'space-y-4 rounded-xl border border-border bg-card p-5';
type MetaCatalog = { id: string; name: string; product_count?: number };

/** Tienda online → WhatsApp: the Meta catalog synced in real time. */
export function WhatsAppCatalog({ readOnly, storeEnabled }: { readOnly: boolean; storeEnabled: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const { workspace: ws } = useWorkspace();
  const workspace = ws?.name ?? null;
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [channelId, setChannelId] = useState('');
  const [catalogs, setCatalogs] = useState<{ linked: MetaCatalog | null; catalogs: MetaCatalog[] } | null>(null);
  const [choice, setChoice] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState<'find' | 'connect' | 'sync' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const errText = (code: string | undefined) => {
    const known = ['permission', 'already_linked', 'whatsapp_not_connected', 'business_missing'];
    return known.includes(code ?? '') ? t(`store.whatsapp.error.${code}`) : code && code.length < 300 ? code : t('store.whatsapp.error.failed');
  };

  const load = useCallback(async () => {
    const res = await fetch('/api/meta-catalog', { cache: 'no-store' }).catch(() => null);
    if (res?.ok) {
      const s = (await res.json()) as CatalogStatus;
      setStatus(s);
      setChannelId((c) => c || s.channels[0]?.id || '');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- default name for a new catalog
    if (workspace && !newName) setNewName(workspace);
  }, [workspace, newName]);

  const find = async () => {
    setBusy('find');
    setError(null);
    const res = await fetch(`/api/meta-catalog/catalogs?channel_id=${channelId}`, { cache: 'no-store' }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(null);
    if (!res?.ok) {
      setError(errText(body?.error));
      return;
    }
    setCatalogs(body);
    setChoice(body.linked?.id ?? body.catalogs[0]?.id ?? 'new');
  };

  const connect = async () => {
    setBusy('connect');
    setError(null);
    const payload = choice === 'new' ? { channel_id: channelId, create_name: newName.trim() } : { channel_id: channelId, catalog_id: choice };
    const res = await fetch('/api/meta-catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(null);
    if (!res?.ok) {
      setError(errText(body?.error));
      return;
    }
    setStatus(body as CatalogStatus);
    setCatalogs(null);
    toast.success(t('store.whatsapp.connected'));
  };

  const syncNow = async () => {
    setBusy('sync');
    const res = await fetch('/api/meta-catalog/sync', { method: 'POST' }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(null);
    if (res?.ok) {
      setStatus(body as CatalogStatus);
      if (body.result?.error) toast.error(errText(body.result.error));
      else toast.success(t('store.whatsapp.synced', { sent: body.result?.sent ?? 0 }));
    } else toast.error(errText(body?.error));
  };

  const disconnect = async () => {
    const res = await fetch('/api/meta-catalog', { method: 'DELETE' }).catch(() => null);
    if (res?.ok) {
      setStatus((await res.json()) as CatalogStatus);
      toast.success(t('store.whatsapp.disconnected'));
    } else toast.error(t('store.whatsapp.error.failed'));
  };

  if (!status) return <LoadingBlock />;
  const conn = status.connection;
  const date = (iso: string) => new Date(iso).toLocaleString(locale === 'en' ? 'en-US' : 'es-PE', { dateStyle: 'medium', timeStyle: 'short' });
  const blocked = (Object.entries(status.blocked) as [keyof CatalogStatus['blocked'], number][]).filter(([, n]) => n > 0);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t('store.whatsapp.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('store.whatsapp.description')}</p>
        <p className="text-xs text-muted-foreground">{t('store.whatsapp.sourceOfTruth')}</p>
      </div>
      {!storeEnabled && <p role="note" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">{t('store.whatsapp.storeOff')}</p>}

      <FeedSection readOnly={readOnly} />

      <section className={card} aria-labelledby="wa-cat-title">
        <div className="space-y-1">
          <h2 id="wa-cat-title" className="text-base font-semibold">{t('store.whatsapp.apiTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('store.whatsapp.apiIntro')}</p>
        </div>

        {conn ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div className="space-y-1 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  {conn.status === 'error' ? <AlertTriangle className="size-4 text-amber-500" aria-hidden /> : <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />}
                  {t('store.whatsapp.connectedTitle', { name: conn.catalog_name || conn.catalog_id })}
                </p>
                {conn.channel && <p className="text-muted-foreground">{t('store.whatsapp.via', { number: conn.channel.handle || conn.channel.name })}</p>}
                <p className="text-muted-foreground">{conn.last_synced_at ? t('store.whatsapp.lastSync', { date: date(conn.last_synced_at) }) : t('store.whatsapp.never')}</p>
                <p className="text-muted-foreground">{status.pending ? t('store.whatsapp.pending', { n: status.pending }) : t('store.whatsapp.upToDate')}</p>
              </div>
              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void syncNow()}>
                    {busy === 'sync' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
                    {t('store.whatsapp.syncNow')}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setConfirmOff(true)}>
                    <Unplug className="size-4" aria-hidden /> {t('store.whatsapp.disconnect')}
                  </Button>
                </div>
              )}
            </div>
            {conn.last_error && (
              <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">{errText(conn.last_error)}</p>
            )}
            {conn.item_errors.length > 0 && (
              <div className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{t('store.whatsapp.itemErrors', { n: conn.item_errors.length })}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {conn.item_errors.slice(0, 10).map((e) => (
                    <li key={e.retailer_id}>{e.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : status.channels.length === 0 ? (
          <Notice>
            {t('store.whatsapp.noWhatsApp')}{' '}
            <Link href="/channels" className="font-medium text-primary underline underline-offset-2">{t('store.whatsapp.goChannels')}</Link>
          </Notice>
        ) : readOnly ? null : (
          <div className="space-y-4">
            {status.channels.length > 1 && (
              <div className="grid gap-1.5 sm:max-w-sm">
                <Label htmlFor="wa-cat-channel">{t('store.whatsapp.number')}</Label>
                <select id="wa-cat-channel" className={selectClass} value={channelId} onChange={(e) => { setChannelId(e.target.value); setCatalogs(null); }}>
                  {status.channels.map((c) => (
                    <option key={c.id} value={c.id}>{c.handle ? `${c.name} · ${c.handle}` : c.name}</option>
                  ))}
                </select>
              </div>
            )}
            {!catalogs ? (
              <Button disabled={busy !== null || !channelId} onClick={() => void find()}>
                {busy === 'find' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
                {busy === 'find' ? t('store.whatsapp.finding') : t('store.whatsapp.find')}
              </Button>
            ) : (
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">{t('store.whatsapp.pick')}</legend>
                {catalogs.catalogs.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="wa-cat" value={c.id} checked={choice === c.id} onChange={() => setChoice(c.id)} className="size-4 accent-primary" disabled={!!catalogs.linked && catalogs.linked.id !== c.id} />
                    <span>
                      {c.name}
                      <span className="text-muted-foreground">
                        {typeof c.product_count === 'number' ? ` · ${t('store.whatsapp.products', { n: c.product_count })}` : ''}
                        {catalogs.linked?.id === c.id ? ` · ${t('store.whatsapp.linked')}` : ''}
                      </span>
                    </span>
                  </label>
                ))}
                {!catalogs.linked && (
                  <label className="flex flex-wrap items-center gap-2 text-sm">
                    <input type="radio" name="wa-cat" value="new" checked={choice === 'new'} onChange={() => setChoice('new')} className="size-4 accent-primary" />
                    {t('store.whatsapp.createNew')}
                    {choice === 'new' && (
                      <Input aria-label={t('store.whatsapp.newName')} className="h-8 w-60" maxLength={100} value={newName} onChange={(e) => setNewName(e.target.value)} />
                    )}
                  </label>
                )}
                <div className="pt-2">
                  <Button disabled={busy !== null || !choice || (choice === 'new' && !newName.trim())} onClick={() => void connect()}>
                    {busy === 'connect' && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    {t('store.whatsapp.connect')}
                  </Button>
                </div>
              </fieldset>
            )}
            {error && <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">{error}</p>}
          </div>
        )}
      </section>

      {blocked.length > 0 && (
        <section className={card} aria-labelledby="wa-cat-blocked">
          <h2 id="wa-cat-blocked" className="text-base font-semibold">{t('store.whatsapp.blockedTitle')}</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {blocked.map(([k, n]) => (
              <li key={k} className="rounded-full bg-muted px-3 py-1 text-muted-foreground">{t(`store.whatsapp.blocked.${k}`, { n })}</li>
            ))}
          </ul>
        </section>
      )}

      <Notice>{t('store.whatsapp.orders')}</Notice>

      <ConfirmationDialog
        isOpen={confirmOff}
        onOpenChange={setConfirmOff}
        title={t('store.whatsapp.disconnect')}
        description={t('store.whatsapp.disconnectConfirm')}
        confirmText={t('store.whatsapp.disconnect')}
        cancelText={t('catalog.cancel')}
        variant="destructive"
        onConfirm={disconnect}
      />
    </div>
  );
}

/** The product feed link Meta reads every hour, and how to set it up. */
function FeedSection({ readOnly }: { readOnly: boolean }) {
  const t = useT();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/store/feed', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { url: null }))
      .then((d: { url: string | null }) => !cancelled && setUrl(d.url))
      .catch(() => !cancelled && setUrl(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const create = async () => {
    setBusy(true);
    const res = await fetch('/api/store/feed', { method: 'POST' }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setUrl(((await res.json()) as { url: string }).url);
      toast.success(t('store.whatsapp.feedCreated'));
    } else toast.error(t('store.whatsapp.error.failed'));
  };

  return (
    <section className={card} aria-labelledby="wa-feed-title">
      <div className="space-y-1">
        <h2 id="wa-feed-title" className="text-base font-semibold">{t('store.whatsapp.feedTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('store.whatsapp.feedIntro')}</p>
      </div>
      {url === undefined ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
      ) : url ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <CopyField label={t('store.whatsapp.feedLink')} value={url} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" render={<a href={url} target="_blank" rel="noopener noreferrer" />}>
              <ExternalLink className="size-4" aria-hidden /> {t('store.whatsapp.feedOpen')}
            </Button>
            {!readOnly && (
              <Button variant="ghost" disabled={busy} onClick={() => setConfirm(true)}>
                <RefreshCw className="size-4" aria-hidden /> {t('store.whatsapp.feedRenew')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        !readOnly && (
          <Button disabled={busy} onClick={() => void create()}>
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('store.whatsapp.feedCreate')}
          </Button>
        )
      )}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t('store.whatsapp.stepsTitle')}</h3>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          {['s1', 's2', 's3', 's4', 's5'].map((k) => (
            <li key={k}>{t(`store.whatsapp.steps.${k}`)}</li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">{t('store.whatsapp.feedDelay')}</p>
      </div>
      <ConfirmationDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t('store.whatsapp.feedRenew')}
        description={t('store.whatsapp.feedRenewConfirm')}
        confirmText={t('store.whatsapp.feedRenew')}
        cancelText={t('catalog.cancel')}
        onConfirm={create}
      />
    </section>
  );
}
