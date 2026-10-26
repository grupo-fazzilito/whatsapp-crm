'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, KeyRound, ListChecks, Loader2, Pencil, Plus, RefreshCw, Send, Trash2, Webhook } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { api } from '@/components/business/api';
import { cn } from '@/lib/utils';
import { WEBHOOK_EVENT_GROUPS, WEBHOOK_HEADERS, eventI18nKey } from '@/lib/webhooks/events';
import { CodeSample, SecretDialog } from './secret-dialog';

interface Endpoint {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  failure_count: number;
  disabled_at: string | null;
  disabled_reason: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
}

type DeliveryStatus = 'pending' | 'delivered' | 'failed';

interface Delivery {
  id: string;
  event_type: string;
  payload: unknown;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: string | null;
  response_status: number | null;
  response_body: string | null;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
}

interface Attempt {
  delivered: boolean;
  status: number | null;
  durationMs: number;
  error?: string;
}

const DELIVERY_FILTERS = ['all', 'pending', 'delivered', 'failed'] as const;
type DeliveryFilter = (typeof DELIVERY_FILTERS)[number];

const DELIVERY_CLS: Record<DeliveryStatus, string> = {
  pending: 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  delivered: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  failed: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
};

/** i18n text for an API error code, falling back to the generic one. */
function useErrorText() {
  const { t } = useI18n();
  return useCallback(
    (err: unknown) => {
      const code = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      const key = `integrations.webhooks.errors.${code}`;
      const msg = t(key);
      return msg === key ? t('integrations.webhooks.errors.generic') : msg;
    },
    [t],
  );
}

/** Settings → Integrations: the workspace's outgoing webhooks (signed POSTs with retries). */
export function WebhooksCard() {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const [endpoints, setEndpoints] = useState<Endpoint[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Endpoint | 'new' | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'rotate' | 'delete'; endpoint: Endpoint } | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<Endpoint | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', { dateStyle: 'medium', timeStyle: 'short' });

  const load = useCallback(async () => {
    try {
      const body = await api<{ endpoints: Endpoint[] }>('/api/integrations/webhooks');
      setEndpoints(body.endpoints);
      setFailed(false);
    } catch {
      setFailed(true);
      setEndpoints((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
     
    void load();
  }, [load]);

  const replace = (ep: Endpoint) => setEndpoints((list) => (list ?? []).map((e) => (e.id === ep.id ? ep : e)));

  const toggleActive = async (ep: Endpoint) => {
    setToggling(ep.id);
    try {
      const body = await api<{ endpoint: Endpoint }>(`/api/integrations/webhooks/${ep.id}`, { method: 'PATCH', body: { active: !ep.active } });
      replace(body.endpoint);
      toast.success(t('integrations.webhooks.saved'));
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setToggling(null);
    }
  };

  const sendTest = async (ep: Endpoint) => {
    setTesting(ep.id);
    try {
      const { result } = await api<{ result: Attempt }>(`/api/integrations/webhooks/${ep.id}/test`, { method: 'POST' });
      if (result.delivered) toast.success(t('integrations.webhooks.testOk', { status: result.status ?? '—', ms: result.durationMs }));
      else toast.error(t('integrations.webhooks.testFail', { error: result.error ?? `HTTP ${result.status ?? '—'}` }));
      void load();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setTesting(null);
    }
  };

  const runConfirm = async () => {
    if (!confirm) return;
    const { kind, endpoint } = confirm;
    try {
      if (kind === 'rotate') {
        const body = await api<{ secret: string }>(`/api/integrations/webhooks/${endpoint.id}/rotate-secret`, { method: 'POST' });
        setSecret(body.secret);
      } else {
        await api(`/api/integrations/webhooks/${endpoint.id}`, { method: 'DELETE' });
        setEndpoints((list) => (list ?? []).filter((e) => e.id !== endpoint.id));
        toast.success(t('integrations.webhooks.deleted'));
      }
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const eventsSummary = (events: string[]) =>
    events.includes('*') ? t('integrations.webhooks.allEventsShort') : t('integrations.webhooks.eventsCount', { count: events.length });

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 sm:flex-nowrap">
        <div className="min-w-0 space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <Webhook className="size-5 text-primary" aria-hidden />
            {t('integrations.webhooks.title')}
          </CardTitle>
          <CardDescription>{t('integrations.webhooks.description')}</CardDescription>
        </div>
        <Button className="shrink-0" onClick={() => setEditing('new')}>
          <Plus className="size-4" aria-hidden />
          {t('integrations.webhooks.add')}
        </Button>
      </CardHeader>
      <CardContent>
        {failed && <p role="alert" className="mb-3 text-sm text-destructive">{t('integrations.common.error')}</p>}
        {!endpoints ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('integrations.common.loading')} />
          </div>
        ) : endpoints.length === 0 ? (
          !failed && <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('integrations.webhooks.empty')}</p>
        ) : (
          <ul className="grid gap-3">
            {endpoints.map((ep) => {
              const statusLine = ep.active
                ? ep.failure_count > 0
                  ? t('integrations.webhooks.failures', { count: ep.failure_count })
                  : null
                : ep.disabled_reason === 'consecutive_failures'
                  ? t('integrations.webhooks.autoDisabled')
                  : null;
              return (
                <li key={ep.id} className="rounded-lg border border-border p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="break-all font-mono text-sm font-medium text-foreground">{ep.url}</p>
                      {ep.description && <p className="mt-0.5 text-sm text-muted-foreground">{ep.description}</p>}
                    </div>
                    <Switch
                      checked={ep.active}
                      disabled={toggling === ep.id}
                      onCheckedChange={() => void toggleActive(ep)}
                      aria-label={t(ep.active ? 'integrations.webhooks.disable' : 'integrations.webhooks.enable')}
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline" className={ep.active ? DELIVERY_CLS.delivered : 'border-border bg-muted text-muted-foreground'}>
                      {t(ep.active ? 'integrations.webhooks.active' : 'integrations.webhooks.disabled')}
                    </Badge>
                    {statusLine && <span className={ep.active ? 'text-amber-800 dark:text-amber-300' : 'text-destructive'}>{statusLine}</span>}
                    <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">{eventsSummary(ep.events)}</span>
                  </div>

                  <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    <div className="flex gap-1">
                      <dt>{t('integrations.webhooks.lastSuccess')}:</dt>
                      <dd className="text-foreground">{ep.last_success_at ? fmt.format(new Date(ep.last_success_at)) : t('integrations.common.never')}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>{t('integrations.webhooks.lastFailure')}:</dt>
                      <dd className="text-foreground">{ep.last_failure_at ? fmt.format(new Date(ep.last_failure_at)) : t('integrations.common.never')}</dd>
                    </div>
                  </dl>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(ep)}>
                      <Pencil className="size-3.5" aria-hidden />
                      {t('integrations.webhooks.edit')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void sendTest(ep)} disabled={testing === ep.id || !ep.active}>
                      {testing === ep.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
                      {t('integrations.webhooks.test')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setDeliveriesFor(ep)}>
                      <ListChecks className="size-3.5" aria-hidden />
                      {t('integrations.webhooks.deliveries')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setConfirm({ kind: 'rotate', endpoint: ep })}>
                      <KeyRound className="size-3.5" aria-hidden />
                      {t('integrations.webhooks.rotate')}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => setConfirm({ kind: 'delete', endpoint: ep })}>
                      <Trash2 className="size-3.5" aria-hidden />
                      {t('integrations.webhooks.delete')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <EndpointDialog
        key={editing === 'new' ? 'new' : (editing?.id ?? 'closed')}
        target={editing}
        onClose={() => setEditing(null)}
        onSaved={(ep, newSecret) => {
          setEditing(null);
          if (newSecret) {
            setEndpoints((list) => [...(list ?? []), ep]);
            setSecret(newSecret);
          } else {
            replace(ep);
          }
          toast.success(t('integrations.webhooks.saved'));
        }}
      />

      <SecretDialog
        secret={secret}
        title={t('integrations.webhooks.secretTitle')}
        body={t('integrations.webhooks.secretBody')}
        label={t('integrations.webhooks.secretTitle')}
        onClose={() => setSecret(null)}
      >
        <CodeSample
          title={t('integrations.webhooks.verifyTitle')}
          body={t('integrations.webhooks.verifyBody')}
          code={`${WEBHOOK_HEADERS.signature}: t=<t>,v1=<hex>\nv1 == HMAC_SHA256(secret, "<t>.<raw body>")`}
        />
      </SecretDialog>

      <ConfirmationDialog
        isOpen={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t(confirm?.kind === 'rotate' ? 'integrations.webhooks.rotateTitle' : 'integrations.webhooks.deleteTitle')}
        description={t(confirm?.kind === 'rotate' ? 'integrations.webhooks.rotateBody' : 'integrations.webhooks.deleteBody')}
        confirmText={t(confirm?.kind === 'rotate' ? 'integrations.webhooks.rotate' : 'integrations.webhooks.delete')}
        cancelText={t('integrations.common.cancel')}
        onConfirm={runConfirm}
        variant={confirm?.kind === 'delete' ? 'destructive' : 'default'}
      />

      <DeliveriesDialog endpoint={deliveriesFor} onClose={() => setDeliveriesFor(null)} />
    </Card>
  );
}

// ------------------------------------------------------------
// Create / edit
// ------------------------------------------------------------

function EndpointDialog({
  target,
  onClose,
  onSaved,
}: {
  target: Endpoint | 'new' | null;
  onClose: () => void;
  onSaved: (ep: Endpoint, secret?: string) => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const existing = target && target !== 'new' ? target : null;
  const [url, setUrl] = useState(existing?.url ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [all, setAll] = useState(existing ? existing.events.includes('*') : false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(existing && !existing.events.includes('*') ? existing.events : []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const baseId = useId();

  const toggle = (events: readonly string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const e of events) {
        if (on) next.add(e);
        else next.delete(e);
      }
      return next;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const events = all ? ['*'] : [...selected];
    if (!events.length) return setError(errorText('events_required'));
    setBusy(true);
    try {
      const body = await api<{ endpoint: Endpoint; secret?: string }>(existing ? `/api/integrations/webhooks/${existing.id}` : '/api/integrations/webhooks', {
        method: existing ? 'PATCH' : 'POST',
        body: { url: url.trim(), description: description.trim(), events },
      });
      onSaved(body.endpoint, body.secret);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{t(existing ? 'integrations.webhooks.editTitle' : 'integrations.webhooks.addTitle')}</DialogTitle>
            <DialogDescription>{t('integrations.webhooks.description')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <label htmlFor={`${baseId}-url`} className="text-sm font-medium text-foreground">
                {t('integrations.webhooks.url')}
              </label>
              <Input
                id={`${baseId}-url`}
                type="url"
                inputMode="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://"
                aria-describedby={`${baseId}-url-hint`}
                autoFocus
              />
              <p id={`${baseId}-url-hint`} className="text-xs text-muted-foreground">
                {t('integrations.webhooks.urlHint')}
              </p>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={`${baseId}-desc`} className="text-sm font-medium text-foreground">
                {t('integrations.webhooks.descriptionLabel')}
              </label>
              <Input id={`${baseId}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
            </div>

            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-foreground">{t('integrations.webhooks.events')}</legend>
              <label className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2.5 text-sm font-medium text-foreground has-checked:border-primary has-checked:bg-primary/5">
                <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="size-4 accent-primary" />
                {t('integrations.webhooks.allEvents')}
              </label>

              {!all && (
                <div className="mt-3 grid gap-2">
                  {WEBHOOK_EVENT_GROUPS.map((g) => {
                    const on = g.events.filter((e) => selected.has(e)).length;
                    const groupName = t(`integrations.eventGroups.${g.key}`);
                    return (
                      <fieldset key={g.key} className="rounded-md border border-border px-3 py-2.5">
                        <legend className="sr-only">{groupName}</legend>
                        <label className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={on === g.events.length}
                            ref={(el) => {
                              if (el) el.indeterminate = on > 0 && on < g.events.length;
                            }}
                            onChange={(e) => toggle(g.events, e.target.checked)}
                            className="size-4 accent-primary"
                          />
                          <span className="text-sm font-semibold text-foreground">{groupName}</span>
                          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                            {on}/{g.events.length}
                          </span>
                        </label>
                        <div className="mt-1.5 grid gap-1 pl-6">
                          {g.events.map((ev) => (
                            <label key={ev} className="flex items-center gap-2.5 text-sm text-foreground">
                              <input type="checkbox" checked={selected.has(ev)} onChange={(e) => toggle([ev], e.target.checked)} className="size-4 accent-primary" />
                              <span className="min-w-0">
                                {t(`integrations.events.${eventI18nKey(ev)}`)}
                                <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{ev}</span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    );
                  })}
                </div>
              )}
            </fieldset>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t('integrations.common.cancel')}
            </Button>
            <Button type="submit" disabled={busy || !url.trim()}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('integrations.common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// Deliveries
// ------------------------------------------------------------

function DeliveriesDialog({ endpoint, onClose }: { endpoint: Endpoint | null; onClose: () => void }) {
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const [filter, setFilter] = useState<DeliveryFilter>('all');
  const [rows, setRows] = useState<Delivery[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', { dateStyle: 'short', timeStyle: 'medium' });
  const endpointId = endpoint?.id ?? null;

  const load = useCallback(async () => {
    if (!endpointId) return;
    try {
      const body = await api<{ deliveries: Delivery[] }>(`/api/integrations/webhooks/${endpointId}/deliveries${filter === 'all' ? '' : `?status=${filter}`}`);
      setRows(body.deliveries);
      setFailed(false);
    } catch {
      setFailed(true);
      setRows([]);
    }
  }, [endpointId, filter]);

  useEffect(() => {
    if (!endpointId) return;
     
    setRows(null);
    void load();
  }, [endpointId, load]);

  const close = () => {
    onClose();
    setFilter('all');
    setExpanded(null);
    setRows(null);
  };

  const resend = async (d: Delivery) => {
    setResending(d.id);
    try {
      const { result } = await api<{ result: Attempt }>(`/api/integrations/webhooks/deliveries/${d.id}/resend`, { method: 'POST' });
      if (result.delivered) toast.success(t('integrations.deliveries.resent', { status: result.status ?? '—' }));
      else toast.error(t('integrations.deliveries.resendFailed', { error: result.error ?? `HTTP ${result.status ?? '—'}` }));
      void load();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setResending(null);
    }
  };

  const eventLabel = (type: string) => {
    const key = `integrations.events.${eventI18nKey(type)}`;
    const label = t(key);
    return label === key ? type : label;
  };

  return (
    <Dialog open={!!endpoint} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('integrations.deliveries.title')}</DialogTitle>
          <DialogDescription className="break-all">{endpoint ? t('integrations.deliveries.description', { url: endpoint.url }) : ''}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label={t('integrations.deliveries.status')} className="flex flex-wrap gap-2">
            {DELIVERY_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  filter === f ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {f === 'all' ? t('integrations.deliveries.filterAll') : t(`integrations.deliveries.statuses.${f}`)}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => void load()} aria-label={t('integrations.deliveries.refresh')}>
            <RefreshCw className="size-3.5" aria-hidden />
          </Button>
        </div>

        {!rows ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('integrations.common.loading')} />
          </div>
        ) : failed ? (
          <p role="alert" className="text-sm text-destructive">
            {t('integrations.common.error')}
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('integrations.deliveries.empty')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((d) => {
              const open = expanded === d.id;
              const panelId = `delivery-${d.id}`;
              return (
                <li key={d.id}>
                  <div className="flex items-start gap-2 px-3 py-2.5">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => setExpanded(open ? null : d.id)}
                      className="flex min-w-0 flex-1 items-start gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {open ? <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{eventLabel(d.event_type)}</span>
                          <Badge variant="outline" className={DELIVERY_CLS[d.status]}>
                            {t(`integrations.deliveries.statuses.${d.status}`)}
                          </Badge>
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground tabular-nums">
                          {fmt.format(new Date(d.created_at))} · {d.response_status !== null ? `HTTP ${d.response_status}` : t('integrations.deliveries.noResponse')}
                          {d.duration_ms !== null && ` · ${d.duration_ms} ms`} · {t('integrations.deliveries.attempts')}: {d.attempts}
                        </span>
                        {d.status === 'pending' && d.next_attempt_at && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {t('integrations.deliveries.nextAttempt', { when: fmt.format(new Date(d.next_attempt_at)) })}
                          </span>
                        )}
                      </span>
                    </button>
                    {endpoint?.active && (
                      <Button variant="outline" size="sm" onClick={() => void resend(d)} disabled={resending === d.id} className="shrink-0">
                        {resending === d.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
                        {t('integrations.deliveries.resend')}
                      </Button>
                    )}
                  </div>
                  {open && (
                    <div id={panelId} className="grid gap-3 px-3 pb-3">
                      {d.error && <p className="break-all text-xs text-destructive">{d.error}</p>}
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('integrations.deliveries.payload')}</p>
                        <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-muted p-2.5 font-mono text-[11px] leading-relaxed text-foreground">{JSON.stringify(d.payload, null, 2)}</pre>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('integrations.deliveries.responseBody')}</p>
                        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
                          {d.response_body || '—'}
                        </pre>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
