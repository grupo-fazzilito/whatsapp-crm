'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ExternalLink, Loader2, Receipt, RefreshCw } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/regions';
import { formatPlanCents, monthlyCents } from '@/lib/billing/subscription-pricing';
import { SubscriptionCard } from './subscription-card';
import { DOC_TYPES } from '@/lib/billing/account';
import { AccountForm, useBillingError } from './top-up';
import { useBillingData, type Payment } from './billing-data';

const ACTIVE = new Set(['active', 'trialing', 'past_due']);

const PAYMENT_CLS: Record<Payment['status'], string> = {
  creating: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  expired: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  reversed: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

/**
 * Settings → Billing: the plan with every date and amount, the billing
 * details, the subscribe / card / cancel buttons (same as in Tokens), and
 * every charge made.
 */
export function InvoicingPanel() {
  const { t, locale } = useI18n();
  const { data, loading, load } = useBillingData();
  const errorText = useBillingError();
  const [checking, setChecking] = useState<string | null>(null);
  const tag = locale === 'en' ? 'en-US' : 'es-PE';
  const nf = new Intl.NumberFormat(tag);
  const date = (iso: string, withTime = false) =>
    new Intl.DateTimeFormat(tag, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(iso));

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
      </div>
    );
  }
  if (!data) return <p className="text-sm text-red-600">{t('billing.errors.generic')}</p>;

  const sub = data.subscription;
  const active = !!sub && ACTIVE.has(sub.status);
  const pricing = data.subscription_pricing;
  const money = (cents: number, currency = pricing.currency) => formatPlanCents(cents, currency);
  const status = !sub
    ? t('invoicing.status.none')
    : sub.status === 'past_due'
      ? t('invoicing.status.pastDue')
      : !active
        ? t('invoicing.status.canceled')
        : sub.cancel_at_period_end
          ? t('invoicing.status.canceling')
          : t('invoicing.status.active');
  const statusCls = !active
    ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
    : sub!.status === 'past_due' || sub!.cancel_at_period_end
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300';
  const overageCents = active && data.overage ? data.overage.cents : 0;
  // Next charge: the plan (unless it ends) plus the extra credits used so far this month.
  const nextCharge = active ? (sub!.cancel_at_period_end ? 0 : sub!.price_cents) + overageCents : 0;
  const account = data.account;

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: t('invoicing.fields.plan'), value: active ? t('subscription.plan', { n: nf.format(sub!.tokens) }) : data.plan.name },
    {
      label: t('invoicing.fields.status'),
      value: <Badge variant="secondary" className={statusCls}>{status}</Badge>,
    },
    {
      label: t('invoicing.fields.price'),
      // Free plan: nothing is charged; the paid plan's price goes on its own line.
      value: active ? `${money(sub!.price_cents)} ${t('invoicing.perMonthIgv')}` : t('invoicing.free'),
    },
    {
      label: t('invoicing.fields.balance'),
      value: (
        <span>
          {t('invoicing.credits', { n: nf.format(data.balance) })}{' '}
          <Link href="/settings?tab=billing" className="text-xs font-medium text-primary hover:underline">
            {t('invoicing.seeUsage')}
          </Link>
        </span>
      ),
    },
  ];
  if (!active) {
    rows.push({
      label: t('invoicing.fields.paidPlan'),
      value: t('invoicing.paidPlanValue', { price: money(monthlyCents(pricing.step_tokens, pricing)), n: nf.format(pricing.step_tokens) }),
    });
  }
  if (data.next_expiry) rows.push({ label: t('invoicing.fields.expiry'), value: t('billing.nextExpiry', { credits: nf.format(data.next_expiry.credits), date: date(data.next_expiry.at) }) });
  if (sub?.started_at) rows.push({ label: t('invoicing.fields.since'), value: date(sub.started_at) });
  if (active && sub!.current_period_end) {
    rows.push({
      label: sub!.cancel_at_period_end ? t('invoicing.fields.endsOn') : t('invoicing.fields.nextBilling'),
      value: date(sub!.current_period_end),
    });
  }
  if (active && data.overage) {
    rows.push({
      label: t('invoicing.fields.overage'),
      value: t('invoicing.overageValue', { n: nf.format(data.overage.credits), limit: nf.format(sub!.overage_limit), price: money(data.overage.cents) }),
    });
  }
  if (active) rows.push({ label: t('invoicing.fields.nextCharge'), value: `${money(nextCharge)} ${t('invoicing.igv')}` });
  if (sub?.card_label) rows.push({ label: t('invoicing.fields.card'), value: sub.card_label });
  if (sub?.status === 'past_due' && sub.last_error) rows.push({ label: t('invoicing.fields.lastError'), value: <span className="text-red-600 dark:text-red-400">{sub.last_error}</span> });

  const check = async (p: Payment) => {
    setChecking(p.id);
    const res = await fetch(`/api/billing/payments/${p.id}/sync`, { method: 'POST' });
    setChecking(null);
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.payment?.status === 'paid') toast.success(t('billing.payments.credited', { n: nf.format(p.credits) }));
    else if (res.ok) toast.info(t('billing.payments.stillPending'));
    else toast.error(errorText(body.error));
    await load();
  };

  return (
    <div className="space-y-6">
      {/* Plan summary: every date and amount */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="size-5 text-primary" aria-hidden /> {t('invoicing.title')}
          </CardTitle>
          <CardDescription>{t('invoicing.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-8 sm:grid-cols-2">
            {rows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2.5 text-sm dark:border-slate-800/60">
                <dt className="text-slate-500 dark:text-slate-400">{r.label}</dt>
                <dd className="text-right font-medium text-slate-900 dark:text-white">{r.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Subscribe / pay now / change card / cancel: the same card as in Tokens */}
        <SubscriptionCard
          pricing={pricing}
          subscription={sub}
          overage={data.overage}
          ready={data.subscription_ready}
          onChanged={() => void load()}
          provider={data.subscription_provider}
          culqiPublicKey={data.culqi_public_key ?? null}
          account={account}
          onAccountSaved={() => void load()}
        />

        <Card>
          <CardHeader>
            <CardTitle>{t('billing.account.title')}</CardTitle>
            <CardDescription>{t('billing.account.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Remounts with what was saved in the subscribe dialog. */}
            <AccountForm key={JSON.stringify(account)} initial={account} onSaved={() => void load()} />
            {account?.doc_number && (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                {t('invoicing.receiptTo', { doc: `${DOC_TYPES[account.doc_type as keyof typeof DOC_TYPES]?.label ?? ''} ${account.doc_number}`, name: account.legal_name ?? '' })}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Every charge of the plan: date, month paid, detail and total */}
      <Card>
        <CardHeader>
          <CardTitle>{t('billing.invoices.title')}</CardTitle>
          <CardDescription>{t('invoicing.invoicesHelp')}</CardDescription>
        </CardHeader>
        <CardContent>
          {data.invoices.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('billing.invoices.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th scope="col" className="py-2 pr-4 font-medium">{t('billing.invoices.date')}</th>
                    <th scope="col" className="py-2 pr-4 font-medium">{t('invoicing.period')}</th>
                    <th scope="col" className="py-2 pr-4 font-medium">{t('billing.invoices.detail')}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">{t('invoicing.plan')}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">{t('invoicing.extra')}</th>
                    <th scope="col" className="py-2 pr-4 text-right font-medium">{t('billing.invoices.total')}</th>
                    <th scope="col" className="py-2 font-medium"><span className="sr-only">{t('common.actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800/60">
                      <td className="py-2.5 pr-4 whitespace-nowrap">{date(inv.created_at, true)}</td>
                      <td className="py-2.5 pr-4 whitespace-nowrap text-slate-600 dark:text-slate-300">
                        {inv.period_start && inv.period_end ? `${date(inv.period_start)} – ${date(inv.period_end)}` : '—'}
                      </td>
                      <td className="py-2.5 pr-4">
                        <p className="text-slate-900 dark:text-white">
                          {inv.credits > 0 ? t('billing.invoices.plan', { n: nf.format(inv.credits) }) : t(`billing.invoices.reason.${inv.reason === 'subscription_update' ? 'update' : 'other'}`)}
                        </p>
                        {inv.overage_credits > 0 && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">{t('invoicing.extraCredits', { n: nf.format(inv.overage_credits) })}</p>
                        )}
                        <p className="font-mono text-[11px] text-slate-400 dark:text-slate-500">{inv.id}</p>
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{formatMoney((inv.amount_cents - inv.overage_cents) / 100, inv.currency || 'PEN')}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{inv.overage_cents > 0 ? formatMoney(inv.overage_cents / 100, inv.currency || 'PEN') : '—'}</td>
                      <td className="py-2.5 pr-4 text-right font-medium tabular-nums">{formatMoney(inv.amount_cents / 100, inv.currency || 'PEN')}</td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        {inv.hosted_url && (
                          <a
                            href={inv.hosted_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                          >
                            {t('billing.invoices.view')} <ExternalLink className="size-3" aria-hidden />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{t('invoicing.igvNote')}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* One-time top-ups of the old prepaid model, while an account has any */}
      {data.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('billing.payments.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th scope="col" className="py-2 pr-4 font-medium">{t('billing.payments.date')}</th>
                    <th scope="col" className="py-2 pr-4 font-medium">{t('billing.payments.amount')}</th>
                    <th scope="col" className="py-2 pr-4 font-medium">{t('billing.payments.credits')}</th>
                    <th scope="col" className="py-2 pr-4 font-medium">{t('billing.payments.status')}</th>
                    <th scope="col" className="py-2 font-medium"><span className="sr-only">{t('common.actions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
                      <td className="py-2.5 pr-4 whitespace-nowrap">{date(p.created_at, true)}</td>
                      <td className="py-2.5 pr-4 tabular-nums">{formatMoney(Number(p.amount), p.currency || 'PEN')}</td>
                      <td className="py-2.5 pr-4 tabular-nums">{nf.format(p.credits)}</td>
                      <td className="py-2.5 pr-4">
                        <Badge variant="secondary" className={PAYMENT_CLS[p.status]}>{t(`billing.status.${p.status}`)}</Badge>
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        {p.status === 'pending' && (
                          <div className="flex justify-end gap-2">
                            {p.checkout_url && (
                              <a
                                href={p.checkout_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                              >
                                {t('billing.payments.pay')} <ExternalLink className="size-3" aria-hidden />
                              </a>
                            )}
                            <Button size="sm" variant="outline" onClick={() => check(p)} disabled={checking === p.id}>
                              {checking === p.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
                              {checking === p.id ? t('billing.payments.checking') : t('billing.payments.check')}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
