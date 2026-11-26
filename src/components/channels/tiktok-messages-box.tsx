'use client';

import { CheckCircle2, ExternalLink, MessageCircle, TriangleAlert } from 'lucide-react';
import { useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { tiktokCanMessage } from '@/lib/tiktok/scopes';
import type { ChannelDTO } from './channel-types';

/** TikTok card: what the business must do so its direct messages reach the inbox. */
export function TiktokMessagesBox({ channel, isAdmin }: { channel: ChannelDTO; isAdmin: boolean }) {
  const t = useT();
  const scopes = Array.isArray(channel.settings?.scopes) ? (channel.settings.scopes as string[]) : [];
  const ready = tiktokCanMessage(scopes);

  return (
    <details className="group rounded-md border border-border bg-muted/30 p-3 text-xs" open={!ready}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-foreground">
        <MessageCircle className="size-3.5" aria-hidden />
        {t('channels.tiktok.messages.title')}
      </summary>
      <div className="mt-2 grid gap-2 text-muted-foreground">
        {ready ? (
          <p className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
            {t('channels.tiktok.messages.ready')}
          </p>
        ) : (
          <p role="note" className="flex items-start gap-1.5 text-amber-700 dark:text-amber-300">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t('channels.tiktok.messages.missing')}
          </p>
        )}
        <p>{t('channels.tiktok.messages.intro')}</p>
        <ol className="list-decimal space-y-1 pl-4">
          <li>{t('channels.tiktok.messages.step1')}</li>
          <li>{t('channels.tiktok.messages.step2')}</li>
          <li>{t('channels.tiktok.messages.step3')}</li>
        </ol>
        <p>{t('channels.tiktok.messages.rules')}</p>
        {isAdmin && (
          <Button
            type="button"
            variant={ready ? 'outline' : 'default'}
            size="sm"
            className="justify-self-start"
            onClick={() => window.location.assign('/api/channels/tiktok/oauth/start')}
          >
            <ExternalLink className="size-3.5" aria-hidden />
            {t('channels.tiktok.messages.reconnect')}
          </Button>
        )}
      </div>
    </details>
  );
}
