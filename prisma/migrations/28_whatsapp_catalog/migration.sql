-- The business's Meta catalog (WhatsApp catalog and cart), kept in sync with
-- Whasalia's products in real time through the Catalog API. Whasalia is the
-- source of truth: whatever is edited in Commerce Manager is overwritten.
--   channel_id   WhatsApp number whose token manages the catalog
--   item_errors  last items Meta rejected: [{ retailer_id, message }]
CREATE TABLE public.meta_catalogs (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces (id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels (id) ON DELETE CASCADE,
  catalog_id text NOT NULL,
  catalog_name text,
  status text DEFAULT 'active' NOT NULL CHECK (status IN ('active', 'error')),
  last_synced_at timestamptz,
  last_error text,
  item_errors jsonb DEFAULT '[]' NOT NULL,
  connected_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Products to send to Meta. Filled by the triggers below, from every place
-- that changes a product (editor, import, orders, API); drained right away
-- and by the cron.
--   upsert  product_id: send the product (or its variants) as it is now
--   delete  retailer_id: take that item out of the catalog
CREATE TABLE public.meta_catalog_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  product_id uuid,
  retailer_id text,
  op text NOT NULL CHECK (op IN ('upsert', 'delete')),
  attempts integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX uq_meta_catalog_queue_upsert ON public.meta_catalog_queue (product_id) WHERE op = 'upsert';
CREATE INDEX idx_meta_catalog_queue_workspace ON public.meta_catalog_queue (workspace_id, created_at);

CREATE FUNCTION public.meta_catalog_enqueue() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  ws uuid;
  pid uuid;
BEGIN
  ws := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  IF NOT EXISTS (SELECT 1 FROM public.meta_catalogs c WHERE c.workspace_id = ws) THEN
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'products' THEN
    IF TG_OP = 'DELETE' THEN
      INSERT INTO public.meta_catalog_queue (workspace_id, retailer_id, op) VALUES (ws, OLD.id::text, 'delete');
      RETURN NULL;
    END IF;
    pid := NEW.id;
  ELSE
    IF TG_OP = 'DELETE' THEN
      INSERT INTO public.meta_catalog_queue (workspace_id, retailer_id, op) VALUES (ws, OLD.id::text, 'delete');
      pid := OLD.product_id;
    ELSE
      pid := NEW.product_id;
    END IF;
  END IF;
  INSERT INTO public.meta_catalog_queue (workspace_id, product_id, op) VALUES (ws, pid, 'upsert')
  ON CONFLICT (product_id) WHERE op = 'upsert' DO NOTHING;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_products_meta_catalog AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.meta_catalog_enqueue();
CREATE TRIGGER trg_product_variants_meta_catalog AFTER INSERT OR UPDATE OR DELETE ON public.product_variants
  FOR EACH ROW EXECUTE FUNCTION public.meta_catalog_enqueue();

-- Orders sent from the WhatsApp cart. The customer still picks shipping and
-- payment on the store's checkout (checkout_pending until then).
ALTER TABLE public.orders DROP CONSTRAINT orders_source_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_source_check
  CHECK ((source = ANY (ARRAY['ai'::text, 'chat_buttons'::text, 'manual'::text, 'webchat'::text, 'store'::text, 'whatsapp_catalog'::text])));
ALTER TABLE public.orders ADD COLUMN checkout_pending boolean DEFAULT false NOT NULL;
