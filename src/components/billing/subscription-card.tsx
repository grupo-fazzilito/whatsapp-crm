'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CreditCard, ExternalLink, Loader2, Repeat, Save } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { defaultOverageLimit, formatUsdCents, monthlyCents, type SubscriptionPricing } from '@/lib/billing/subscription-pricing';
import { OverageLimit } from './overage-limit';

export interface SubscriptionView {
  tokens: number;
  price_cents: number;
  currency: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  overage_limit: number;
}

export interface OverageView {
  limit: number;
  credits: number;
  cents: number;
}

const ACTIVE = new Set(['active', 'trialing', 'past_due']);

/**
 * Settings → Billing: the plan (US$ 9.90 for 1,000 credits a month, unlimited
 * accounts), the extra-credit limit, and the card / cancellation in Stripe.
 */
export function SubscriptionCard({
  pricing,
  subscription,
  overage,
  ready,
  isAdmin = true,
  onChanged,
}: {
  pricing: SubscriptionPricing;
  subscription: SubscriptionView | null;
  overage: OverageView | null;
  ready: boolean;
  isAdmin?: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const active = !!subscription && ACTIVE.has(subscription.status);
  const savedLimit = active ? subscription!.overage_limit : defaultOverageLimit(pricing);
  const [limit, setLimit] = useState<number>(savedLimit);
  const [busy, setBusy] = useState<'subscribe' | 'portal' | 'limit' | null>(null);
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE');
  const date = (iso: string) => new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', { dateStyle: 'medium' }).format(new Date(iso));
  const price = formatUsdCents(monthlyCents(pricing.step_tokens, pricing));

  const fail = async (res: Response) => {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const key = `subscription.errors.${body.error ?? 'generic'}`;
    const msg = t(key);
    toast.error(msg === key ? t('subscription.errors.generic') : msg);
  };

  const go = async () => {
    setBusy('subscribe');
    const res = await fetch('/api/billing/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overage_limit: limit }) });
    setBusy(null);
    if (!res.ok) return fail(res);
    const body = (await res.json().catch(() => ({}))) as { url?: string | null };
    if (body.url) {
      window.location.assign(body.url);
      return;
    }
    toast.success(t('subscription.resumed'));
    onChanged();
  };

  const saveLimit = async () => {
    setBusy('limit');
    const res = await fetch('/api/billing/subscription', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overage_limit: limit }) });
    setBusy(null);
    if (!res.ok) return fail(res);
    toast.success(t('subscription.overage.saved'));
    onChanged();
  };

  const portal = async () => {
    setBusy('portal');
    const res = await fetch('/api/billing/subscription/portal', { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as { url?: string };
    setBusy(null);
    if (body.url) window.location.assign(body.url);
    else toast.error(t('subscription.errors.generic'));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Repeat className="size-5 text-primary" aria-hidden /> {t('subscription.title')}
        </CardTitle>
        <CardDescription>{t('subscription.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t('subscription.plan', { n: nf.format(pricing.step_tokens) })}</p>
            <p className="text-xs text-muted-foreground">{t('subscription.planIncludes')}</p>
          </div>
          <p className="text-xl font-bold text-foreground">
            {price} <span className="text-sm font-normal text-muted-foreground">{t('subscription.perMonth')}</span>
          </p>
        </div>

        {subscription && (
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <p className="font-medium text-foreground">
              {t('subscription.current', { n: nf.format(subscription.tokens), price: formatUsdCents(subscription.price_cents) })}
            </p>
            <p className="text-muted-foreground">
              {subscription.status === 'past_due'
                ? t('subscription.status.pastDue')
                : !active
                  ? t('subscription.status.canceled')
                  : subscription.cancel_at_period_end && subscription.current_period_end
                    ? t('subscription.status.endsOn', { date: date(subscription.current_period_end) })
                    : subscription.current_period_end
                      ? t('subscription.status.renewsOn', { date: date(subscription.current_period_end) })
                      : t('subscription.status.active')}
            </p>
            {active && overage && (
              <p className="mt-1 text-muted-foreground">
                {overage.credits > 0
                  ? t('subscription.overage.used', { n: nf.format(overage.credits), price: formatUsdCents(overage.cents) })
                  : t('subscription.overage.none')}
              </p>
            )}
          </div>
        )}

        {!ready ? (
          <p className="text-sm text-muted-foreground">{t('subscription.notReady')}</p>
        ) : (
          <>
            <OverageLimit pricing={pricing} value={limit} onChange={setLimit} disabled={!isAdmin || !!busy} />
            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                {active ? (
                  <>
                    <Button onClick={() => void saveLimit()} disabled={!!busy || limit === savedLimit}>
                      {busy === 'limit' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                      {t('subscription.overage.save')}
                    </Button>
                    {subscription!.cancel_at_period_end && (
                      <Button variant="outline" onClick={() => void go()} disabled={!!busy}>
                        {busy === 'subscribe' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CreditCard className="size-4" aria-hidden />}
                        {t('subscription.resume')}
                      </Button>
                    )}
                  </>
                ) : (
                  <Button onClick={() => void go()} disabled={!!busy}>
                    {busy === 'subscribe' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CreditCard className="size-4" aria-hidden />}
                    {t('subscription.subscribe', { price })}
                  </Button>
                )}
                {subscription && (
                  <Button variant="outline" onClick={() => void portal()} disabled={!!busy}>
                    {busy === 'portal' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ExternalLink className="size-4" aria-hidden />}
                    {t('subscription.manage')}
                  </Button>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t('subscription.terms')}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
