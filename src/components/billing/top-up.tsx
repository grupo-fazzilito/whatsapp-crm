'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { DOC_TYPES } from '@/lib/billing/account';

// Buying tokens, shared by Settings → Tokens and the low-balance dialog.

export interface TopUpSettings {
  credit_price: number;
  min_topup: number;
  packs: number[];
}

export interface BillingAccount {
  doc_type: number | null;
  doc_number: string | null;
  legal_name: string | null;
  email: string | null;
}

export const accountComplete = (a: BillingAccount | null) => !!(a?.doc_type && a.doc_number && a.legal_name && a.email);

/** Translated message for an API error code. */
export function useBillingError() {
  const { t } = useI18n();
  return useCallback(
    (code: string | undefined, min?: number) => {
      const key = `billing.errors.${code ?? 'generic'}`;
      const s = t(key, { min: min ?? 50 });
      return s === key ? t('billing.errors.generic') : s;
    },
    [t],
  );
}

/** Packs + custom amount + "Pay": opens Payment Latam's checkout in a new tab. */
export function BuyForm({
  settings: s,
  profileComplete,
  onCreated,
}: {
  settings: TopUpSettings;
  profileComplete: boolean;
  /** The payment was created and its checkout opened (null when it failed). */
  onCreated: (payment: { id: string; credits: number } | null) => void;
}) {
  const { t, locale } = useI18n();
  const errorText = useBillingError();
  const [amount, setAmount] = useState<number>(s.packs[0] ?? s.min_topup);
  const [custom, setCustom] = useState('');
  const [paying, setPaying] = useState(false);
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE');
  const chosen = custom ? Number(custom) : amount;
  const chosenCredits = chosen && Number.isInteger(chosen) ? Math.floor((chosen + 1e-9) / s.credit_price) : 0;

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
      onCreated(null);
      return;
    }
    if (tab) tab.location.href = body.payment.checkout_url;
    else window.location.href = body.payment.checkout_url;
    setCustom('');
    onCreated({ id: body.payment.id, credits: body.payment.credits });
  };

  return (
    <div className="space-y-4">
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
    </div>
  );
}

/** Document, legal name and email Payment Latam asks for on every payment. */
export function AccountForm({ initial, onSaved }: { initial: BillingAccount | null; onSaved: () => void }) {
  const { t } = useI18n();
  const errorText = useBillingError();
  const [account, setAccount] = useState({
    doc_type: String(initial?.doc_type ?? 1),
    doc_number: initial?.doc_number ?? '',
    legal_name: initial?.legal_name ?? '',
    email: initial?.email ?? '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/billing/account', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...account, doc_type: Number(account.doc_type) }),
    });
    setSaving(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(errorText(body.error));
      return;
    }
    toast.success(t('billing.account.saved'));
    onSaved();
  };

  return (
    <div className="space-y-3">
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
      <Button variant="outline" onClick={save} disabled={saving}>
        {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {t('billing.account.save')}
      </Button>
    </div>
  );
}
