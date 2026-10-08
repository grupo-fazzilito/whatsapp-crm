'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';

export interface GcalConnection {
  id: string;
  staff_id: string;
  google_email: string | null;
  status: 'active' | 'error' | 'revoked';
  last_error: string | null;
  last_synced_at: string | null;
  watch_expires_at: string | null;
  created_at: string;
  sync_errors: number;
}

export interface GcalStatus {
  configured: boolean;
  can_manage_all: boolean;
  my_staff: { id: string; name: string } | null;
  connections: GcalConnection[];
}

/** Google Calendar status of the active workspace (no tokens, ever). */
export function useGcalStatus() {
  const { workspace } = useWorkspace();
  const [status, setStatus] = useState<GcalStatus | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch('/api/integrations/google/status', { cache: 'no-store' }).catch(() => null);
    if (res?.ok) setStatus(await res.json());
  }, []);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    fetch('/api/integrations/google/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setStatus(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  return { status, reload };
}

/** Shows the result of the OAuth round-trip (?gcal=connected|error) once and cleans the URL. */
export function useGcalReturnToast() {
  const t = useT();
  const { label } = useWorkspace();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const result = params.get('gcal');
  const reason = params.get('reason');
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!result) return;
    const sig = params.toString();
    if (handled.current === sig) return;
    handled.current = sig;
    if (result === 'connected') {
      toast.success(t('gcal.connectedToast', { bookings: label('bookingPlural').toLowerCase() }));
    } else {
      const key = `gcal.errors.${reason ?? ''}`;
      const msg = t(key);
      toast.error(msg === key ? t('gcal.errors.generic', { reason: reason ?? '?' }) : msg);
    }
    const next = new URLSearchParams(params.toString());
    for (const k of ['gcal', 'reason', 'staff']) next.delete(k);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [result, reason, params, pathname, router, t, label]);
  return result;
}

/** "hace 3 min" / "3 min ago" for an ISO timestamp. */
export function relativeTime(iso: string, locale: string, justNow: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return justNow;
  const rtf = new Intl.RelativeTimeFormat(locale === 'en' ? 'en' : 'es', { numeric: 'auto' });
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}
