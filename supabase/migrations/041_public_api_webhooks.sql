-- ============================================================
-- 041 — Public REST API (API keys) + outgoing webhooks
--
-- api_keys            Workspace API keys for /api/v1. Only the SHA-256
--                     of the secret is stored; the secret
--                     ("cnx_live_<random>") is shown once at creation.
--                     `prefix` = first 8 chars after "cnx_live_" (shown
--                     in the UI and used to find the row before a
--                     constant-time hash compare).
-- webhook_endpoints   HTTPS URLs that receive signed event POSTs. The
--                     signing secret is stored encrypted (AES-GCM,
--                     ENCRYPTION_KEY) by the app.
-- webhook_deliveries  Outbox: one row per (event, endpoint). Filled by
--                     public.webhook_emit() — from the app (emitEvent) and
--                     from the AFTER triggers below — and delivered by the
--                     automations cron with retries.
--
-- Events are emitted by triggers so every write path (inbox UI, API,
-- AI agent, imports, RPCs) is covered without touching each caller:
--   message.received / message.sent       messages INSERT (never internal notes)
--   conversation.created/assigned/resolved conversations INSERT/UPDATE
--   contact.created / contact.updated     contacts INSERT/UPDATE
--   order.created                          order_events INSERT type 'created'
--                                          (written after the items)
--   order.status_changed / order.paid      orders UPDATE
--   booking.created / booking.status_changed bookings INSERT/UPDATE
--   lead.qualified                         lead_profiles qualified_at set
--   deal.stage_changed                     deals UPDATE of stage_id
-- Every trigger first checks (indexed) whether the workspace has an
-- active endpoint and returns immediately otherwise; failures inside the
-- emitter are caught and logged as WARNING so they never break the write.
--
-- Access: admins of the workspace may read keys/endpoints/deliveries
-- (RLS). All writes go through server routes with the service role.
-- ============================================================

-- ------------------------------------------------------------
-- API keys
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),
  prefix TEXT NOT NULL CHECK (prefix ~ '^[A-Za-z0-9_-]{8}$'),
  key_hash TEXT NOT NULL UNIQUE CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  scopes TEXT[] NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON public.api_keys(prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_ws ON public.api_keys(workspace_id, created_at DESC);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_admin_read ON public.api_keys;
CREATE POLICY ws_admin_read ON public.api_keys FOR SELECT USING (public.ws_access(workspace_id, 'admin'));

-- ------------------------------------------------------------
-- Webhook endpoints
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  url TEXT NOT NULL CHECK (char_length(url) BETWEEN 8 AND 2000 AND url ~* '^https?://'),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 300),
  events TEXT[] NOT NULL DEFAULT '{}',
  secret_encrypted TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  failure_count INTEGER NOT NULL DEFAULT 0,
  disabled_at TIMESTAMPTZ,
  disabled_reason TEXT,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_active ON public.webhook_endpoints(workspace_id) WHERE active;

DROP TRIGGER IF EXISTS set_updated_at ON public.webhook_endpoints;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_admin_read ON public.webhook_endpoints;
CREATE POLICY ws_admin_read ON public.webhook_endpoints FOR SELECT USING (public.ws_access(workspace_id, 'admin'));

-- ------------------------------------------------------------
-- Webhook deliveries (outbox)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  endpoint_id UUID NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  response_status INTEGER,
  response_body TEXT,
  error TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON public.webhook_deliveries(next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON public.webhook_deliveries(endpoint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_ws_created ON public.webhook_deliveries(workspace_id, created_at);

DROP TRIGGER IF EXISTS set_updated_at ON public.webhook_deliveries;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_admin_read ON public.webhook_deliveries;
CREATE POLICY ws_admin_read ON public.webhook_deliveries FOR SELECT USING (public.ws_access(workspace_id, 'admin'));

-- ------------------------------------------------------------
-- Emitter: one delivery per active endpoint subscribed to the event.
-- Envelope: {id, type, created_at, workspace_id, data}. Returns how many
-- deliveries were queued.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.webhook_emit(p_workspace UUID, p_type TEXT, p_data JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event TEXT := 'evt_' || replace(gen_random_uuid()::text, '-', '');
  v_now TIMESTAMPTZ := clock_timestamp();
  v_count INTEGER;
BEGIN
  INSERT INTO public.webhook_deliveries (workspace_id, endpoint_id, event_id, event_type, payload, next_attempt_at)
  SELECT p_workspace, e.id, v_event, p_type,
         jsonb_build_object(
           'id', v_event,
           'type', p_type,
           'created_at', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'workspace_id', p_workspace,
           'data', COALESCE(p_data, '{}'::jsonb)
         ),
         v_now
  FROM public.webhook_endpoints e
  WHERE e.workspace_id = p_workspace
    AND e.active
    AND (p_type = ANY (e.events) OR '*' = ANY (e.events));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Cheap pre-check used by every trigger.
CREATE OR REPLACE FUNCTION public.webhook_has_endpoints(p_workspace UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.webhook_endpoints WHERE workspace_id = p_workspace AND active)
$$;

-- Never let an emit failure break the caller's write.
CREATE OR REPLACE FUNCTION public.webhook_emit_safe(p_workspace UUID, p_type TEXT, p_data JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.webhook_emit(p_workspace, p_type, p_data);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'webhook_emit % failed: %', p_type, SQLERRM;
END;
$$;

-- Claim due deliveries for the cron worker. The lease (next_attempt_at
-- pushed forward) keeps overlapping runs from sending twice; a worker
-- that dies mid-way simply lets the lease expire and the row is retried.
CREATE OR REPLACE FUNCTION public.webhook_claim_deliveries(p_limit INTEGER DEFAULT 50, p_lease_seconds INTEGER DEFAULT 120)
RETURNS SETOF public.webhook_deliveries
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH due AS (
    SELECT id FROM public.webhook_deliveries
    WHERE status = 'pending' AND next_attempt_at <= NOW()
    ORDER BY next_attempt_at
    LIMIT GREATEST(1, LEAST(p_limit, 500))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.webhook_deliveries d
     SET next_attempt_at = NOW() + make_interval(secs => GREATEST(30, p_lease_seconds))
    FROM due
   WHERE d.id = due.id
  RETURNING d.*
$$;

REVOKE ALL ON FUNCTION public.webhook_emit(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_emit_safe(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_has_endpoints(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_claim_deliveries(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.webhook_emit(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.webhook_emit_safe(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.webhook_has_endpoints(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.webhook_claim_deliveries(INTEGER, INTEGER) TO service_role;

-- ------------------------------------------------------------
-- Payload builders (same field names as the /api/v1 resources)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.webhook_contact_json(p_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'company', c.company,
    'avatar_url', c.avatar_url,
    'tags', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY t.name)
                        FROM public.contact_tags ct JOIN public.tags t ON t.id = ct.tag_id
                       WHERE ct.contact_id = c.id), '[]'::jsonb),
    'created_at', c.created_at, 'updated_at', c.updated_at)
  FROM public.contacts c WHERE c.id = p_id
$$;

CREATE OR REPLACE FUNCTION public.webhook_conversation_json(p_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', v.id, 'contact_id', v.contact_id,
    'channel', CASE WHEN ch.id IS NULL THEN NULL ELSE jsonb_build_object('id', ch.id, 'type', ch.type, 'name', ch.name) END,
    'status', v.status, 'priority', v.priority, 'assigned_user_id', v.assigned_agent_id,
    'team_id', v.team_id, 'ai_agent_id', v.ai_agent_id, 'unread_count', COALESCE(v.unread_count, 0),
    'last_message_text', v.last_message_text, 'last_message_at', v.last_message_at,
    'last_customer_message_at', v.last_customer_message_at, 'resolved_at', v.resolved_at,
    'created_at', v.created_at, 'updated_at', v.updated_at)
  FROM public.conversations v LEFT JOIN public.channels ch ON ch.id = v.channel_id
  WHERE v.id = p_id
$$;

CREATE OR REPLACE FUNCTION public.webhook_order_json(p_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', o.id, 'number', o.number, 'status', o.status, 'payment_status', o.payment_status,
    'fulfillment', o.fulfillment, 'contact_id', o.contact_id, 'conversation_id', o.conversation_id,
    'customer_name', o.customer_name, 'customer_phone', o.customer_phone,
    'address', o.address, 'address_reference', o.address_reference, 'notes', o.notes,
    'currency', o.currency, 'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee,
    'discount', o.discount, 'total', o.total, 'payment_method_name', o.payment_method_name,
    'paid_at', o.paid_at, 'source', o.source,
    'items', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', i.id, 'product_id', i.product_id, 'variant_id', i.variant_id, 'name', i.name,
                'sku', i.sku, 'quantity', i.quantity, 'unit_price', i.unit_price, 'total', i.total) ORDER BY i.sort_order)
              FROM public.order_items i WHERE i.order_id = o.id), '[]'::jsonb),
    'created_at', o.created_at, 'updated_at', o.updated_at)
  FROM public.orders o WHERE o.id = p_id
$$;

CREATE OR REPLACE FUNCTION public.webhook_booking_json(b public.bookings)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', b.id, 'status', b.status, 'date', b.booking_date, 'time', b.booking_time,
    'duration_minutes', b.duration_minutes, 'contact_id', b.contact_id, 'conversation_id', b.conversation_id,
    'service_id', b.service_id, 'staff_id', b.staff_id, 'product_id', b.product_id,
    'customer_name', b.customer_name, 'party_size', b.party_size, 'notes', b.notes,
    'custom_fields', b.custom_fields, 'source', b.source,
    'created_at', b.created_at, 'updated_at', b.updated_at)
$$;

CREATE OR REPLACE FUNCTION public.webhook_deal_json(d public.deals)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'id', d.id, 'title', d.title, 'value', d.value, 'currency', d.currency, 'status', d.status,
    'pipeline_id', d.pipeline_id, 'stage_id', d.stage_id, 'contact_id', d.contact_id,
    'conversation_id', d.conversation_id, 'assigned_to', d.assigned_to, 'notes', d.notes,
    'expected_close_date', d.expected_close_date, 'won_at', d.won_at, 'lost_at', d.lost_at,
    'lost_reason', d.lost_reason, 'created_at', d.created_at, 'updated_at', d.updated_at)
$$;

GRANT EXECUTE ON FUNCTION public.webhook_contact_json(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.webhook_conversation_json(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.webhook_order_json(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.webhook_contact_json(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_conversation_json(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_order_json(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_booking_json(public.bookings) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.webhook_deal_json(public.deals) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- Triggers
-- ------------------------------------------------------------

-- messages → message.received / message.sent
CREATE OR REPLACE FUNCTION public.webhook_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type TEXT;
  v_conv RECORD;
BEGIN
  IF NEW.is_internal OR NOT public.webhook_has_endpoints(NEW.workspace_id) THEN RETURN NULL; END IF;
  IF NEW.sender_type = 'customer' THEN v_type := 'message.received';
  ELSIF NEW.status <> 'failed' THEN v_type := 'message.sent';
  ELSE RETURN NULL;
  END IF;
  BEGIN
    SELECT v.contact_id, v.channel_id, ch.type AS channel_type INTO v_conv
      FROM public.conversations v LEFT JOIN public.channels ch ON ch.id = v.channel_id
     WHERE v.id = NEW.conversation_id;
    PERFORM public.webhook_emit_safe(NEW.workspace_id, v_type, jsonb_build_object(
      'message', jsonb_build_object(
        'id', NEW.id, 'conversation_id', NEW.conversation_id, 'contact_id', v_conv.contact_id,
        'channel_type', v_conv.channel_type,
        'direction', CASE WHEN NEW.sender_type = 'customer' THEN 'inbound' ELSE 'outbound' END,
        'sender_type', NEW.sender_type, 'sender_user_id', NEW.sender_id, 'ai_agent_id', NEW.ai_agent_id,
        'type', NEW.content_type, 'text', NEW.content_text, 'media_url', NEW.media_url,
        'template_name', NEW.template_name, 'status', NEW.status, 'external_id', NEW.message_id,
        'reply_to_message_id', NEW.reply_to_message_id, 'interactive_reply_id', NEW.interactive_reply_id,
        'created_at', NEW.created_at),
      'contact', public.webhook_contact_json(v_conv.contact_id)));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'webhook_on_message failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS webhook_events ON public.messages;
CREATE TRIGGER webhook_events AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.webhook_on_message();

-- conversations → conversation.created / .assigned / .resolved
CREATE OR REPLACE FUNCTION public.webhook_on_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.webhook_has_endpoints(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.webhook_emit_safe(NEW.workspace_id, 'conversation.created', jsonb_build_object(
        'conversation', public.webhook_conversation_json(NEW.id),
        'contact', public.webhook_contact_json(NEW.contact_id)));
      RETURN NULL;
    END IF;
    IF NEW.assigned_agent_id IS NOT NULL AND NEW.assigned_agent_id IS DISTINCT FROM OLD.assigned_agent_id THEN
      PERFORM public.webhook_emit_safe(NEW.workspace_id, 'conversation.assigned', jsonb_build_object(
        'conversation', public.webhook_conversation_json(NEW.id),
        'previous_assigned_user_id', OLD.assigned_agent_id,
        'assigned_user', (SELECT jsonb_build_object('id', p.user_id, 'name', p.full_name, 'email', p.email)
                            FROM public.profiles p WHERE p.user_id = NEW.assigned_agent_id)));
    END IF;
    IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
      PERFORM public.webhook_emit_safe(NEW.workspace_id, 'conversation.resolved', jsonb_build_object(
        'conversation', public.webhook_conversation_json(NEW.id),
        'resolved_by_user_id', NEW.resolved_by));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'webhook_on_conversation failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS webhook_events ON public.conversations;
CREATE TRIGGER webhook_events AFTER INSERT OR UPDATE OF assigned_agent_id, status ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.webhook_on_conversation();

-- contacts → contact.created / contact.updated (profile fields only)
CREATE OR REPLACE FUNCTION public.webhook_on_contact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed TEXT[] := '{}';
BEGIN
  IF NOT public.webhook_has_endpoints(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.webhook_emit_safe(NEW.workspace_id, 'contact.created',
        jsonb_build_object('contact', public.webhook_contact_json(NEW.id)));
      RETURN NULL;
    END IF;
    IF NEW.name IS DISTINCT FROM OLD.name THEN v_changed := v_changed || 'name'; END IF;
    IF NEW.phone IS DISTINCT FROM OLD.phone THEN v_changed := v_changed || 'phone'; END IF;
    IF NEW.email IS DISTINCT FROM OLD.email THEN v_changed := v_changed || 'email'; END IF;
    IF NEW.company IS DISTINCT FROM OLD.company THEN v_changed := v_changed || 'company'; END IF;
    IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN v_changed := v_changed || 'avatar_url'; END IF;
    IF array_length(v_changed, 1) > 0 THEN
      PERFORM public.webhook_emit_safe(NEW.workspace_id, 'contact.updated', jsonb_build_object(
        'contact', public.webhook_contact_json(NEW.id), 'changed', to_jsonb(v_changed)));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'webhook_on_contact failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS webhook_events ON public.contacts;
CREATE TRIGGER webhook_events AFTER INSERT OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.webhook_on_contact();

-- order_events 'created' → order.created (items already inserted)
CREATE OR REPLACE FUNCTION public.webhook_on_order_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type <> 'created' OR NOT public.webhook_has_endpoints(NEW.workspace_id) THEN RETURN NULL; END IF;
  PERFORM public.webhook_emit_safe(NEW.workspace_id, 'order.created',
    jsonb_build_object('order', public.webhook_order_json(NEW.order_id)));
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'webhook_on_order_event failed: %', SQLERRM;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS webhook_events ON public.order_events;
CREATE TRIGGER webhook_events AFTER INSERT ON public.order_events
  FOR EACH ROW EXECUTE FUNCTION public.webhook_on_order_event();

-- orders → order.status_changed / order.paid
CREATE OR REPLACE FUNCTION public.webhook_on_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.webhook_has_endpoints(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM public.webhook_emit_safe(NEW.workspace_id, 'order.status_changed', jsonb_build_object(
        'order', public.webhook_order_json(NEW.id), 'previous_status', OLD.status));
    END IF;
    IF NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid' THEN
      PERFORM public.webhook_emit_safe(NEW.workspace_id, 'order.paid', jsonb_build_object(
        'order', public.webhook_order_json(NEW.id), 'previous_payment_status', OLD.payment_status));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'webhook_on_order failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS webhook_events ON public.orders;
CREATE TRIGGER webhook_events AFTER UPDATE OF status, payment_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.webhook_on_order();

-- bookings → booking.created / booking.status_changed
CREATE OR REPLACE FUNCTION public.webhook_on_booking()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.webhook_has_endpoints(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      PERFORM public.webhook_emit_safe(NEW.workspace_id, 'booking.created', jsonb_build_object(
        'booking', public.webhook_booking_json(NEW), 'contact', public.webhook_contact_json(NEW.contact_id)));
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM public.webhook_emit_safe(NEW.workspace_id, 'booking.status_changed', jsonb_build_object(
        'booking', public.webhook_booking_json(NEW), 'previous_status', OLD.status));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'webhook_on_booking failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS webhook_events ON public.bookings;
CREATE TRIGGER webhook_events AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.webhook_on_booking();

-- lead_profiles → lead.qualified (first qualification only)
CREATE OR REPLACE FUNCTION public.webhook_on_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.qualified_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.qualified_at IS NOT NULL) THEN RETURN NULL; END IF;
  IF NOT public.webhook_has_endpoints(NEW.workspace_id) THEN RETURN NULL; END IF;
  PERFORM public.webhook_emit_safe(NEW.workspace_id, 'lead.qualified', jsonb_build_object(
    'lead', jsonb_build_object(
      'id', NEW.id, 'contact_id', NEW.contact_id, 'conversation_id', NEW.conversation_id,
      'operation', NEW.operation, 'property_types', to_jsonb(NEW.property_types), 'zones', to_jsonb(NEW.zones),
      'budget_min', NEW.budget_min, 'budget_max', NEW.budget_max, 'currency', NEW.currency,
      'bedrooms_min', NEW.bedrooms_min, 'bathrooms_min', NEW.bathrooms_min, 'parking_min', NEW.parking_min,
      'financing', NEW.financing, 'mortgage_preapproved', NEW.mortgage_preapproved, 'move_in', NEW.move_in,
      'purpose', NEW.purpose, 'score', NEW.score, 'temperature', NEW.temperature,
      'qualified_at', NEW.qualified_at),
    'contact', public.webhook_contact_json(NEW.contact_id)));
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'webhook_on_lead failed: %', SQLERRM;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS webhook_events ON public.lead_profiles;
CREATE TRIGGER webhook_events AFTER INSERT OR UPDATE OF qualified_at ON public.lead_profiles
  FOR EACH ROW EXECUTE FUNCTION public.webhook_on_lead();

-- deals → deal.stage_changed
CREATE OR REPLACE FUNCTION public.webhook_on_deal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id OR NOT public.webhook_has_endpoints(NEW.workspace_id) THEN RETURN NULL; END IF;
  PERFORM public.webhook_emit_safe(NEW.workspace_id, 'deal.stage_changed', jsonb_build_object(
    'deal', public.webhook_deal_json(NEW),
    'from_stage', (SELECT jsonb_build_object('id', s.id, 'name', s.name, 'key', s.key) FROM public.pipeline_stages s WHERE s.id = OLD.stage_id),
    'to_stage', (SELECT jsonb_build_object('id', s.id, 'name', s.name, 'key', s.key) FROM public.pipeline_stages s WHERE s.id = NEW.stage_id),
    'pipeline', (SELECT jsonb_build_object('id', p.id, 'name', p.name) FROM public.pipelines p WHERE p.id = NEW.pipeline_id)));
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'webhook_on_deal failed: %', SQLERRM;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS webhook_events ON public.deals;
CREATE TRIGGER webhook_events AFTER UPDATE OF stage_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.webhook_on_deal();
