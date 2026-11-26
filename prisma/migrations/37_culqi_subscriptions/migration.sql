-- Peru: the credit plan is charged in soles with Culqi (saved card, charged by
-- us every month: plan + the previous month's extra credits in one charge).
-- Culqi asks for the customer's address, city and phone; they also go on the
-- SUNAT receipt later.

ALTER TABLE public.billing_accounts
  ADD COLUMN address text,
  ADD COLUMN city text,
  ADD COLUMN phone text;

ALTER TABLE public.token_subscriptions
  -- Culqi: the saved card charged every month, and how to show it ("Visa •••• 1111").
  ADD COLUMN card_id text,
  ADD COLUMN card_label text,
  -- A renewal being charged (claim, so two cron runs never charge twice) and the last failure.
  ADD COLUMN renewing_at timestamptz,
  ADD COLUMN last_error text;
