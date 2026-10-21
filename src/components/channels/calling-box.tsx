'use client';

import { useState } from 'react';
import { Phone } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { readCallingState, tierAllowsCalling, type CallingState } from '@/lib/calls/model';
import type { ChannelDTO } from './channel-types';

/** WhatsApp channel: turn customer calls on/off (answered from the inbox). */
export function CallingBox({ channel, isAdmin }: { channel: ChannelDTO; isAdmin: boolean }) {
  const t = useT();
  const [state, setState] = useState<CallingState | null>(() => readCallingState(channel.settings));
  const [hours, setHours] = useState(() => readCallingState(channel.settings)?.use_business_hours ?? false);
  const [busy, setBusy] = useState(false);
  const coexistence = channel.settings?.coexistence === true;
  const enabled = !!state?.enabled;
  const lowTier = state?.tier ? tierAllowsCalling(state.tier) === false : false;

  async function save(next: { enabled: boolean; useBusinessHours: boolean }) {
    setBusy(true);
    try {
      const res = await fetch(`/api/channels/${channel.id}/calling`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next.enabled, use_business_hours: next.useBusinessHours }),
      });
      const data = (await res.json().catch(() => ({}))) as { calling?: CallingState | null; error?: string; message?: string | null };
      if (data.calling) setState(data.calling);
      if (res.ok) toast.success(t('calls.settings.saved'));
      else toast.error(data.message ? t('calls.settings.error', { message: data.message }) : data.error ?? t('common.error'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2 rounded-md border border-border px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Phone className="size-3.5" />
          {t('calls.settings.title')}
        </p>
        {!coexistence && (
          <span
            className={cn(
              'shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium',
              enabled ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
            )}
          >
            {enabled ? t('calls.settings.badgeOn') : t('calls.settings.badgeOff')}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {coexistence ? t('calls.settings.coexistence') : enabled ? t('calls.settings.on') : t('calls.settings.off')}
      </p>
      {!coexistence && lowTier && (
        <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">{t('calls.settings.tierLow', { tier: state!.tier! })}</p>
      )}
      {!coexistence && state?.error && (
        <p className="rounded-md bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">{t('calls.settings.error', { message: state.error })}</p>
      )}
      {isAdmin && !coexistence && (
        <>
          <label className="flex items-start gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 size-3.5 accent-primary"
              checked={hours}
              disabled={busy}
              onChange={(e) => {
                setHours(e.target.checked);
                if (enabled) void save({ enabled: true, useBusinessHours: e.target.checked });
              }}
            />
            <span>
              {t('calls.settings.hours')}
              <span className="block text-muted-foreground">{t('calls.settings.hoursHelp')}</span>
            </span>
          </label>
          <Button
            variant={enabled ? 'ghost' : 'outline'}
            size="sm"
            className="justify-self-start"
            disabled={busy}
            onClick={() => void save({ enabled: !enabled, useBusinessHours: hours })}
          >
            {enabled ? t('calls.settings.disable') : t('calls.settings.enable')}
          </Button>
        </>
      )}
    </div>
  );
}
