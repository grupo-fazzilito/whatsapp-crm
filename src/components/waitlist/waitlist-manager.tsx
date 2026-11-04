'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { BellRing, Loader2, MessageCircle, Package, Send, Trash2 } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { EmptyState, LoadingBlock, PageHeader } from '@/components/business/shared';
import type { NotifyResult, NotifySkip, WaitlistGroup, WaitlistStatus } from '@/lib/waitlist/server';
import { WaitlistTemplateNotice } from './template-notice';

export function WaitlistManager() {
  const t = useT();
  const { locale } = useI18n();
  const [status, setStatus] = useState<WaitlistStatus>('waiting');
  const [groups, setGroups] = useState<WaitlistGroup[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (s: WaitlistStatus) => {
    const res = await fetch(`/api/waitlist?status=${s}`, { cache: 'no-store' }).catch(() => null);
    setGroups(res?.ok ? ((await res.json()) as { groups: WaitlistGroup[] }).groups : []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load on tab change
    setGroups(null);
    void load(status);
  }, [load, status]);

  const date = (iso: string) => new Date(iso).toLocaleDateString(locale === 'en' ? 'en-US' : 'es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const reason = (r: string | null) => (r ? t(`waitlist.reason.${r as NotifySkip}`) : '');

  const notify = async (key: string, ids: string[]) => {
    setBusy(key);
    const res = await fetch('/api/waitlist/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      toast.error(t('waitlist.error'));
      return;
    }
    const out = (await res.json()) as NotifyResult;
    if (out.sent) toast.success(t('waitlist.sent', { n: out.sent }));
    if (out.failed.length) toast.error(t('waitlist.someFailed', { n: out.failed.length, reason: reason(out.failed[0].reason) }));
    void load(status);
  };

  const remove = async (id: string) => {
    setBusy(id);
    const res = await fetch(`/api/waitlist/${id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      toast.success(t('waitlist.removed'));
      setGroups((gs) => (gs ?? []).map((g) => ({ ...g, entries: g.entries.filter((e) => e.id !== id) })).filter((g) => g.entries.length));
    } else toast.error(t('waitlist.error'));
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('waitlist.title')} description={t('waitlist.description')} />
      <WaitlistTemplateNotice context="module" />
      <Tabs value={status} onValueChange={(v) => setStatus(v === 'notified' ? 'notified' : 'waiting')}>
        <TabsList>
          <TabsTrigger value="waiting" className="px-3">{t('waitlist.tabs.waiting')}</TabsTrigger>
          <TabsTrigger value="notified" className="px-3">{t('waitlist.tabs.notified')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {!groups ? (
        <LoadingBlock />
      ) : groups.length === 0 ? (
        <EmptyState icon={<BellRing className="size-6" />} title={status === 'waiting' ? t('waitlist.empty') : t('waitlist.emptyNotified')} />
      ) : (
        <ul className="space-y-4">
          {groups.map((g) => {
            const ready = g.product.is_active && (g.available === null || g.available > 0);
            const stock = !g.product.is_active
              ? t('waitlist.inactive')
              : g.available === null
                ? t('waitlist.inStockUntracked')
                : g.available > 0
                  ? t('waitlist.inStock', { n: g.available })
                  : t('waitlist.noStock');
            const title = g.variant ? `${g.product.name} (${g.variant.name})` : g.product.name;
            return (
              <li key={g.key} className="rounded-xl border border-border bg-card">
                <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
                  {g.product.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- catalog image
                    <img src={g.product.image} alt="" className="size-12 shrink-0 rounded-lg object-cover ring-1 ring-border" />
                  ) : (
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Package className="size-5" aria-hidden />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
                    <p className="text-xs text-muted-foreground">
                      {t('waitlist.people', { n: g.entries.length })} ·{' '}
                      <span className={ready ? 'font-medium text-emerald-600 dark:text-emerald-400' : ''}>{stock}</span>
                    </p>
                  </div>
                  {status === 'waiting' && (
                    <Button size="sm" disabled={!ready || busy !== null} onClick={() => void notify(g.key, g.entries.map((e) => e.id))}>
                      {busy === g.key ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
                      {t('waitlist.notifyAll')}
                    </Button>
                  )}
                </div>
                <ul className="divide-y divide-border">
                  {g.entries.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">{e.name || `+${e.phone}`}</p>
                        <p className="text-xs text-muted-foreground">
                          {e.name ? `+${e.phone} · ` : ''}
                          {status === 'waiting' ? t('waitlist.since', { date: date(e.created_at) }) : t('waitlist.notifiedAt', { date: date(e.notified_at ?? e.created_at) })}
                        </p>
                        {status === 'waiting' && e.notify_error && <p className="text-xs text-amber-700 dark:text-amber-300">{reason(e.notify_error)}</p>}
                      </div>
                      <div className="flex items-center gap-1">
                        {status === 'waiting' && (
                          <Button variant="outline" size="sm" disabled={!ready || busy !== null} onClick={() => void notify(e.id, [e.id])} aria-label={`${t('waitlist.notify')}: ${e.name || e.phone}`}>
                            {busy === e.id ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
                            <span className="hidden sm:inline">{t('waitlist.notify')}</span>
                          </Button>
                        )}
                        {e.conversation_id && (
                          <Button variant="ghost" size="icon-sm" render={<Link href={`/inbox?c=${e.conversation_id}`} />} aria-label={t('waitlist.openChat')} title={t('waitlist.openChat')}>
                            <MessageCircle className="size-4" aria-hidden />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon-sm" disabled={busy !== null} onClick={() => void remove(e.id)} aria-label={`${t('waitlist.remove')}: ${e.name || e.phone}`} title={t('waitlist.remove')}>
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
