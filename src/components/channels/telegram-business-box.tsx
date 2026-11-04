'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Briefcase, Loader2, RefreshCw } from 'lucide-react';
import { useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { apiJson, type ChannelDTO } from './channel-types';

/** Telegram bot card: how to answer the owner's personal account with this bot (Telegram Business). */
export function TelegramBusinessBox({ channel, isAdmin }: { channel: ChannelDTO; isAdmin: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const bot = channel.display_handle ?? '@bot';

  const resync = async () => {
    setBusy(true);
    try {
      await apiJson(`/api/channels/${channel.id}`, { method: 'PATCH', body: JSON.stringify({ resync_webhook: true }) });
      toast.success(t('channels.telegram.business.resynced'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="group rounded-md border border-border bg-muted/30 p-3 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-foreground">
        <Briefcase className="size-3.5" aria-hidden />
        {t('channels.telegram.business.title')}
      </summary>
      <div className="mt-2 grid gap-2 text-muted-foreground">
        <p>{t('channels.telegram.business.intro')}</p>
        <ol className="list-decimal space-y-1 pl-4">
          <li>{t('channels.telegram.business.step1', { bot })}</li>
          <li>{t('channels.telegram.business.step2', { bot })}</li>
          <li>{t('channels.telegram.business.step3')}</li>
        </ol>
        <p>{t('channels.telegram.business.note')}</p>
        {isAdmin && (
          <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={busy} onClick={() => void resync()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
            {t('channels.telegram.business.resync')}
          </Button>
        )}
      </div>
    </details>
  );
}
