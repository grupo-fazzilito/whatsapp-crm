-- Services in the online store.
--   image_url      photo shown in the store (public catalog URL)
--   show_in_store  listed in the public store
--   store_booking  schedule = the customer picks day and time when buying (creates the booking)
--                  later    = the customer pays; the date is agreed afterwards in the chat
ALTER TABLE public.services
  ADD COLUMN image_url text,
  ADD COLUMN show_in_store boolean DEFAULT true NOT NULL,
  ADD COLUMN store_booking text DEFAULT 'schedule' NOT NULL CHECK (store_booking IN ('schedule', 'later'));

-- A service order has no delivery; it may come with the booking made at checkout.
ALTER TABLE public.orders DROP CONSTRAINT orders_fulfillment_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_fulfillment_check
  CHECK ((fulfillment = ANY (ARRAY['pickup'::text, 'delivery'::text, 'dine_in'::text, 'service'::text])));
ALTER TABLE public.orders ADD COLUMN booking_id uuid REFERENCES public.bookings (id) ON DELETE SET NULL;

-- Order lines for a service point at it (products keep product_id).
ALTER TABLE public.order_items ADD COLUMN service_id uuid REFERENCES public.services (id) ON DELETE SET NULL;
