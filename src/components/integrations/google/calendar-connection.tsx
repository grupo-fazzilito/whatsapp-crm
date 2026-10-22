'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CalendarCheck, CalendarX, Loader2, TriangleAlert } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { buttonVariants, Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { cn } from '@/lib/utils';
import { relativeTime, type GcalConnection } from './use-gcal';
import type { GcalReturn } from '@/lib/integrations/google/state';

interface Props {
  staffId: string;
  staffName: string;
  connection: GcalConnection | null;
  configured: boolean;
  canManage: boolean;
  /** Where the OAuth round-trip returns. */
  returnTo?: GcalReturn;
  onChanged: () => void;
  compact?: boolean;
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z" />
      <path fill="#34A853" d="M12 23c3 0 5.4-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.2v2.8A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.2a11 11 0 0 0 0 9.8z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.2 7.1l3.6 2.8C6.7 7.3 9.1 5.4 12 5.4z" />
    </svg>
  );
}

/** Connect / status / disconnect control for one staff member's Google Calendar. */
export function CalendarConnection({ staffId, staffName, connection, configured, canManage, returnTo = 'staff', onChanged, compact }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const { label } = useWorkspace();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const startHref = `/api/integrations/google/start?staff_id=${encodeURIComponent(staffId)}${returnTo !== 'staff' ? `&return=${returnTo}` : ''}`;

  const disconnect = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/integrations/google/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: staffId }),
      });
      if (!res.ok) {
        toast.error((await res.json().catch(() => ({}))).error ?? t('business.common.error'));
        return;
      }
      toast.success(t('gcal.disconnected'));
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (!connection) {
    if (!configured) return compact ? null : <p className="text-xs text-muted-foreground">{t('gcal.notConfigured')}</p>;
    if (!canManage) return compact ? null : <p className="text-xs text-muted-foreground">{t('gcal.noPermission', { staff: label('staff').toLowerCase() })}</p>;
    return (
      <a href={startHref} className={cn(buttonVariants({ variant: 'outline', size: compact ? 'sm' : 'default' }), 'gap-2')}>
        <GoogleMark />
        {t('gcal.connect')}
        <span className="sr-only"> — {staffName}</span>
      </a>
    );
  }

  const revoked = connection.status === 'revoked';
  const hasError = connection.status === 'error' || !!connection.last_error || connection.sync_errors > 0;
  const statusId = `gcal-status-${staffId}`;

  return (
    <div className="space-y-2" aria-describedby={statusId}>
      <div id={statusId} className="flex items-start gap-2 text-xs">
        {revoked ? (
          <CalendarX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        ) : hasError ? (
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
        ) : (
          <CalendarCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        )}
        <div className="min-w-0 space-y-0.5">
          <p className="truncate font-medium text-foreground">
            {connection.google_email ? t('gcal.connectedAs', { email: connection.google_email }) : t('gcal.connectedNoEmail')}
          </p>
          <p className="text-muted-foreground">
            {revoked
              ? t('gcal.statusRevoked')
              : connection.last_synced_at
                ? t('gcal.lastSync', { when: relativeTime(connection.last_synced_at, locale, t('gcal.justNow')) })
                : t('gcal.neverSynced')}
          </p>
          {revoked && <p className="text-destructive">{t('gcal.revokedHelp')}</p>}
          {!revoked && connection.sync_errors > 0 && <p className="text-amber-700 dark:text-amber-300">{t('gcal.syncErrors', { count: connection.sync_errors })}</p>}
          {!revoked && connection.last_error && !compact && <p className="break-words text-amber-700 dark:text-amber-300">{connection.last_error}</p>}
        </div>
      </div>
      {canManage && (
        <div className="flex flex-wrap gap-1.5">
          {revoked && configured && (
            <a href={startHref} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}>
              <GoogleMark />
              {t('gcal.reconnect')}
            </a>
          )}
          <Button variant="ghost" size="sm" className="text-destructive" disabled={busy} onClick={() => setConfirming(true)}>
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t('gcal.disconnect')}
            <span className="sr-only"> Google Calendar — {staffName}</span>
          </Button>
        </div>
      )}
      <ConfirmationDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={t('gcal.disconnectTitle')}
        description={t('gcal.disconnectBody', { name: staffName })}
        confirmText={t('gcal.disconnect')}
        cancelText={t('business.common.cancel')}
        variant="destructive"
        onConfirm={disconnect}
      />
    </div>
  );
}
