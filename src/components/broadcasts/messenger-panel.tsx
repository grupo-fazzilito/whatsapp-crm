'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Download, Link2, Loader2, Plus, Unlink } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import type { MessengerStatus } from '@/lib/messenger-marketing/server';

/** Difusiones → Messenger: ad account connection, subscribers and the automatic invitation. */
export function MessengerPanel() {
  const t = useT();
  const { can } = useWorkspace();
  const admin = can('admin');
  const router = useRouter();
  const params = useSearchParams();
  const [state, setState] = useState<MessengerStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<MessengerStatus['settings'] | null>(null);
  const [pick, setPick] = useState<{ pages: { id: string; name: string }[]; ad_accounts: { id: string; name: string; currency: string | null }[] } | null>(null);
  const [choice, setChoice] = useState({ page: '', ad: '' });

  const load = useCallback(async () => {
    const res = await fetch('/api/messenger-marketing', { cache: 'no-store' }).catch(() => null);
    if (!res?.ok) return;
    const s = (await res.json()) as MessengerStatus;
    setState(s);
    setForm(s.settings);
  }, []);

  useEffect(() => {
     
    void load();
  }, [load]);

  const flag = params.get('messenger');
  const reason = params.get('reason');
  useEffect(() => {
    if (!flag) return;
    if (flag === 'connected') toast.success(t('mm.connected'));
    if (flag === 'error') toast.error(t(`mm.errors.${reason ?? 'exchange'}`));
    if (flag === 'pick' && admin) {
      void fetch('/api/messenger-marketing/connect', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => {
          if (!b?.pages?.length) return toast.error(t('mm.pickExpired'));
          setPick(b);
          setChoice({ page: b.pages[0].id, ad: b.ad_accounts[0]?.id ?? '' });
        });
    } else router.replace('/broadcasts');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per arrival
  }, [flag]);

  if (!state || !form) return null;
  const conn = state.connection;
  if (!conn && !state.available && !state.subscribers.subscribed) {
    return <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">{t('mm.notAvailable')}</p>;
  }

  const savePick = async () => {
    setBusy('pick');
    const res = await fetch('/api/messenger-marketing/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page_id: choice.page, ad_account_id: choice.ad }) }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      toast.success(t('mm.connected'));
      setPick(null);
      router.replace('/broadcasts');
      void load();
    } else toast.error(t('mm.pickExpired'));
  };

  const disconnect = async () => {
    if (!window.confirm(t('mm.disconnectConfirm'))) return;
    setBusy('disconnect');
    await fetch('/api/messenger-marketing', { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    void load();
  };

  const importSubs = async () => {
    setBusy('import');
    const res = await fetch('/api/messenger-marketing/import', { method: 'POST' }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setBusy(null);
    if (res?.ok) toast.success(t('mm.subs.imported', { imported: body.imported, updated: body.updated }));
    else toast.error(body?.message ?? t('mm.form.errors.generic'));
    void load();
  };

  const saveSettings = async () => {
    setBusy('settings');
    const res = await fetch('/api/messenger-marketing/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      toast.success(t('mm.settings.saved'));
      void load();
    } else toast.error(t('mm.form.errors.generic'));
  };

  const selectCls = 'h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground';
  const dirty = JSON.stringify(form) !== JSON.stringify(state.settings);

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4 text-card-foreground" aria-labelledby="mm-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="mm-title" className="text-sm font-semibold">{t('mm.title')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('mm.intro')}</p>
          {conn && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('mm.connectedAs', { page: conn.page_name ?? conn.page_id, account: conn.ad_account_name ?? conn.ad_account_id })}
            </p>
          )}
          {conn?.status === 'error' && (
            <p className="mt-1 flex items-center gap-1 text-xs text-red-600 dark:text-red-400" title={conn.last_error ?? ''}>
              <AlertTriangle className="size-3.5" aria-hidden /> {t('mm.error')}
            </p>
          )}
          {!conn && !state.pages.length && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t('mm.noPage')}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {conn && admin && (
            <Link href="/broadcasts/messenger/new" className="inline-flex h-7 items-center gap-1 rounded-lg bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground hover:bg-primary/90">
              <Plus className="size-3.5" aria-hidden /> {t('mm.newBroadcast')}
            </Link>
          )}
          {admin && state.available && state.pages.length > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.assign('/api/messenger-marketing/oauth/start')}>
              <Link2 className="size-4" aria-hidden /> {conn ? t('mm.reconnect') : t('mm.connect')}
            </Button>
          )}
          {conn && admin && (
            <Button type="button" size="sm" variant="ghost" disabled={busy === 'disconnect'} onClick={() => void disconnect()}>
              <Unlink className="size-4" aria-hidden /> {t('mm.disconnect')}
            </Button>
          )}
        </div>
      </div>

      {pick && (
        <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-sm font-semibold">{t('mm.pickTitle')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="mm-page">{t('mm.page')}</Label>
              <select id="mm-page" className={selectCls} value={choice.page} onChange={(e) => setChoice({ ...choice, page: e.target.value })}>
                {pick.pages.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="mm-ad">{t('mm.adAccount')}</Label>
              <select id="mm-ad" className={selectCls} value={choice.ad} onChange={(e) => setChoice({ ...choice, ad: e.target.value })}>
                {pick.ad_accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}{a.currency ? ` (${a.currency})` : ''}</option>
                ))}
              </select>
            </div>
          </div>
          <Button type="button" size="sm" disabled={busy === 'pick' || !choice.page || !choice.ad} onClick={() => void savePick()}>
            {busy === 'pick' && <Loader2 className="size-4 animate-spin" aria-hidden />} {t('mm.pickSave')}
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('mm.subs.title')}</p>
        <ul className="flex flex-wrap gap-2 text-sm">
          <li className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-emerald-700 dark:text-emerald-300">{t('mm.subs.subscribed', { n: state.subscribers.subscribed })}</li>
          <li className="rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground">{t('mm.subs.invited', { n: state.subscribers.invited })}</li>
          <li className="rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground">{t('mm.subs.stopped', { n: state.subscribers.stopped })}</li>
          <li className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-sky-700 dark:text-sky-300">{t('mm.subs.ready', { n: state.subscribers.ready })}</li>
        </ul>
        {conn && admin && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy === 'import'} onClick={() => void importSubs()}>
              {busy === 'import' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />} {t('mm.subs.import')}
            </Button>
            <span className="text-xs text-muted-foreground">{t('mm.subs.importHint')}</span>
          </div>
        )}
      </div>

      {admin && (state.available || conn) && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="mm-auto">{t('mm.settings.autoInvite')}</Label>
              <p className="text-xs text-muted-foreground">{t('mm.settings.autoInviteHint')}</p>
            </div>
            <Switch id="mm-auto" checked={form.auto_invite} onCheckedChange={(v) => setForm({ ...form, auto_invite: !!v })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="mm-invite-title">{t('mm.settings.inviteTitle')}</Label>
              <Input id="mm-invite-title" maxLength={65} value={form.invite_title} onChange={(e) => setForm({ ...form, invite_title: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mm-invite-image">{t('mm.settings.inviteImage')}</Label>
              <Input id="mm-invite-image" type="url" placeholder="https://" value={form.invite_image_url ?? ''} onChange={(e) => setForm({ ...form, invite_image_url: e.target.value || null })} />
            </div>
          </div>
          <Button type="button" size="sm" disabled={!dirty || busy === 'settings'} onClick={() => void saveSettings()}>
            {busy === 'settings' && <Loader2 className="size-4 animate-spin" aria-hidden />} {t('mm.settings.save')}
          </Button>
        </div>
      )}
    </section>
  );
}
