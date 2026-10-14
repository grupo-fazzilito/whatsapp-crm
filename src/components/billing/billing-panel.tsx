'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Coins, CreditCard, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { BILLABLE_ACTIONS, type BillableAction } from '@/lib/billing/pricing';
import { DOC_TYPES } from '@/lib/billing/account';

interface Payment {
  id: string;
  amount: number;
  credits: number;
  status: 'creating' | 'pending' | 'paid' | 'expired' | 'reversed' | 'failed';
  checkout_url: string | null;
  expires_on: string | null;
  paid_at: string | null;
  created_at: string;
}

interface LedgerRow {
  id: number;
  kind: string;
  credits: number;
  action: string | null;
  note: string | null;
  created_at: string;
}

interface BillingData {
  plan: { id: string; name: string; price: number };
  balance: number;
  next_expiry: { at: string; credits: number } | null;
  settings: {
    credit_price: number;
    min_topup: number;
    packs: number[];
    expiry_months: number;
    action_costs: Record<BillableAction, number>;
    low_credit_threshold: number;
    enforce: boolean;
  };
  gateway_ready: boolean;
  account: { doc_type: number | null; doc_number: string | null; legal_name: string | null; email: string | null } | null;
  payments: Payment[];
  ledger: LedgerRow[];
  usage_month: Record<string, number>;
}

const STATUS_CLS: Record<Payment['status'], string> = {
  creating: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  expired: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  reversed: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

export function BillingPanel() {
  const { t, locale } = useI18n();
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [paying, setPaying] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [account, setAccount] = useState({ doc_type: '1', doc_number: '', legal_name: '', email: '' });
  const [savingAccount, setSavingAccount] = useState(false);

  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE');
  const soles = (n: number) => `S/ ${new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
  const date = (iso: string, withTime = false) =>
    new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(new Date(iso));

  const errorText = useCallback(
    (code: string | undefined, min?: number) => {
      const key = `billing.errors.${code ?? 'generic'}`;
      const s = t(key, { min: min ?? 50 });
      return s === key ? t('billing.errors.generic') : s;
    },
    [t],
  );

  const load = useCallback(async () => {
    const res = await fetch('/api/billing', { cache: 'no-store' });
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const d = (await res.json()) as BillingData;
    setData(d);
    setAmount((a) => a ?? d.settings.packs[0] ?? d.settings.min_topup);
    if (d.account) {
      setAccount({
        doc_type: String(d.account.doc_type ?? 1),
        doc_number: d.account.doc_number ?? '',
        legal_name: d.account.legal_name ?? '',
        email: d.account.email ?? '',
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
      </div>
    );
  }
  if (!data) return <p className="text-sm text-red-600">{t('billing.errors.generic')}</p>;

  const s = data.settings;
  const profileComplete = !!(data.account?.doc_type && data.account.doc_number && data.account.legal_name && data.account.email);
  const replyCost = s.action_costs.reply || 1;
  const depleted = s.enforce && data.balance < replyCost;
  const low = !depleted && data.balance <= s.low_credit_threshold;
  const chosen = custom ? Number(custom) : amount;
  const chosenCredits = chosen && Number.isInteger(chosen) ? Math.floor((chosen + 1e-9) / s.credit_price) : 0;

  const saveAccount = async () => {
    setSavingAccount(true);
    const res = await fetch('/api/billing/account', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...account, doc_type: Number(account.doc_type) }),
    });
    setSavingAccount(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(errorText(body.error));
      return;
    }
    toast.success(t('billing.account.saved'));
    await load();
  };

  const pay = async () => {
    if (!chosen) return;
    // Open the tab synchronously so popup blockers allow it; fill it once the link exists.
    const tab = window.open('about:blank', '_blank');
    setPaying(true);
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: chosen }),
    });
    setPaying(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.payment?.checkout_url) {
      tab?.close();
      toast.error(errorText(body.error, s.min_topup));
      await load();
      return;
    }
    if (tab) tab.location.href = body.payment.checkout_url;
    else window.location.href = body.payment.checkout_url;
    toast.info(t('billing.buy.opened'));
    setCustom('');
    await load();
  };

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

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Buy */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="size-5 text-primary" aria-hidden /> {t('billing.buy.title')}
            </CardTitle>
            <CardDescription>{t('billing.buy.description', { min: s.min_topup, months: s.expiry_months })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!data.gateway_ready ? (
              <p className="text-sm text-slate-600 dark:text-slate-300">{t('billing.buy.gatewayMissing')}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('billing.buy.title')}>
                  {s.packs.map((p) => {
                    const active = !custom && amount === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          setAmount(p);
                          setCustom('');
                        }}
                        className={cn(
                          'rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
                          active
                            ? 'border-primary bg-primary/5 dark:bg-primary/10'
                            : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700',
                        )}
                      >
                        <span className="block text-lg font-semibold text-slate-900 dark:text-white">S/ {nf.format(p)}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {t('billing.buy.credits', { n: nf.format(Math.floor((p + 1e-9) / s.credit_price)) })}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="billing-custom">{t('billing.buy.custom')}</Label>
                  <Input
                    id="billing-custom"
                    inputMode="numeric"
                    placeholder={String(s.min_topup)}
                    value={custom}
                    onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, '').slice(0, 5))}
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t('billing.buy.unitPrice', { price: s.credit_price.toFixed(s.credit_price < 0.1 ? 3 : 2) })}
                    {chosenCredits > 0 && ` · ${t('billing.buy.credits', { n: nf.format(chosenCredits) })}`}
                  </p>
                </div>
                {!profileComplete && <p className="text-sm text-amber-700 dark:text-amber-300">{t('billing.buy.profileFirst')}</p>}
                <Button onClick={pay} disabled={paying || !profileComplete || !chosen || chosen < s.min_topup} className="w-full">
                  {paying ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ExternalLink className="size-4" aria-hidden />}
                  {paying ? t('billing.buy.creating') : t('billing.buy.pay', { amount: nf.format(chosen || 0) })}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        {/* Billing details */}
        <Card>
          <CardHeader>
            <CardTitle>{t('billing.account.title')}</CardTitle>
            <CardDescription>{t('billing.account.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="billing-doc-type">{t('billing.account.docType')}</Label>
                <Select value={account.doc_type} onValueChange={(v) => setAccount((a) => ({ ...a, doc_type: v ?? '1' }))}>
                  <SelectTrigger id="billing-doc-type" className="w-full">
                    <SelectValue>{DOC_TYPES[Number(account.doc_type) as keyof typeof DOC_TYPES]?.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(DOC_TYPES).map(([id, d]) => (
                      <SelectItem key={id} value={id}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="billing-doc-number">{t('billing.account.docNumber')}</Label>
                <Input id="billing-doc-number" value={account.doc_number} onChange={(e) => setAccount((a) => ({ ...a, doc_number: e.target.value.trim() }))} maxLength={20} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="billing-name">{t('billing.account.legalName')}</Label>
              <Input id="billing-name" value={account.legal_name} onChange={(e) => setAccount((a) => ({ ...a, legal_name: e.target.value }))} maxLength={200} autoComplete="organization" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="billing-email">{t('billing.account.email')}</Label>
              <Input id="billing-email" type="email" value={account.email} onChange={(e) => setAccount((a) => ({ ...a, email: e.target.value }))} maxLength={60} autoComplete="email" />
            </div>
            <Button variant="outline" onClick={saveAccount} disabled={savingAccount}>
              {savingAccount && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('billing.account.save')}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Payments */}
      <Card>
        <CardHeader>
          <CardTitle>{t('billing.payments.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.payments.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('billing.payments.empty')}</p>
          ) : (
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
                      <td className="py-2.5 pr-4 tabular-nums">{soles(Number(p.amount))}</td>
                      <td className="py-2.5 pr-4 tabular-nums">{nf.format(p.credits)}</td>
                      <td className="py-2.5 pr-4">
                        <Badge variant="secondary" className={STATUS_CLS[p.status]}>{t(`billing.status.${p.status}`)}</Badge>
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
          )}
        </CardContent>
      </Card>

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
                      <span className="text-xs text-slate-500 dark:text-slate-400" title={t('billing.usage.month')}>
                        −{nf.format(data.usage_month[a])}
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
