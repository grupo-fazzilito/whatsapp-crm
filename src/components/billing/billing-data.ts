'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BillableAction } from '@/lib/billing/pricing';
import type { SubscriptionPricing } from '@/lib/billing/subscription-pricing';
import type { OverageView, SubscriptionView } from './subscription-card';
import type { BillingAccount } from './top-up';

// What GET /api/billing returns, shared by Settings → Tokens and Settings → Billing.

export interface Payment {
  id: string;
  amount: number;
  currency: string;
  credits: number;
  status: 'creating' | 'pending' | 'paid' | 'expired' | 'reversed' | 'failed';
  checkout_url: string | null;
  expires_on: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface LedgerRow {
  id: number;
  kind: string;
  credits: number;
  action: string | null;
  note: string | null;
  created_at: string;
}

/** A paid subscription charge: the plan, plus the previous month's extra credits when there were any. */
export interface InvoiceRow {
  id: string;
  created_at: string;
  reason: string | null;
  amount_cents: number;
  currency: string;
  credits: number;
  hosted_url: string | null;
  period_start: string | null;
  period_end: string | null;
  overage_credits: number;
  overage_cents: number;
}

export interface BillingData {
  plan: { id: string; name: string; price: number };
  balance: number;
  next_expiry: { at: string; credits: number; renews?: boolean } | null;
  settings: {
    region: string;
    gateway: string;
    currency: string;
    credit_price: number;
    min_topup: number;
    packs: number[];
    expiry_months: number;
    action_costs: Record<BillableAction, number>;
    low_credit_threshold: number;
    enforce: boolean;
  };
  gateway_ready: boolean;
  subscription: SubscriptionView | null;
  overage: OverageView | null;
  invoices: InvoiceRow[];
  subscription_pricing: SubscriptionPricing;
  subscription_ready: boolean;
  subscription_provider?: string;
  culqi_public_key?: string | null;
  account: BillingAccount | null;
  payments: Payment[];
  ledger: LedgerRow[];
  usage_month: Record<string, number>;
}

export function useBillingData() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const res = await fetch('/api/billing', { cache: 'no-store' }).catch(() => null);
    if (res?.ok) setData((await res.json()) as BillingData);
    setLoading(false);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void load();
  }, [load]);
  return { data, loading, load };
}
