'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plug } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { cn } from '@/lib/utils';
import { CHANNEL_STYLE } from '@/components/channels/channel-types';
import type { ChannelType } from '@/lib/channels/types';

interface Channel {
  id: string;
  type: string;
  name: string;
  status: string;
  display_handle?: string | null;
}

const TYPES: ChannelType[] = ['whatsapp', 'instagram', 'messenger', 'webchat'];

const BADGE: Record<string, string> = {
  connected: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  disconnected: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  none: 'bg-muted text-muted-foreground',
};

/** Every channel type with its accounts; types without one show "Not connected". */
export function ConnectedAccounts() {
  const { t } = useI18n();
  const { workspace, can } = useWorkspace();
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [tiktok, setTiktok] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    let alive = true;
    fetch('/api/channels', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { channels?: Channel[]; features?: { tiktok?: boolean } } | null) => {
        if (!alive) return;
        setChannels(d?.channels ?? []);
        setTiktok(!!d?.features?.tiktok);
      })
      .catch(() => alive && setChannels([]));
    return () => {
      alive = false;
    };
  }, [workspace]);

  const types = tiktok ? [...TYPES, 'tiktok' as ChannelType] : TYPES;
  const statusLabel = (s: string) => (s === 'connected' ? t('dash.accounts.connected') : s === 'error' ? t('dash.accounts.error') : t('dash.accounts.disconnected'));

  return (
    <section className="flex h-full flex-col rounded-xl border border-border bg-card p-5" aria-labelledby="accounts-title">
      <div className="flex items-start justify-between gap-2">
        <h2 id="accounts-title" className="text-sm font-medium text-muted-foreground">
          {t('dash.w.connected_accounts.title')}
        </h2>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden>
          <Plug className="h-4 w-4" />
        </span>
      </div>
      {!channels ? (
        <div className="mt-4 h-24 animate-pulse rounded-lg bg-muted" aria-hidden />
      ) : (
        <ul className="mt-3 grid gap-2">
          {types.map((type) => {
            const style = CHANNEL_STYLE[type];
            const mine = channels.filter((c) => c.type === type);
            return (
              <li key={type} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', style.tile)} aria-hidden>
                  <style.icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{style.label}</p>
                  {mine.length > 0 && (
                    <p className="truncate text-xs text-muted-foreground">
                      {mine
                        .slice(0, 2)
                        .map((c) => c.display_handle || c.name)
                        .join(' · ')}
                      {mine.length > 2 ? ` ${t('dash.accounts.more', { n: mine.length - 2 })}` : ''}
                    </p>
                  )}
                </div>
                {mine.length === 0 ? (
                  <div className="flex items-center gap-2">
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', BADGE.none)}>{t('dash.accounts.notConnected')}</span>
                    {can('admin') && (
                      <Link href="/channels" className="text-xs font-semibold text-primary hover:underline">
                        {t('dash.accounts.connect')}
                      </Link>
                    )}
                  </div>
                ) : (
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', BADGE[mine.some((c) => c.status === 'connected') ? 'connected' : mine[0].status] ?? BADGE.none)}>
                    {statusLabel(mine.some((c) => c.status === 'connected') ? 'connected' : mine[0].status)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Link href="/channels" className="mt-3 text-xs font-medium text-primary hover:underline">
        {t('dash.accounts.manage')} →
      </Link>
    </section>
  );
}
