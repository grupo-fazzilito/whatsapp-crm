-- AI tokens by monthly subscription (Stripe). The CRM stays free; a business
-- subscribes to a monthly quota (1,000 tokens and up, in steps of 1,000).
-- Each paid invoice grants the month's quota as a 'subscription' credit lot;
-- at renewal the unused tokens of the previous month expire.

ALTER TABLE public.credit_lots DROP CONSTRAINT credit_lots_source_check;
ALTER TABLE public.credit_lots ADD CONSTRAINT credit_lots_source_check
  CHECK (source = ANY (ARRAY['purchase', 'welcome', 'grant', 'subscription']));
ALTER TABLE public.credit_ledger DROP CONSTRAINT credit_ledger_kind_check;
ALTER TABLE public.credit_ledger ADD CONSTRAINT credit_ledger_kind_check
  CHECK (kind = ANY (ARRAY['purchase', 'welcome', 'grant', 'usage', 'expiry', 'reversal', 'adjustment', 'subscription']));

-- One subscription per business.
CREATE TABLE public.token_subscriptions (
  workspace_id            uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider                text NOT NULL DEFAULT 'stripe',
  customer_id             text NOT NULL,
  subscription_id         text NOT NULL UNIQUE,
  -- Tokens per month and what they cost (in the smallest currency unit).
  tokens                  integer NOT NULL CHECK (tokens > 0),
  price_cents             integer NOT NULL CHECK (price_cents > 0),
  currency                text NOT NULL DEFAULT 'USD',
  -- Stripe's: active | trialing | past_due | unpaid | canceled | incomplete | incomplete_expired | paused
  status                  text NOT NULL,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX token_subscriptions_customer ON public.token_subscriptions (customer_id);

-- Paid invoices already turned into tokens (Stripe may deliver a webhook twice).
CREATE TABLE public.subscription_invoices (
  invoice_id      text PRIMARY KEY,
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  reason          text,
  tokens          integer NOT NULL DEFAULT 0,
  amount_cents    integer NOT NULL DEFAULT 0,
  currency        text NOT NULL DEFAULT 'USD',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscription_invoices_workspace ON public.subscription_invoices (workspace_id, created_at DESC);

