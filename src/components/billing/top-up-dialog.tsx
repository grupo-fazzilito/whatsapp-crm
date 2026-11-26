'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { SubscriptionPricing } from '@/lib/billing/subscription-pricing';
import { SubscriptionCard, type OverageView, type SubscriptionView } from './subscription-card';
import { accountComplete, type BillingAccount } from './top-up';

interface Data {
  balance: number;
  subscription: SubscriptionView | null;
  overage: OverageView | null;
  subscription_pricing: SubscriptionPricing;
  subscription_ready: boolean;
  subscription_provider?: string;
  culqi_public_key?: string | null;
  account?: BillingAccount | null;
}

/**
 * Getting more tokens without leaving the page (opened from the low-balance
 * banner): subscribe, or raise the extra-credit limit.
 */
export function TopUpDialog({ open, onOpenChange, onPaid }: { open: boolean; onOpenChange: (open: boolean) => void; onPaid: () => void }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-PE');

  const load = useCallback(async () => {
    const res = await fetch('/api/billing', { cache: 'no-store' }).catch(() => null);
    if (!res?.ok) return setFailed(true);
    setData((await res.json()) as Data);
  }, []);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- each opening starts fresh
    setFailed(false);
    void load();
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('subscription.title')}</DialogTitle>
          {data && <DialogDescription>{t('billing.dialog.balance', { n: nf.format(data.balance) })}</DialogDescription>}
        </DialogHeader>
        {failed ? (
          <p className="text-sm text-red-600 dark:text-red-400">{t('billing.errors.generic')}</p>
        ) : !data ? (
          <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('common.loading')} />
        ) : (
          <SubscriptionCard
            pricing={data.subscription_pricing}
            subscription={data.subscription}
            overage={data.overage}
            ready={data.subscription_ready}
            provider={data.subscription_provider}
            culqiPublicKey={data.culqi_public_key ?? null}
            accountReady={accountComplete(data.account ?? null)}
            email={data.account?.email ?? null}
            onChanged={() => {
              onPaid();
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
