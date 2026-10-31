'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AccountForm, BuyForm, accountComplete, useBillingError, type BillingAccount, type TopUpSettings } from './top-up';

interface Data {
  balance: number;
  settings: TopUpSettings & { expiry_months: number };
  gateway_ready: boolean;
  account: BillingAccount | null;
}

/** Buying tokens without leaving the page (opened from the low-balance banner). */
export function TopUpDialog({ open, onOpenChange, onPaid }: { open: boolean; onOpenChange: (open: boolean) => void; onPaid: () => void }) {
  const { t, locale } = useI18n();
  const errorText = useBillingError();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<{ id: string; credits: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE');

  const load = useCallback(async () => {
    const res = await fetch('/api/billing', { cache: 'no-store' }).catch(() => null);
    if (!res?.ok) return setFailed(true);
    setData((await res.json()) as Data);
  }, []);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- each opening starts fresh
    setPending(null);
    setFailed(false);
    void load();
  }, [open, load]);

  const check = async () => {
    if (!pending) return;
    setChecking(true);
    const res = await fetch(`/api/billing/payments/${pending.id}/sync`, { method: 'POST' });
    setChecking(false);
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.payment?.status === 'paid') {
      toast.success(t('billing.payments.credited', { n: nf.format(pending.credits) }));
      onPaid();
      onOpenChange(false);
    } else if (res.ok) toast.info(t('billing.payments.stillPending'));
    else toast.error(errorText(body.error));
  };

  const complete = accountComplete(data?.account ?? null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('billing.buy.title')}</DialogTitle>
          {data && (
            <DialogDescription>
              {t('billing.dialog.balance', { n: nf.format(data.balance) })} {t('billing.buy.description', { min: data.settings.min_topup, months: data.settings.expiry_months })}
            </DialogDescription>
          )}
        </DialogHeader>

        {failed ? (
          <p className="text-sm text-red-600 dark:text-red-400">{t('billing.errors.generic')}</p>
        ) : !data ? (
          <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('common.loading')} />
        ) : !data.gateway_ready ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('billing.buy.gatewayMissing')}</p>
        ) : pending ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">{t('billing.buy.opened')}</p>
            <Button onClick={check} disabled={checking} className="w-full">
              {checking && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {checking ? t('billing.payments.checking') : t('billing.payments.check')}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {!complete && (
              <section aria-labelledby="topup-account" className="space-y-2">
                <h3 id="topup-account" className="text-sm font-semibold text-slate-900 dark:text-white">{t('billing.account.title')}</h3>
                <AccountForm initial={data.account} onSaved={() => void load()} />
              </section>
            )}
            <BuyForm settings={data.settings} profileComplete={complete} onCreated={(payment) => payment && setPending(payment)} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
