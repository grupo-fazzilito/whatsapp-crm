-- One plan (US$ 9.90 for 1,000 credits a month) plus extra credits when they
-- run out: billed per credit actually used (US$ 3 per 1,000, prorated) on the
-- next invoice, up to the limit the business sets. The free plan keeps one
-- connected account per service; extra accounts get a month to subscribe.

ALTER TABLE public.credit_lots DROP CONSTRAINT credit_lots_source_check;
ALTER TABLE public.credit_lots ADD CONSTRAINT credit_lots_source_check
  CHECK (source = ANY (ARRAY['purchase', 'welcome', 'grant', 'subscription', 'overage']));
ALTER TABLE public.credit_ledger DROP CONSTRAINT credit_ledger_kind_check;
ALTER TABLE public.credit_ledger ADD CONSTRAINT credit_ledger_kind_check
  CHECK (kind = ANY (ARRAY['purchase', 'welcome', 'grant', 'usage', 'expiry', 'reversal', 'adjustment', 'subscription', 'overage']));

-- Most extra credits a month. Default 9,000.
ALTER TABLE public.token_subscriptions
  ADD COLUMN overage_limit integer NOT NULL DEFAULT 9000
  CHECK (overage_limit > 0 AND overage_limit <= 10000000);

-- Extra credit lots handed out in a billing period. Only what was used from
-- them is billed: counted when the period closes, before they expire.
CREATE TABLE public.subscription_overage_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  period_end    timestamptz NOT NULL,
  lot_id        uuid NOT NULL REFERENCES public.credit_lots(id) ON DELETE CASCADE,
  credits       integer NOT NULL CHECK (credits > 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscription_overage_grants_period ON public.subscription_overage_grants (workspace_id, period_end);

-- A closed period: extra credits used, what they cost, and the Stripe invoice
-- (item) that carries them. One row per business and period.
CREATE TABLE public.subscription_overage_periods (
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  period_end       timestamptz NOT NULL,
  credits_used     integer NOT NULL DEFAULT 0,
  amount_cents     integer NOT NULL DEFAULT 0,
  invoice_id       text,
  invoice_item_id  text,
  closed_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, period_end)
);

-- Invoice history shown in Settings → Billing.
ALTER TABLE public.subscription_invoices
  ADD COLUMN period_start timestamptz,
  ADD COLUMN period_end timestamptz,
  ADD COLUMN hosted_url text;

-- Free plan: since when the business has more than one account of a service
-- (NULL = it doesn't, or it is subscribed). After 30 days the extra ones are
-- disconnected. Platform admins can give a business unlimited accounts.
ALTER TABLE public.workspaces ADD COLUMN extra_accounts_since timestamptz;
ALTER TABLE public.workspaces ADD COLUMN unlimited_accounts boolean NOT NULL DEFAULT false;
