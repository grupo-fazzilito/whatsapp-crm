-- Online store: each business's public catalog with cart and checkout
-- (/tienda/<slug>). Its settings live in workspaces.settings.store.

-- Shipping profiles: how much delivery costs. A store can only be published
-- with at least one active profile (or pickup).
--   type         free | flat (one price per order) | weight (price by the order's weight range)
--   flat_price   price of a 'flat' profile
--   rates        'weight' ranges, ascending: [{"up_to_kg": 1, "price": 10}, {"up_to_kg": null, "price": 30}]
--                (up_to_kg null = "and above"; an order heavier than every range can't use the profile)
--   free_over    the order's subtotal from which this profile ships free; null = never
--   eta          free text shown to the customer, e.g. "2 a 3 días hábiles"
CREATE TABLE public.shipping_profiles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('free', 'flat', 'weight')),
  flat_price numeric(12,2) CHECK (flat_price IS NULL OR flat_price >= 0),
  rates jsonb DEFAULT '[]'::jsonb NOT NULL CHECK (jsonb_typeof(rates) = 'array'),
  free_over numeric(12,2) CHECK (free_over IS NULL OR free_over >= 0),
  eta text,
  is_active boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX idx_shipping_profiles_ws ON public.shipping_profiles (workspace_id, is_active, sort_order);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.shipping_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Weight for weight-based shipping (kg). A variant's own weight wins over the product's.
ALTER TABLE public.products ADD COLUMN weight_kg numeric(10,3) CHECK (weight_kg IS NULL OR weight_kg >= 0);
ALTER TABLE public.product_variants ADD COLUMN weight_kg numeric(10,3) CHECK (weight_kg IS NULL OR weight_kg >= 0);

-- Orders placed in the store.
--   shipping_profile_id / shipping_name  the profile chosen (the name is kept if the profile is deleted)
--   shipping_address  {"department","province","district","line","reference"} as typed by the customer
--   public_token      secret of the customer's confirmation page (/tienda/<slug>/pedido/<token>)
ALTER TABLE public.orders
  ADD COLUMN customer_email text,
  ADD COLUMN customer_document text,
  ADD COLUMN shipping_profile_id uuid REFERENCES public.shipping_profiles (id) ON DELETE SET NULL,
  ADD COLUMN shipping_name text,
  ADD COLUMN shipping_address jsonb,
  ADD COLUMN weight_kg numeric(10,3),
  ADD COLUMN public_token text UNIQUE;

ALTER TABLE public.orders DROP CONSTRAINT orders_source_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_source_check
  CHECK ((source = ANY (ARRAY['ai'::text, 'chat_buttons'::text, 'manual'::text, 'webchat'::text, 'store'::text])));

-- The team hears about new store orders.
ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY['mention', 'assigned', 'transferred', 'system', 'billing', 'handover', 'order']));
