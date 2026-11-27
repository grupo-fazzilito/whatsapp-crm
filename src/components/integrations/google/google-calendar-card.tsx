'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useT } from '@/i18n/client';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarConnection } from './calendar-connection';
import { GcalReturnToast } from './return-toast';
import { useGcalStatus } from './use-gcal';

interface StaffRow {
  id: string;
  name: string;
  member_user_id: string | null;
}

/**
 * Settings → Integrations: one Google Calendar for the whole business and,
 * with the team module, one per person (bookings become events in the
 * person's calendar, else the business's; busy times block the schedule).
 */
export function GoogleCalendarCard() {
  const t = useT();
  const { user } = useAuth();
  const { workspace, label, modules, can, refresh } = useWorkspace();
  const isAdmin = can('admin');
  const { status, reload } = useGcalStatus();
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const enabled = modules.bookings;
  const withStaff = modules.staff;
  // General calendar or each professional's own (the latter needs the professionals module).
  const mode: 'business' | 'staff' = withStaff && workspace?.settings?.calendar_mode !== 'business' ? 'staff' : 'business';
  const [savingMode, setSavingMode] = useState(false);
  const changeMode = async (next: 'business' | 'staff') => {
    if (next === mode || savingMode) return;
    setSavingMode(true);
    try {
      const res = await fetch('/api/integrations/google/mode', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: next }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
      toast.success(t('gcal.integrations.modeSaved'));
    } catch {
      toast.error(t('business.common.error'));
    } finally {
      setSavingMode(false);
    }
  };

  useEffect(() => {
    if (!workspace || !enabled || mode !== 'staff') return;
    let cancelled = false;
    fetch('/api/business/staff', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { staff: [] }))
      .catch(() => ({ staff: [] }))
      .then((d: { staff?: StaffRow[] }) => !cancelled && setStaff(d.staff ?? []));
    return () => {
      cancelled = true;
    };
  }, [workspace, enabled, mode]);

  const bookings = label('bookingPlural').toLowerCase();
  const staffPlural = label('staffPlural');

  return (
    <Card>
      <Suspense fallback={null}>
        <GcalReturnToast onConnected={reload} />
      </Suspense>
      <CardHeader>
        <CardTitle>{t('gcal.title')}</CardTitle>
        <CardDescription>{t('gcal.integrations.description', { bookings })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!enabled ? (
          <p className="text-sm text-muted-foreground">
            {t('gcal.integrations.needsBookings', { bookings, staffPlural: staffPlural.toLowerCase() })}{' '}
            {isAdmin && (
              <Link href="/business/setup" className="text-primary underline-offset-2 hover:underline">
                {t('gcal.integrations.openSetup')}
              </Link>
            )}
          </p>
        ) : !status || (mode === 'staff' && staff === null) ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t('gcal.loading')}
          </p>
        ) : !status.configured ? (
          <p className="text-sm text-muted-foreground">{t('gcal.notConfigured')}</p>
        ) : (
          <div className="space-y-5">
            {withStaff && (
              <fieldset className="space-y-2" disabled={!isAdmin || savingMode}>
                <legend className="mb-1 text-sm font-semibold text-foreground">{t('gcal.integrations.modeTitle')}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(['business', 'staff'] as const).map((m) => (
                    <label
                      key={m}
                      className={cn(
                        'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm transition-colors',
                        mode === m ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
                      )}
                    >
                      <input type="radio" name="gcal-mode" className="mt-0.5 size-4 accent-[var(--primary)]" checked={mode === m} onChange={() => void changeMode(m)} />
                      <span>
                        <span className="block font-medium text-foreground">{t(`gcal.integrations.mode.${m}`)}</span>
                        <span className="block text-xs text-muted-foreground">{t(`gcal.integrations.modeHelp.${m}`, { bookings, staffPlural: staffPlural.toLowerCase() })}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {/* One calendar for the whole business. */}
            {mode === 'business' && (
            <section aria-labelledby="gcal-business" className="space-y-2">
              <h3 id="gcal-business" className="text-sm font-semibold text-foreground">{t('gcal.integrations.businessTitle')}</h3>
              <p className="text-xs text-muted-foreground">{t('gcal.integrations.businessHelp', { bookings })}</p>
              <div className="rounded-lg border border-border p-3">
                <CalendarConnection
                  compact
                  staffId={null}
                  staffName={workspace?.name ?? ''}
                  connection={status.connections.find((c) => c.staff_id === null) ?? null}
                  configured={status.configured}
                  canManage={isAdmin}
                  returnTo="integrations"
                  onChanged={reload}
                />
              </div>
            </section>
            )}

            {/* Or one per professional. */}
            {mode === 'staff' && (
              <section aria-labelledby="gcal-staff" className="space-y-2">
                <h3 id="gcal-staff" className="text-sm font-semibold text-foreground">{t('gcal.integrations.staffTitle', { staffPlural })}</h3>
                {staff!.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('gcal.integrations.noStaff', { staffPlural: staffPlural.toLowerCase() })}{' '}
                    {isAdmin && (
                      <Link href="/business/staff" className="text-primary underline-offset-2 hover:underline">
                        {staffPlural}
                      </Link>
                    )}
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {staff!.map((s) => (
                      <li key={s.id} className="grid gap-2 p-3">
                        <p className="text-sm font-medium text-foreground">{s.name}</p>
                        <CalendarConnection
                          compact
                          staffId={s.id}
                          staffName={s.name}
                          connection={status.connections.find((c) => c.staff_id === s.id) ?? null}
                          configured={status.configured}
                          canManage={isAdmin || (!!user && s.member_user_id === user.id)}
                          returnTo="integrations"
                          onChanged={reload}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
