-- How the online store shows each product's stock, and the waitlist of
-- customers who asked to be told when a sold-out product is back.
--   stock_display        null = the store's general setting
--                        hidden = only "Sold out" when nothing is left
--                        exact  = "7 left"
--                        low    = "Almost gone" when fewer than low_stock_threshold are left
--   low_stock_threshold  null = the store's general setting
--   waitlist_enabled     "Notify me" on the sold-out product; null = the store's general setting
ALTER TABLE public.products
  ADD COLUMN stock_display text CHECK (stock_display IS NULL OR stock_display IN ('hidden', 'exact', 'low')),
  ADD COLUMN low_stock_threshold integer CHECK (low_stock_threshold IS NULL OR low_stock_threshold BETWEEN 1 AND 100000),
  ADD COLUMN waitlist_enabled boolean;

-- One row per customer waiting for a product (or one of its variants).
--   status        waiting | notified (the "back in stock" WhatsApp went out)
--   notify_error  why the last "Notify" didn't go out (template pending, no channel…)
CREATE TABLE public.stock_waitlist (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.product_variants (id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts (id) ON DELETE SET NULL,
  name text,
  phone text NOT NULL,
  status text DEFAULT 'waiting' NOT NULL CHECK (status IN ('waiting', 'notified')),
  notified_at timestamptz,
  notified_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  notify_error text,
  conversation_id uuid REFERENCES public.conversations (id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX idx_stock_waitlist_workspace ON public.stock_waitlist (workspace_id, status, created_at DESC);
CREATE INDEX idx_stock_waitlist_product ON public.stock_waitlist (product_id);
-- A phone waits once per product / variant.
CREATE UNIQUE INDEX uq_stock_waitlist_waiting ON public.stock_waitlist
  (product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), phone)
  WHERE status = 'waiting';
