'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { CalendarClock, CheckCircle2, ExternalLink, Loader2, RefreshCw, Unplug } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface EventType {
  id: string;
  name: string;
  duration_minutes: number | null;
  active: boolean;
  scheduling_url: string | null;
  service_id: string | null;
  staff_id: string | null;
}

interface Status {
  configured: boolean;
  connection: {
    email: string | null;
    name: string | null;
    scheduling_url: string | null;
    status: 'active' | 'error' | 'revoked';
    last_error: string | null;
    can_book: boolean | null;
    webhook_active: boolean;
    webhooks_available: boolean | null;
    last_synced_at: string | null;
  } | null;
  event_types: EventType[];
  services: { id: string; name: string }[];
  staff: { id: string; name: string }[];
}

const START_HREF = '/api/integrations/calendly/start';

const selectCls = 'h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Settings → Integrations: connect the business's Calendly and link each event type to a service. */
export function CalendlyCard() {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  const [data, setData] = useState<Status | null>(null);
  const [map, setMap] = useState<Record<string, { service_id: string; staff_id: string }>>({});
  const [busy, setBusy] = useState<'save' | 'refresh' | 'disconnect' | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/integrations/calendly/status', { cache: 'no-store' }).catch(() => null);
    if (!res?.ok) return;
    const d: Status = await res.json();
    setData(d);
    setMap(Object.fromEntries(d.event_types.map((e) => [e.id, { service_id: e.service_id ?? '', staff_id: e.staff_id ?? '' }])));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);

  // Back from Calendly: ?calendly=connected|error&reason=…
  useEffect(() => {
    const result = params.get('calendly');
    if (!result) return;
    if (result === 'connected') toast.success(t('calendly.connected'));
    else toast.error(t(`calendly.errors.${params.get('reason') === 'denied' ? 'denied' : 'generic'}`));
    const next = new URLSearchParams(params.toString());
    next.delete('calendly');
    next.delete('reason');
    router.replace(`/settings?${next.toString()}`);
  }, [params, router, t]);

  const save = async () => {
    setBusy('save');
    const res = await fetch('/api/integrations/calendly/event-types', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings: Object.entries(map).map(([id, m]) => ({ id, service_id: m.service_id || null, staff_id: m.staff_id || null })) }),
    }).catch(() => null);
    setBusy(null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok) toast.success(t('calendly.saved'));
    else toast.error(body.error === 'service_used_twice' ? t('calendly.errors.serviceTwice') : t('calendly.errors.generic'));
  };

  const refresh = async () => {
    setBusy('refresh');
    await fetch('/api/integrations/calendly/event-types', { method: 'POST' }).catch(() => null);
    await load();
    setBusy(null);
  };

  const disconnect = async () => {
    if (!window.confirm(t('calendly.disconnectConfirm'))) return;
    setBusy('disconnect');
    await fetch('/api/integrations/calendly/disconnect', { method: 'POST' }).catch(() => null);
    await load();
    setBusy(null);
  };

  const c = data?.connection;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-5 text-primary" aria-hidden /> Calendly
        </CardTitle>
        <CardDescription>{t('calendly.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!data ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('common.loading')} />
        ) : !data.configured ? (
          <p className="text-sm text-muted-foreground">{t('calendly.notAvailable')}</p>
        ) : !c ? (
          <div className="space-y-3">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>{t('calendly.how1')}</li>
              <li>{t('calendly.how2')}</li>
              <li>{t('calendly.how3')}</li>
            </ul>
            <a href={START_HREF} className={buttonVariants()}>
              {t('calendly.connect')}
            </a>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="size-4 text-emerald-600" aria-hidden /> {c.name || c.email}
              </span>
              {c.email && <span className="text-muted-foreground">{c.email}</span>}
              {c.status !== 'active' && <Badge variant="destructive">{t(`calendly.status.${c.status}`)}</Badge>}
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t('calendly.booking')}</dt>
                <dd>{c.can_book === false ? t('calendly.bookingLink') : c.can_book ? t('calendly.bookingDirect') : t('calendly.bookingUnknown')}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('calendly.updates')}</dt>
                <dd>{c.webhook_active ? t('calendly.updatesInstant') : t('calendly.updatesPolling')}</dd>
              </div>
            </dl>
            {c.status === 'revoked' && (
              <a href={START_HREF} className={buttonVariants({ variant: 'outline' })}>
                {t('calendly.reconnect')}
              </a>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t('calendly.mapTitle')}</h3>
              <p className="text-sm text-muted-foreground">{t('calendly.mapHelp')}</p>
              {data.event_types.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('calendly.noEventTypes')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th scope="col" className="py-2 pr-3 font-medium">{t('calendly.eventType')}</th>
                        <th scope="col" className="py-2 pr-3 font-medium">{t('calendly.service')}</th>
                        <th scope="col" className="py-2 font-medium">{t('calendly.staff')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.event_types.map((e) => (
                        <tr key={e.id} className="border-b last:border-0">
                          <td className="py-2 pr-3">
                            <span className="font-medium">{e.name}</span>
                            {e.duration_minutes ? <span className="text-muted-foreground"> · {e.duration_minutes} min</span> : null}
                            {!e.active && <Badge variant="secondary" className="ml-2">{t('calendly.inactive')}</Badge>}
                          </td>
                          <td className="py-2 pr-3">
                            <label className="sr-only" htmlFor={`cal-svc-${e.id}`}>{t('calendly.service')} · {e.name}</label>
                            <select id={`cal-svc-${e.id}`} className={selectCls} value={map[e.id]?.service_id ?? ''} onChange={(ev) => setMap((m) => ({ ...m, [e.id]: { ...m[e.id], service_id: ev.target.value } }))}>
                              <option value="">{t('calendly.notUsed')}</option>
                              {data.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </td>
                          <td className="py-2">
                            <label className="sr-only" htmlFor={`cal-staff-${e.id}`}>{t('calendly.staff')} · {e.name}</label>
                            <select id={`cal-staff-${e.id}`} className={selectCls} value={map[e.id]?.staff_id ?? ''} onChange={(ev) => setMap((m) => ({ ...m, [e.id]: { ...m[e.id], staff_id: ev.target.value } }))}>
                              <option value="">{t('calendly.anyStaff')}</option>
                              {data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={busy !== null || data.event_types.length === 0}>
                {busy === 'save' && <Loader2 className="size-4 animate-spin" aria-hidden />} {t('calendly.save')}
              </Button>
              <Button variant="outline" onClick={refresh} disabled={busy !== null}>
                <RefreshCw className={busy === 'refresh' ? 'size-4 animate-spin' : 'size-4'} aria-hidden /> {t('calendly.refresh')}
              </Button>
              {c.scheduling_url && (
                <a href={c.scheduling_url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'ghost' })}>
                  {t('calendly.open')} <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
              <Button variant="ghost" className="ml-auto text-destructive" onClick={disconnect} disabled={busy !== null}>
                <Unplug className="size-4" aria-hidden /> {t('calendly.disconnect')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
