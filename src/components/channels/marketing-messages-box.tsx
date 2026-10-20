'use client';

import { useState } from 'react';
import { ExternalLink, Megaphone, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { readMarketingState, whatsappManagerUrl, type MarketingState } from '@/lib/whatsapp/marketing';
import { apiJson, type ChannelDTO } from './channel-types';

const BADGE_STYLE: Record<MarketingState['status'], string> = {
  ONBOARDED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  ELIGIBLE: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  NOT_ELIGIBLE: 'bg-red-500/10 text-red-600 dark:text-red-400',
  UNKNOWN: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
};

/** WhatsApp channel: whether marketing templates use Meta's Marketing Messages API, and how to turn it on. */
export function MarketingMessagesBox({ channel, isAdmin }: { channel: ChannelDTO; isAdmin: boolean }) {
  const t = useT();
  const [state, setState] = useState<MarketingState | null>(() => readMarketingState(channel.settings));
  const [checking, setChecking] = useState(false);
  const wabaId = typeof channel.settings?.waba_id === 'string' ? channel.settings.waba_id : null;
  const status = state?.status ?? 'UNKNOWN';

  async function check() {
    setChecking(true);
    try {
      const res = await apiJson<{ marketing_messages: MarketingState | null }>(`/api/channels/${channel.id}/marketing`, { method: 'POST' });
      setState(res.marketing_messages);
      toast.success(t('channels.marketing.checked'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setChecking(false);
    }
  }

  const text =
    status === 'ONBOARDED'
      ? t('channels.marketing.onboarded')
      : status === 'NOT_ELIGIBLE'
        ? t('channels.marketing.notEligible')
        : status === 'ELIGIBLE'
          ? t('channels.marketing.pending')
          : wabaId
            ? t('channels.marketing.unknown')
            : t('channels.marketing.noWaba');

  return (
    <div className="grid gap-2 rounded-md border border-border px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Megaphone className="size-3.5" />
          {t('channels.marketing.title')}
        </p>
        <span className={cn('shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', BADGE_STYLE[status])}>
          {t(`channels.marketing.badge.${status}`)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{text}</p>
      {status !== 'ONBOARDED' && wabaId && <p className="text-xs text-muted-foreground">{t('channels.marketing.howTo')}</p>}
      {isAdmin && wabaId && status !== 'ONBOARDED' && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            render={<a href={whatsappManagerUrl(wabaId)} target="_blank" rel="noopener noreferrer" />}
          >
            <ExternalLink className="size-3.5" />
            {t('channels.marketing.open')}
          </Button>
          <Button variant="ghost" size="sm" onClick={check} disabled={checking}>
            <RefreshCw className={cn('size-3.5', checking && 'animate-spin')} />
            {t('channels.marketing.check')}
          </Button>
        </div>
      )}
    </div>
  );
}
