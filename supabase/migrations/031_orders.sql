-- ============================================================
-- 031 — Carts, orders and payment methods
--
-- carts / cart_items   one open cart per conversation, built from chat
--                      buttons ("Agregar") or by the AI agent.
-- orders / order_items snapshot of the cart at checkout (names and
--                      prices are copied, so later catalog edits don't
--                      change past orders). Per-workspace order number.
-- order_events         status / payment history shown on the order.
-- payment_methods      how each business gets paid (Yape/Plin QR image,
--                      bank account text, cash...). Sent to the customer
--                      when they want to pay; payment is confirmed by hand.
--
-- Stock is reserved when an order is confirmed (confirm_order) and
-- restored if a confirmed order is cancelled (cancel_order).
-- ============================================================

-- ------------------------------------------------------------
-- Carts
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.carts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'converted', 'abandoned')),
  -- Checkout answers collected so far (fulfillment, address, notes...).
  checkout JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_carts_open_per_conversation ON public.carts(conversation_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_carts_ws ON public.carts(workspace_id, status, updated_at DESC);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.carts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.cart_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  cart_id UUID NOT NULL REFERENCES public.carts(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 999),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cart_items_line ON public.cart_items(cart_id, product_id, COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE TRIGGER set_ws_from_parent BEFORE INSERT ON public.cart_items
  FOR EACH ROW EXECUTE FUNCTION public.set_ws_from_parent('carts', 'cart_id');
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.cart_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- Orders
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspace_counters (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, name)
);
ALTER TABLE public.workspace_counters ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.next_workspace_counter(ws UUID, counter TEXT)
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.workspace_counters (workspace_id, name, value) VALUES (ws, counter, 1)
  ON CONFLICT (workspace_id, name) DO UPDATE SET value = public.workspace_counters.value + 1
  RETURNING value
$$;

CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE DEFAULT public.active_ws(),
  number BIGINT NOT NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  cart_id UUID REFERENCES public.carts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'preparing', 'ready', 'shipped', 'delivered', 'cancelled')),
  fulfillment TEXT NOT NULL DEFAULT 'pickup' CHECK (fulfillment IN ('pickup', 'delivery', 'dine_in')),
  customer_name TEXT,
  customer_phone TEXT,
  address TEXT,
  address_reference TEXT,
  notes TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'awaiting_proof', 'proof_received', 'paid', 'refunded')),
  payment_method_id UUID,
  payment_method_name TEXT,
  payment_proof_url TEXT,
  paid_at TIMESTAMPTZ,
  -- True once stock was taken for this order (confirm), so cancel restores it.
  stock_reserved BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('ai', 'chat_buttons', 'manual', 'webchat')),
  ai_agent_id UUID REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, number)
);
CREATE INDEX IF NOT EXISTS idx_orders_ws_status ON public.orders(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_conversation ON public.orders(conversation_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public.orders_assign_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.number IS NULL OR NEW.number = 0 THEN
    NEW.number := public.next_workspace_counter(NEW.workspace_id, 'order');
  END IF;
  RETURN NEW;
END;
$$;
ALTER TABLE public.orders ALTER COLUMN number SET DEFAULT 0;
CREATE TRIGGER orders_assign_number BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_assign_number();

CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  variant_id UUID REFERENCES public.product_variants(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  variant_name TEXT,
  sku TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);
CREATE TRIGGER set_ws_from_parent BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_ws_from_parent('orders', 'order_id');

CREATE TABLE IF NOT EXISTS public.order_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  -- created | status | payment | note | notified
  type TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  note TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON public.order_events(order_id, created_at);
CREATE TRIGGER set_ws_from_parent BEFORE INSERT ON public.order_events
  FOR EACH ROW EXECUTE FUNCTION public.set_ws_from_parent('orders', 'order_id');

-- ------------------------------------------------------------
-- Payment methods
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE DEFAULT public.active_ws(),
  name TEXT NOT NULL,
  -- qr (Yape/Plin...), bank_transfer, cash, card_on_delivery, other
  type TEXT NOT NULL DEFAULT 'qr' CHECK (type IN ('qr', 'bank_transfer', 'cash', 'card_on_delivery', 'other')),
  -- Shown to the customer: holder name, number, account, CCI...
  instructions TEXT,
  -- Public URL of the QR image (catalog bucket, {workspace}/payments/...).
  qr_image_url TEXT,
  -- Ask the customer to send a screenshot of the payment.
  requires_proof BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_methods_ws ON public.payment_methods(workspace_id, is_active, sort_order);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.payment_methods FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_method_fkey
  FOREIGN KEY (payment_method_id) REFERENCES public.payment_methods(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- Stock: reserve on confirm, restore on cancel (atomic, row-locked)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_order(p_order UUID, p_user UUID DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
  it RECORD;
  available INTEGER;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF o.status <> 'pending' THEN RETURN 'not_pending'; END IF;

  IF NOT o.stock_reserved THEN
    -- Lock the stock rows first (products, then variants), then check.
    PERFORM 1 FROM public.products WHERE id IN (SELECT product_id FROM public.order_items WHERE order_id = p_order) ORDER BY id FOR UPDATE;
    PERFORM 1 FROM public.product_variants WHERE id IN (SELECT variant_id FROM public.order_items WHERE order_id = p_order) ORDER BY id FOR UPDATE;

    FOR it IN
      SELECT oi.name, p.track_stock, v.id AS variant_id, v.stock AS v_stock, p.stock AS p_stock,
             SUM(oi.quantity) OVER (PARTITION BY oi.product_id, oi.variant_id) AS qty
      FROM public.order_items oi
      LEFT JOIN public.products p ON p.id = oi.product_id
      LEFT JOIN public.product_variants v ON v.id = oi.variant_id
      WHERE oi.order_id = p_order
    LOOP
      IF it.track_stock THEN
        available := COALESCE(CASE WHEN it.variant_id IS NOT NULL AND it.v_stock IS NOT NULL THEN it.v_stock ELSE it.p_stock END, 0);
        IF available < it.qty THEN
          RETURN 'out_of_stock:' || it.name;
        END IF;
      END IF;
    END LOOP;

    UPDATE public.product_variants v SET stock = v.stock - oi.quantity
    FROM public.order_items oi JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order AND v.id = oi.variant_id AND p.track_stock AND v.stock IS NOT NULL;

    UPDATE public.products p SET stock = COALESCE(p.stock, 0) - s.qty
    FROM (
      SELECT oi.product_id, SUM(oi.quantity) AS qty
      FROM public.order_items oi
      LEFT JOIN public.product_variants v ON v.id = oi.variant_id
      WHERE oi.order_id = p_order AND (oi.variant_id IS NULL OR v.stock IS NULL)
      GROUP BY oi.product_id
    ) s
    WHERE p.id = s.product_id AND p.track_stock;
  END IF;

  UPDATE public.orders SET status = 'confirmed', stock_reserved = true WHERE id = p_order;
  INSERT INTO public.order_events (workspace_id, order_id, type, from_value, to_value, user_id)
  VALUES (o.workspace_id, p_order, 'status', o.status, 'confirmed', p_user);
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_order(p_order UUID, p_user UUID DEFAULT NULL, p_note TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  o public.orders;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF o.status IN ('cancelled', 'delivered') THEN RETURN 'not_cancellable'; END IF;

  IF o.stock_reserved THEN
    UPDATE public.product_variants v SET stock = v.stock + oi.quantity
    FROM public.order_items oi JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order AND v.id = oi.variant_id AND p.track_stock AND v.stock IS NOT NULL;

    UPDATE public.products p SET stock = COALESCE(p.stock, 0) + s.qty
    FROM (
      SELECT oi.product_id, SUM(oi.quantity) AS qty
      FROM public.order_items oi
      LEFT JOIN public.product_variants v ON v.id = oi.variant_id
      WHERE oi.order_id = p_order AND (oi.variant_id IS NULL OR v.stock IS NULL)
      GROUP BY oi.product_id
    ) s
    WHERE p.id = s.product_id AND p.track_stock;
  END IF;

  UPDATE public.orders SET status = 'cancelled', stock_reserved = false WHERE id = p_order;
  INSERT INTO public.order_events (workspace_id, order_id, type, from_value, to_value, note, user_id)
  VALUES (o.workspace_id, p_order, 'status', o.status, 'cancelled', p_note, p_user);
  RETURN 'ok';
END;
$$;

-- Called by the app with the service role (the API checks membership).
REVOKE EXECUTE ON FUNCTION public.confirm_order(UUID, UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_order(UUID, UUID, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_workspace_counter(UUID, TEXT) FROM anon, authenticated;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  -- Any member works orders and carts (agents attend customers).
  FOREACH t IN ARRAY ARRAY['carts', 'cart_items', 'orders', 'order_items', 'order_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$CREATE POLICY ws_member_all ON public.%I FOR ALL
      USING (public.ws_access(workspace_id)) WITH CHECK (public.ws_access(workspace_id))$p$, t);
  END LOOP;
END $$;

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_member_read ON public.payment_methods FOR SELECT USING (public.ws_access(workspace_id));
CREATE POLICY ws_admin_write ON public.payment_methods FOR ALL
  USING (public.ws_access(workspace_id, 'admin')) WITH CHECK (public.ws_access(workspace_id, 'admin'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
