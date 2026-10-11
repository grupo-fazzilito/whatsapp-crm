-- Platform webhooks: endpoints set by the platform admin that receive every
-- workspace event (message, order, booking, ... with workspace_id) plus
-- platform events (sign-ups, workspaces, support tickets, payments, tokens,
-- channels). Same queue design as webhook_endpoints/webhook_deliveries, in
-- tables of their own because they belong to no workspace.

CREATE TABLE public.platform_webhook_endpoints (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    url text NOT NULL CHECK (char_length(url) BETWEEN 8 AND 2000 AND url ~* '^https?://'),
    description text CHECK (description IS NULL OR char_length(description) <= 300),
    events text[] DEFAULT '{}'::text[] NOT NULL,
    secret_encrypted text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    failure_count integer DEFAULT 0 NOT NULL,
    disabled_at timestamptz,
    disabled_reason text,
    last_success_at timestamptz,
    last_failure_at timestamptz,
    created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE public.platform_webhook_deliveries (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    endpoint_id uuid NOT NULL REFERENCES public.platform_webhook_endpoints(id) ON DELETE CASCADE,
    workspace_id uuid,
    event_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')),
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamptz DEFAULT now(),
    last_attempt_at timestamptz,
    response_status integer,
    response_body text,
    error text,
    duration_ms integer,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_platform_webhook_deliveries_due ON public.platform_webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX idx_platform_webhook_deliveries_endpoint ON public.platform_webhook_deliveries (endpoint_id, created_at DESC);
CREATE INDEX idx_platform_webhook_deliveries_created ON public.platform_webhook_deliveries (created_at);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.platform_webhook_endpoints FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.platform_webhook_deliveries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE FUNCTION public.platform_webhook_active() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$ SELECT EXISTS (SELECT 1 FROM public.platform_webhook_endpoints WHERE active) $$;

-- Queues one event for every active platform endpoint subscribed to it.
CREATE FUNCTION public.platform_webhook_emit(p_workspace uuid, p_type text, p_data jsonb, p_event text DEFAULT NULL) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_event TEXT := COALESCE(p_event, 'evt_' || replace(gen_random_uuid()::text, '-', ''));
  v_now TIMESTAMPTZ := clock_timestamp();
  v_count INTEGER;
BEGIN
  INSERT INTO public.platform_webhook_deliveries (endpoint_id, workspace_id, event_id, event_type, payload, next_attempt_at)
  SELECT e.id, p_workspace, v_event, p_type,
         jsonb_build_object(
           'id', v_event,
           'type', p_type,
           'created_at', to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'workspace_id', p_workspace,
           'data', COALESCE(p_data, '{}'::jsonb)
         ),
         v_now
  FROM public.platform_webhook_endpoints e
  WHERE e.active AND (p_type = ANY (e.events) OR '*' = ANY (e.events));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE FUNCTION public.platform_webhook_emit_safe(p_workspace uuid, p_type text, p_data jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.platform_webhook_emit(p_workspace, p_type, p_data);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'platform_webhook_emit % failed: %', p_type, SQLERRM;
END;
$$;

-- Workspace events also reach the platform endpoints (same event id).
CREATE OR REPLACE FUNCTION public.webhook_emit(p_workspace uuid, p_type text, p_data jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
  IF p_type <> 'ping' THEN
    BEGIN
      PERFORM public.platform_webhook_emit(p_workspace, p_type, p_data, v_event);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'platform_webhook_emit % failed: %', p_type, SQLERRM;
    END;
  END IF;
  RETURN v_count;
END;
$$;

-- The workspace triggers skip their work when nobody listens; platform
-- endpoints count as listeners too.
CREATE OR REPLACE FUNCTION public.webhook_has_endpoints(p_workspace uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (SELECT 1 FROM public.webhook_endpoints WHERE workspace_id = p_workspace AND active)
      OR EXISTS (SELECT 1 FROM public.platform_webhook_endpoints WHERE active)
$$;

CREATE FUNCTION public.platform_webhook_claim_deliveries(p_limit integer DEFAULT 50, p_lease_seconds integer DEFAULT 120) RETURNS SETOF public.platform_webhook_deliveries
    LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
    AS $$
  WITH due AS (
    SELECT id FROM public.platform_webhook_deliveries
    WHERE status = 'pending' AND next_attempt_at <= NOW()
    ORDER BY next_attempt_at
    LIMIT GREATEST(1, LEAST(p_limit, 500))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.platform_webhook_deliveries d
     SET next_attempt_at = NOW() + make_interval(secs => GREATEST(30, p_lease_seconds))
    FROM due
   WHERE d.id = due.id
  RETURNING d.*
$$;

-- ── Platform events ────────────────────────────────────────────────────

CREATE FUNCTION public.platform_webhook_on_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.platform_webhook_active() THEN RETURN NULL; END IF;
  PERFORM public.platform_webhook_emit_safe(NULL, 'user.signed_up', jsonb_build_object(
    'user', jsonb_build_object('id', NEW.id, 'email', NEW.email, 'name', NEW.name, 'created_at', NEW.created_at)));
  RETURN NULL;
END;
$$;
CREATE TRIGGER platform_webhook_events AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.platform_webhook_on_user();

CREATE FUNCTION public.platform_webhook_on_workspace() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.platform_webhook_active() THEN RETURN NULL; END IF;
  PERFORM public.platform_webhook_emit_safe(NEW.id, 'workspace.created', jsonb_build_object(
    'workspace', jsonb_build_object('id', NEW.id, 'name', NEW.name, 'industry', NEW.industry, 'country', NEW.country,
                                    'currency', NEW.currency, 'created_by', NEW.created_by, 'created_at', NEW.created_at)));
  RETURN NULL;
END;
$$;
CREATE TRIGGER platform_webhook_events AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.platform_webhook_on_workspace();

CREATE FUNCTION public.platform_webhook_on_member() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.platform_webhook_active() THEN RETURN NULL; END IF;
  PERFORM public.platform_webhook_emit_safe(NEW.workspace_id, 'member.added', jsonb_build_object(
    'member', jsonb_build_object('user_id', NEW.user_id, 'role', NEW.role, 'status', NEW.status,
                                 'email', (SELECT email FROM public.users WHERE id = NEW.user_id))));
  RETURN NULL;
END;
$$;
CREATE TRIGGER platform_webhook_events AFTER INSERT ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION public.platform_webhook_on_member();

CREATE FUNCTION public.platform_webhook_ticket_json(t public.support_tickets) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$
  SELECT jsonb_build_object('id', t.id, 'number', t.number, 'subject', t.subject, 'category', t.category,
    'priority', t.priority, 'status', t.status, 'user_id', t.user_id,
    'user_email', (SELECT email FROM public.users WHERE id = t.user_id),
    'workspace_name', (SELECT name FROM public.workspaces WHERE id = t.workspace_id),
    'created_at', t.created_at, 'closed_at', t.closed_at)
$$;

CREATE FUNCTION public.platform_webhook_on_ticket() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.platform_webhook_active() THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.platform_webhook_emit_safe(NEW.workspace_id, 'ticket.created',
      jsonb_build_object('ticket', public.platform_webhook_ticket_json(NEW)));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.platform_webhook_emit_safe(NEW.workspace_id, 'ticket.status_changed',
      jsonb_build_object('ticket', public.platform_webhook_ticket_json(NEW), 'previous_status', OLD.status));
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER platform_webhook_events AFTER INSERT OR UPDATE OF status ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.platform_webhook_on_ticket();

-- Replies only: the first message is the ticket's own description.
CREATE FUNCTION public.platform_webhook_on_ticket_message() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  t public.support_tickets;
BEGIN
  IF NOT public.platform_webhook_active() THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.support_ticket_messages WHERE ticket_id = NEW.ticket_id AND id <> NEW.id) THEN RETURN NULL; END IF;
  SELECT * INTO t FROM public.support_tickets WHERE id = NEW.ticket_id;
  PERFORM public.platform_webhook_emit_safe(NEW.workspace_id, 'ticket.replied', jsonb_build_object(
    'ticket', public.platform_webhook_ticket_json(t),
    'message', jsonb_build_object('id', NEW.id, 'author_role', NEW.author_role, 'author_id', NEW.author_id,
                                  'body', NEW.body, 'attachments', NEW.attachments, 'created_at', NEW.created_at)));
  RETURN NULL;
END;
$$;
CREATE TRIGGER platform_webhook_events AFTER INSERT ON public.support_ticket_messages FOR EACH ROW EXECUTE FUNCTION public.platform_webhook_on_ticket_message();

CREATE FUNCTION public.platform_webhook_on_payment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_type text;
BEGIN
  IF NOT public.platform_webhook_active() THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN v_type := 'payment.created';
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL;
  ELSIF NEW.status = 'paid' THEN v_type := 'payment.paid';
  ELSIF NEW.status IN ('failed', 'expired', 'reversed') THEN v_type := 'payment.failed';
  ELSE RETURN NULL;
  END IF;
  PERFORM public.platform_webhook_emit_safe(NEW.workspace_id, v_type, jsonb_build_object(
    'payment', jsonb_build_object('id', NEW.id, 'provider', NEW.provider, 'amount', NEW.amount, 'currency', NEW.currency,
      'credits', NEW.credits, 'status', NEW.status, 'reference', NEW.reference, 'paid_at', NEW.paid_at, 'error', NEW.error,
      'workspace_name', (SELECT name FROM public.workspaces WHERE id = NEW.workspace_id), 'created_at', NEW.created_at)));
  RETURN NULL;
END;
$$;
CREATE TRIGGER platform_webhook_events AFTER INSERT OR UPDATE OF status ON public.billing_payments FOR EACH ROW EXECUTE FUNCTION public.platform_webhook_on_payment();

CREATE FUNCTION public.platform_webhook_on_credit_lot() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.platform_webhook_active() THEN RETURN NULL; END IF;
  PERFORM public.platform_webhook_emit_safe(NEW.workspace_id, 'tokens.added', jsonb_build_object(
    'lot', jsonb_build_object('id', NEW.id, 'source', NEW.source, 'tokens', NEW.credits_total, 'expires_at', NEW.expires_at,
      'payment_id', NEW.payment_id, 'note', NEW.note),
    'balance', public.credit_balance(NEW.workspace_id)));
  RETURN NULL;
END;
$$;
CREATE TRIGGER platform_webhook_events AFTER INSERT ON public.credit_lots FOR EACH ROW EXECUTE FUNCTION public.platform_webhook_on_credit_lot();

CREATE FUNCTION public.platform_webhook_on_channel() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_type text;
  r public.channels;
BEGIN
  IF NOT public.platform_webhook_active() THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN v_type := 'channel.removed'; r := OLD;
  ELSIF TG_OP = 'INSERT' THEN v_type := 'channel.connected'; r := NEW;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_type := CASE WHEN NEW.status = 'connected' THEN 'channel.connected' ELSE 'channel.disconnected' END; r := NEW;
  ELSE RETURN NULL;
  END IF;
  PERFORM public.platform_webhook_emit_safe(r.workspace_id, v_type, jsonb_build_object(
    'channel', jsonb_build_object('id', r.id, 'type', r.type, 'name', r.name, 'display_handle', r.display_handle,
      'status', r.status, 'status_detail', r.status_detail)));
  RETURN NULL;
END;
$$;
CREATE TRIGGER platform_webhook_events AFTER INSERT OR UPDATE OF status OR DELETE ON public.channels FOR EACH ROW EXECUTE FUNCTION public.platform_webhook_on_channel();
