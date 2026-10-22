'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
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
 * Settings → Integrations: Google Calendar for each person of the team who
 * takes bookings (bookings become events, busy times block the schedule).
 */
export function GoogleCalendarCard() {
  const t = useT();
  const { user } = useAuth();
  const { workspace, label, modules, can } = useWorkspace();
  const isAdmin = can('admin');
  const { status, reload } = useGcalStatus();
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const enabled = modules.staff && modules.bookings;

  useEffect(() => {
    if (!workspace || !enabled) return;
    let cancelled = false;
    fetch('/api/business/staff', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { staff: [] }))
      .catch(() => ({ staff: [] }))
      .then((d: { staff?: StaffRow[] }) => !cancelled && setStaff(d.staff ?? []));
    return () => {
      cancelled = true;
    };
  }, [workspace, enabled]);

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
        ) : !status || staff === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t('gcal.loading')}
          </p>
        ) : !status.configured ? (
          <p className="text-sm text-muted-foreground">{t('gcal.notConfigured')}</p>
        ) : staff.length === 0 ? (
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
            {staff.map((s) => (
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
      </CardContent>
    </Card>
  );
}
