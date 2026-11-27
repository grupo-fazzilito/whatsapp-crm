'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Coins, Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { BILLABLE_ACTIONS } from '@/lib/billing/pricing';
import { SubscriptionCard } from './subscription-card';
import { useBillingData } from './billing-data';

/** Settings → Tokens: the balance, the plan that gives them, and what each action costs. Invoices live in Settings → Billing. */
export function BillingPanel() {
  const { t, locale } = useI18n();
  const { data, loading, load } = useBillingData();

  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE');
  const date = (iso: string, withTime = false) =>
    new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(iso));

  // Back from Stripe's subscription checkout: the webhook grants the tokens within seconds.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('subscribed') !== '1') return;
    url.searchParams.delete('subscribed');
    window.history.replaceState(null, '', url);
    toast.success(t('subscription.subscribed'));
    const timer = setTimeout(() => void load(), 4000);
    return () => clearTimeout(timer);
  }, [load, t]);

  // Back from Stripe's checkout (?paid=<payment id>): confirm that payment right away.
  useEffect(() => {
    const url = new URL(window.location.href);
    const paid = url.searchParams.get('paid');
    if (!paid || !/^[0-9a-f-]{36}$/i.test(paid)) return;
    url.searchParams.delete('paid');
    window.history.replaceState(null, '', url);
    void fetch(`/api/billing/payments/${paid}/sync`, { method: 'POST' })
      .then((res) => res.json().catch(() => ({})))
      .then((body: { payment?: { status?: string } }) => {
        if (body.payment?.status === 'paid') toast.success(t('billing.payments.paidToast'));
        void load();
      });
  }, [load, t]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
      </div>
    );
  }
  if (!data) return <p className="text-sm text-red-600">{t('billing.errors.generic')}</p>;

  const s = data.settings;
  const replyCost = s.action_costs.reply || 1;
  const depleted = s.enforce && data.balance < replyCost;
  const low = !depleted && data.balance <= s.low_credit_threshold;
  return (
    <div className="space-y-6">
      {/* Balance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="size-5 text-primary" aria-hidden /> {t('billing.title')}
          </CardTitle>
          <CardDescription>{t('billing.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            {t('billing.plan.label')} <Badge variant="secondary">{data.plan.name}</Badge>
            {data.plan.price === 0 && <span className="text-xs text-slate-500 dark:text-slate-400">{t('billing.plan.free')}</span>}
          </p>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('billing.balance')}</p>
              <p className={cn('text-4xl font-bold tabular-nums', depleted ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white')}>
                {nf.format(data.balance)}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('billing.approxReplies', { n: nf.format(Math.floor(data.balance / replyCost)) })}</p>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {data.next_expiry
                ? t('billing.nextExpiry', { credits: nf.format(data.next_expiry.credits), date: date(data.next_expiry.at) })
                : t('billing.noExpiry')}
            </p>
          </div>
          {!s.enforce && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t('billing.meteringOnly')}</p>}
          {(depleted || low) && (
            <p
              role="status"
              className={cn(
                'flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
                depleted ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300' : 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300',
              )}
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {depleted ? t('billing.paused') : t('billing.low')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Monthly plan: also in Settings → Billing, with its invoices and billing details */}
      <SubscriptionCard
        pricing={data.subscription_pricing}
        subscription={data.subscription}
        overage={data.overage}
        ready={data.subscription_ready}
        onChanged={() => void load()}
        provider={data.subscription_provider}
        culqiPublicKey={data.culqi_public_key ?? null}
        account={data.account}
        onAccountSaved={() => void load()}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Costs + month usage */}
        <Card>
          <CardHeader>
            <CardTitle>{t('billing.costs.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800/60">
              {BILLABLE_ACTIONS.map((a) => (
                <div key={a} className="flex items-center justify-between gap-4 py-2">
                  <dt className="text-slate-600 dark:text-slate-300">{t(`billing.costs.${a}`)}</dt>
                  <dd className="flex items-center gap-3 tabular-nums">
                    <span className="text-slate-900 dark:text-white">{t('billing.costs.unit', { n: s.action_costs[a] })}</span>
                    {data.usage_month[a] ? (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {t('billing.costs.usedThisMonth', { n: nf.format(data.usage_month[a]) })}
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {/* Ledger */}
        <Card>
          <CardHeader>
            <CardTitle>{t('billing.usage.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {data.ledger.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('billing.usage.empty')}</p>
            ) : (
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm dark:divide-slate-800/60">
                {data.ledger.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-4 py-2">
                    <div className="min-w-0">
                      <p className="text-slate-900 dark:text-white">
                        {t(`billing.usage.kind.${l.kind}`)}
                        {l.action && <span className="text-slate-500 dark:text-slate-400"> · {t(`billing.costs.${l.action}`)}</span>}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {date(l.created_at, true)}
                        {l.note ? ` · ${l.note}` : ''}
                      </p>
                    </div>
                    <span className={cn('shrink-0 tabular-nums font-medium', l.credits > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-300')}>
                      {l.credits > 0 ? '+' : '−'}
                      {nf.format(Math.abs(l.credits))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
