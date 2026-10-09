'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Ban, CheckCircle2, ExternalLink, ImageOff, Loader2, MessageSquare, Phone } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { formatMoney, moneyLocale } from '@/lib/workspace/countries';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { PaymentChip, StatusChip, useMediaSrc } from './chips';
import {
  isClosed,
  nextActions,
  orderErrorMessage,
  type OrderEvent,
  type OrderItem,
  type OrderRow,
  type OrderStatus,
} from './types';

interface Props {
  orderId: string | null;
  /** Bumped by the page when realtime reports a change to this order. */
  refreshKey: number;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

interface Detail extends OrderRow {
  items: OrderItem[];
  events: OrderEvent[];
}

export function OrderDetailSheet({ orderId, refreshKey, onOpenChange, onChanged }: Props) {
  const { t } = useI18n();
  return (
    <Sheet open={!!orderId} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-lg">
        {orderId ? (
          <DetailBody key={orderId} orderId={orderId} refreshKey={refreshKey} onChanged={onChanged} />
        ) : (
          <SheetTitle className="sr-only">{t('orders.detail.title')}</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({ orderId, refreshKey, onChanged }: { orderId: string; refreshKey: number; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const { workspace } = useWorkspace();
  const [order, setOrder] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const defaultNotify = (workspace?.settings?.orders as { notify_status?: boolean } | undefined)?.notify_status !== false;
  const [notify, setNotify] = useState(defaultNotify);
  const [proofOpen, setProofOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orders/${orderId}`, { cache: 'no-store' }).catch(() => null);
    if (!res) return;
    if (res.status === 404) {
      setMissing(true);
      return;
    }
    const body = (await res.json().catch(() => null)) as { order?: OrderRow & { items: OrderItem[]; events: OrderEvent[] } } | null;
    if (!res.ok || !body?.order) return;
    setOrder(body.order);
  }, [orderId]);

  useEffect(() => {
    // Async fetch; state is set after the awaits resolve.
     
    load();
  }, [load, refreshKey]);

  const money = (n: number) => formatMoney(Number(n), order?.currency ?? workspace?.currency ?? 'USD', moneyLocale({ locale, country: workspace?.country }));
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: workspace?.timezone || undefined });

  const post = async (key: string, url: string, body: Record<string, unknown>, success: string) => {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg = orderErrorMessage(t, data.error);
        setError(msg);
        toast.error(msg);
        return false;
      }
      toast.success(success);
      await load();
      onChanged();
      return true;
    } finally {
      setBusy(null);
    }
  };

  const move = (status: OrderStatus) =>
    post(status, `/api/orders/${orderId}/status`, { status, notify }, t('orders.toast.moved', { status: t(`orders.status.${status}`) }));

  const cancel = async () => {
    const ok = await post('cancelled', `/api/orders/${orderId}/status`, { status: 'cancelled', reason: reason.trim() || undefined, notify }, t('orders.toast.cancelled'));
    if (ok) {
      setCancelling(false);
      setReason('');
    }
  };

  const markPaid = () => post('paid', `/api/orders/${orderId}/paid`, { notify }, t('orders.toast.paid'));

  if (missing) {
    return (
      <div className="p-6">
        <SheetTitle>{t('orders.detail.title')}</SheetTitle>
        <p className="mt-4 text-sm text-muted-foreground">{t('orders.errors.not_found')}</p>
      </div>
    );
  }
  if (!order) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <SheetTitle className="sr-only">{t('orders.detail.title')}</SheetTitle>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const actions = nextActions(order.status, order.fulfillment);
  const closed = isClosed(order.status);
  const customer = order.customer_name || order.contact?.name || order.customer_phone || t('orders.detail.noName');
  const phone = order.customer_phone || order.contact?.phone;
  const canNotify = !!order.conversation_id;

  return (
    <div className="flex flex-col">
      <SheetHeader className="border-b border-border pr-12">
        <SheetTitle className="flex flex-wrap items-center gap-2 text-lg">
          {t('orders.detail.heading', { number: order.number })}
          <StatusChip status={order.status} />
          <PaymentChip status={order.payment_status} />
        </SheetTitle>
        <SheetDescription>
          {dateFmt.format(new Date(order.created_at))} · {t(`orders.source.${order.source}`)}
          {order.channel ? ` · ${order.channel.name || t(`orders.channel.${order.channel.type}`)}` : ''}
        </SheetDescription>
      </SheetHeader>

      <div className="grid gap-5 p-4">
        {/* Actions */}
        {!closed && (
          <section aria-label={t('orders.detail.actions')} className="grid gap-3 rounded-lg border border-border p-3">
            <div className="flex flex-wrap gap-2">
              {actions.map((a, i) => (
                <Button key={a.status} variant={i === 0 ? 'default' : 'outline'} size="lg" disabled={!!busy} onClick={() => move(a.status)}>
                  {busy === a.status ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  {t(`orders.actions.${a.key}`)}
                </Button>
              ))}
              {!cancelling && (
                <Button variant="destructive" size="lg" disabled={!!busy} onClick={() => setCancelling(true)}>
                  <Ban className="size-4" />
                  {t('orders.actions.cancel')}
                </Button>
              )}
            </div>
            {cancelling && (
              <div className="grid gap-2">
                <label htmlFor="cancel-reason" className="text-xs font-medium text-muted-foreground">
                  {t('orders.detail.cancelReason')}
                </label>
                <Textarea id="cancel-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('orders.detail.cancelReasonPlaceholder')} />
                <div className="flex gap-2">
                  <Button variant="destructive" disabled={!!busy} onClick={cancel}>
                    {busy === 'cancelled' && <Loader2 className="size-4 animate-spin" />}
                    {t('orders.actions.confirmCancel')}
                  </Button>
                  <Button variant="ghost" disabled={!!busy} onClick={() => setCancelling(false)}>
                    {t('orders.actions.back')}
                  </Button>
                </div>
              </div>
            )}
            <label className={cn('flex items-center gap-2 text-sm', !canNotify && 'opacity-60')}>
              <input type="checkbox" className="size-4 accent-primary" checked={notify && canNotify} disabled={!canNotify} onChange={(e) => setNotify(e.target.checked)} />
              {t('orders.detail.notify')}
            </label>
            {!canNotify && <p className="text-xs text-muted-foreground">{t('orders.detail.noConversation')}</p>}
            {error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </section>
        )}

        {/* Customer */}
        <section className="grid gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('orders.detail.customer')}</h3>
          <p className="font-medium text-foreground">{customer}</p>
          {phone && (
            <a href={`tel:${phone}`} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <Phone className="size-3.5" />
              {phone}
            </a>
          )}
          {order.conversation_id && (
            <Link href={`/inbox?c=${order.conversation_id}`} className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              <MessageSquare className="size-3.5" />
              {t('orders.detail.openConversation')}
            </Link>
          )}
        </section>

        {/* Fulfillment */}
        <section className="grid gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('orders.detail.fulfillment')}</h3>
          <p className="text-sm text-foreground">{t(`orders.fulfillment.${order.fulfillment}`)}</p>
          {order.address && <p className="text-sm text-foreground">{order.address}</p>}
          {order.address_reference && (
            <p className="text-sm text-muted-foreground">
              {t('orders.detail.reference')}: {order.address_reference}
            </p>
          )}
          {order.notes && (
            <p className="mt-1 rounded-md bg-muted/50 px-3 py-2 text-sm text-foreground">
              <span className="font-medium">{t('orders.detail.notes')}:</span> {order.notes}
            </p>
          )}
        </section>

        {/* Items */}
        <section className="grid gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('orders.detail.items')}</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {order.items.map((it) => (
              <li key={it.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="text-foreground">
                    <span className="font-semibold tabular-nums">{it.quantity}×</span> {it.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {money(it.unit_price)}
                    {it.sku ? ` · ${it.sku}` : ''}
                  </p>
                  {it.notes && <p className="text-xs text-muted-foreground">{it.notes}</p>}
                </div>
                <span className="shrink-0 tabular-nums text-foreground">{money(it.total)}</span>
              </li>
            ))}
          </ul>
          <dl className="grid gap-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('orders.detail.subtotal')}</dt>
              <dd className="tabular-nums">{money(order.subtotal)}</dd>
            </div>
            {Number(order.delivery_fee) > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('orders.detail.deliveryFee')}</dt>
                <dd className="tabular-nums">{money(order.delivery_fee)}</dd>
              </div>
            )}
            {Number(order.discount) > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">{t('orders.detail.discount')}</dt>
                <dd className="tabular-nums">−{money(order.discount)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-1 text-base font-semibold">
              <dt>{t('orders.detail.total')}</dt>
              <dd className="tabular-nums">{money(order.total)}</dd>
            </div>
          </dl>
        </section>

        {/* Payment */}
        <section className="grid gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('orders.detail.payment')}</h3>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-foreground">{order.payment_method_name || t('orders.detail.noMethod')}</span>
            <PaymentChip status={order.payment_status} />
            {order.paid_at && <span className="text-xs text-muted-foreground">{dateFmt.format(new Date(order.paid_at))}</span>}
          </div>
          {order.payment_proof_url && <ProofThumb url={order.payment_proof_url} open={proofOpen} onOpenChange={setProofOpen} />}
          {order.payment_status !== 'paid' && order.payment_status !== 'refunded' && order.status !== 'cancelled' && (
            <Button
              variant={order.payment_status === 'proof_received' ? 'default' : 'outline'}
              size="lg"
              className="w-fit"
              disabled={!!busy}
              onClick={markPaid}
            >
              {busy === 'paid' ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {t('orders.actions.markPaid')}
            </Button>
          )}
        </section>

        {/* Timeline */}
        <section className="grid gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('orders.detail.timeline')}</h3>
          <ol className="grid gap-2 border-l border-border pl-4">
            {order.events.map((e) => (
              <li key={e.id} className="relative text-sm">
                <span aria-hidden className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-background bg-primary" />
                <p className="text-foreground">{eventText(t, e)}</p>
                {e.note && e.type !== 'created' && <p className="text-xs text-muted-foreground">“{e.note}”</p>}
                <time className="text-xs text-muted-foreground" dateTime={e.created_at}>
                  {dateFmt.format(new Date(e.created_at))}
                </time>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function eventText(t: (k: string, v?: Record<string, string | number>) => string, e: OrderEvent): string {
  switch (e.type) {
    case 'created':
      return t('orders.timeline.created', { source: t(`orders.source.${e.note ?? 'manual'}`) });
    case 'status':
      return t('orders.timeline.status', { status: t(`orders.status.${e.to_value}`) });
    case 'payment':
      return t('orders.timeline.payment', { status: t(`orders.payment.${e.to_value}`) });
    case 'notified':
      return t('orders.timeline.notified');
    default:
      return e.note ?? e.type;
  }
}

function ProofThumb({ url, open, onOpenChange }: { url: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useI18n();
  const { src, error } = useMediaSrc(url);
  if (error) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ImageOff className="size-4" />
        {t('orders.detail.proofUnavailable')}
      </p>
    );
  }
  if (!src) return <div className="h-32 w-32 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />;
  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="w-fit overflow-hidden rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t('orders.detail.openProof')}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={t('orders.detail.proof')} className="h-40 w-auto max-w-full object-contain" />
      </button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-3xl">
          <DialogTitle>{t('orders.detail.proof')}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={t('orders.detail.proof')} className="mx-auto max-h-[78vh] w-auto object-contain" />
          <a href={src} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            <ExternalLink className="size-3.5" />
            {t('orders.detail.openNewTab')}
          </a>
        </DialogContent>
      </Dialog>
    </>
  );
}
