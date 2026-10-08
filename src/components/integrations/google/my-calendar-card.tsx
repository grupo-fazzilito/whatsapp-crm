'use client';

import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CalendarConnection } from './calendar-connection';
import { GcalReturnToast } from './return-toast';
import { useGcalStatus } from './use-gcal';

/** Settings → Profile: the signed-in member's own Google Calendar (via their linked staff row). */
export function MyGoogleCalendarCard() {
  const t = useT();
  const { label, modules } = useWorkspace();
  const { status, reload } = useGcalStatus();

  if (!modules.staff) return null;
  const bookings = label('bookingPlural').toLowerCase();
  const staff = label('staff').toLowerCase();

  return (
    <Card>
      <Suspense fallback={null}>
        <GcalReturnToast onConnected={reload} />
      </Suspense>
      <CardHeader>
        <CardTitle>{t('gcal.my.title')}</CardTitle>
        <CardDescription>{t('gcal.my.description', { bookings })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!status ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t('gcal.loading')}
          </p>
        ) : !status.my_staff ? (
          <p className="text-sm text-muted-foreground">
            {t('gcal.my.notLinked', { staff, staffPlural: label('staffPlural') })}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t('gcal.my.linkedAs', { staff, name: status.my_staff.name })}</p>
            <CalendarConnection
              staffId={status.my_staff.id}
              staffName={status.my_staff.name}
              connection={status.connections.find((c) => c.staff_id === status.my_staff!.id) ?? null}
              configured={status.configured}
              canManage
              returnTo="profile"
              onChanged={reload}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
