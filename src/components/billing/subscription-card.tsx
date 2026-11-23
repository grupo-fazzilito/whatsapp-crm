'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CreditCard, ExternalLink, Loader2, Repeat } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatUsdCents, monthlyCents, type SubscriptionPricing } from '@/lib/billing/subscription-pricing';
import { TokenSlider } from './token-slider';

export interface SubscriptionView {
  tokens: number;
  price_cents: number;
  currency: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

const ACTIVE = new Set(['active', 'trialing', 'past_due']);

/** Settings → Tokens: subscribe to a monthly quota, change it, or manage the card / cancel in Stripe. */
export function SubscriptionCard({
  pricing,
  subscription,
  ready,
  isAdmin = true,
  onChanged,
}: {
  pricing: SubscriptionPricing;
  subscription: SubscriptionView | null;
  ready: boolean;
  isAdmin?: boolean;
  onChanged: () => void;
}) {
  const { t, locale } = useI18n();
  const active = !!subscription && ACTIVE.has(subscription.status);
  const [tokens, setTokens] = useState<number>(active ? subscription!.tokens : pricing.step_tokens * 5 <= pricing.max_tokens ? pricing.step_tokens * 5 : pricing.step_tokens);
  const [busy, setBusy] = useState<'subscribe' | 'portal' | null>(null);
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE');
  const date = (iso: string) => new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', { dateStyle: 'medium' }).format(new Date(iso));
  const changed = active && tokens !== subscription!.tokens;
  const upgrade = active && tokens > subscription!.tokens;

  const go = async () => {
    setBusy('subscribe');
    const res = await fetch('/api/billing/subscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tokens }) });
    const body = (await res.json().catch(() => ({}))) as { url?: string | null; error?: string };
    setBusy(null);
    if (!res.ok) {
      const key = `subscription.errors.${body.error ?? 'generic'}`;
      const msg = t(key);
      toast.error(msg === key ? t('subscription.errors.generic') : msg);
      return;
    }
    if (body.url) {
      window.location.assign(body.url);
      return;
    }
    toast.success(upgrade ? t('subscription.upgraded') : t('subscription.downgraded'));
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
          </div>
        )}

        {!ready ? (
          <p className="text-sm text-muted-foreground">{t('subscription.notReady')}</p>
        ) : (
          <>
            <TokenSlider pricing={pricing} value={tokens} onChange={setTokens} />
            {active && changed && (
              <p className="text-xs text-muted-foreground">{upgrade ? t('subscription.upgradeNote') : t('subscription.downgradeNote')}</p>
            )}
            {isAdmin && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void go()} disabled={!!busy || (active && !changed && !subscription!.cancel_at_period_end)}>
                  {busy === 'subscribe' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CreditCard className="size-4" aria-hidden />}
                  {active
                    ? changed
                      ? t('subscription.change', { price: formatUsdCents(monthlyCents(tokens, pricing)) })
                      : subscription!.cancel_at_period_end
                        ? t('subscription.resume')
                        : t('subscription.currentPlan')
                    : t('subscription.subscribe', { price: formatUsdCents(monthlyCents(tokens, pricing)) })}
                </Button>
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
