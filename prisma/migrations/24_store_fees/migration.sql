-- 1. Shipping paid at the destination: the store charges nothing for it and
--    the customer pays the courier on delivery.
ALTER TABLE public.shipping_profiles DROP CONSTRAINT shipping_profiles_type_check;
ALTER TABLE public.shipping_profiles ADD CONSTRAINT shipping_profiles_type_check
  CHECK (type IN ('free', 'flat', 'weight', 'on_delivery'));

-- 2. Orders: shipping paid on delivery, and the store's extra charges
--    (packaging, gift wrap…) as they were when the order was placed.
--   extra_fees  [{"name": "Empaquetado", "amount": 3}]
--   fees_total  their sum, included in total
ALTER TABLE public.orders
  ADD COLUMN shipping_on_delivery boolean DEFAULT false NOT NULL,
  ADD COLUMN extra_fees jsonb DEFAULT '[]'::jsonb NOT NULL CHECK (jsonb_typeof(extra_fees) = 'array'),
  ADD COLUMN fees_total numeric(12,2) DEFAULT 0 NOT NULL CHECK (fees_total >= 0);
