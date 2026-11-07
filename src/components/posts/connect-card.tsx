'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Link2, Loader2, Unlink } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { TargetIcon, type AccountsState } from './posts-manager';

interface Candidate {
  id: string;
  name: string;
  picture: string | null;
  instagram: { username: string | null } | null;
}

/** Connected Facebook page + Instagram account, "Connect" and the page picker after Facebook Login. */
export function ConnectCard({ state, pick, onChange }: { state: AccountsState | null; pick: boolean; onChange: () => Promise<void> | void }) {
  const t = useT();
  const { can } = useWorkspace();
  const admin = can('admin');
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!pick || !admin) return;
    void fetch('/api/social/oauth/candidates', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { pages: [] }))
      .then((b: { pages: Candidate[] }) => {
        setCandidates(b.pages);
        if (!b.pages.length) toast.error(t('posts.connect.pickExpired'));
      });
  }, [pick, admin, t]);

  if (!state) return null;
  const fb = state.accounts.find((a) => a.network === 'facebook');
  const ig = state.accounts.find((a) => a.network === 'instagram');

  const choose = async (id: string) => {
    setBusy(id);
    const res = await fetch('/api/social/oauth/candidates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page_id: id }) }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      toast.success(t('posts.connect.connected'));
      setCandidates(null);
      router.replace('/posts');
      await onChange();
    } else toast.error(t('posts.connect.pickExpired'));
  };

  const disconnect = async () => {
    if (!window.confirm(t('posts.connect.disconnectConfirm'))) return;
    setBusy('disconnect');
    const res = await fetch('/api/social/accounts', { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      toast.success(t('posts.connect.disconnected'));
      await onChange();
    } else toast.error(t('posts.errors.generic'));
  };

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby="posts-accounts-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="posts-accounts-title" className="text-sm font-semibold text-foreground">{t('posts.connect.title')}</h2>
          {!fb && <p className="mt-0.5 text-sm text-muted-foreground">{state.available ? t('posts.connect.intro') : t('posts.connect.notAvailable')}</p>}
          {fb && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {[fb, ig].filter(Boolean).map((a) => (
                <li key={a!.id} className="flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-sm">
                  {a!.picture_url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Meta profile picture
                    <img src={a!.picture_url} alt="" className="size-5 rounded-full object-cover" />
                  ) : (
                    <TargetIcon target={a!.network} className="size-4" />
                  )}
                  <TargetIcon target={a!.network} className="size-3.5 text-muted-foreground" />
                  <span className="max-w-[12rem] truncate font-medium">{a!.name}</span>
                  {a!.status === 'error' && (
                    <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400" title={a!.last_error ?? ''}>
                      <AlertTriangle className="size-3.5" aria-hidden /> {t('posts.connect.accountError')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {fb && !ig && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{t('posts.connect.noInstagram')}</p>}
        </div>
        {admin && state.available && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" size="sm" variant={fb ? 'outline' : 'default'} onClick={() => window.location.assign('/api/social/oauth/start')}>
              <Link2 className="size-4" aria-hidden /> {fb ? t('posts.connect.reconnect') : t('posts.connect.button')}
            </Button>
            {fb && (
              <Button type="button" size="sm" variant="ghost" disabled={busy === 'disconnect'} onClick={() => void disconnect()}>
                {busy === 'disconnect' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Unlink className="size-4" aria-hidden />} {t('posts.connect.disconnect')}
              </Button>
            )}
          </div>
        )}
      </div>

      {candidates && candidates.length > 0 && (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-sm font-semibold">{t('posts.connect.pickTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('posts.connect.pickHint')}</p>
          <ul className="space-y-2">
            {candidates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-2">
                {c.picture && (
                  // eslint-disable-next-line @next/next/no-img-element -- Meta page picture
                  <img src={c.picture} alt="" className="size-8 rounded-full object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.instagram?.username ? t('posts.connect.withInstagram', { user: c.instagram.username }) : t('posts.connect.noInstagram')}</p>
                </div>
                <Button type="button" size="sm" disabled={!!busy} onClick={() => void choose(c.id)}>
                  {busy === c.id && <Loader2 className="size-4 animate-spin" aria-hidden />} {t('posts.connect.pick')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
