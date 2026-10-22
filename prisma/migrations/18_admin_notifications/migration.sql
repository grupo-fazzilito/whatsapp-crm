-- Notifications for the platform (super) admins, fed by the same platform
-- events as the platform webhooks: new users / businesses, tickets,
-- complaints, payments, tokens running out, channels connected.
CREATE TABLE public.platform_notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  type text NOT NULL,
  workspace_id uuid REFERENCES public.workspaces (id) ON DELETE SET NULL,
  data jsonb DEFAULT '{}'::jsonb NOT NULL,
  -- Admins who have read it (each admin has their own unread count).
  read_by uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX idx_platform_notifications_created ON public.platform_notifications (created_at DESC);

-- Which event types notify (platform_settings 'admin_notifications' → {"disabled": [...]}).
CREATE OR REPLACE FUNCTION public.platform_notify(p_workspace uuid, p_type text, p_data jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
DECLARE
  v_disabled jsonb;
BEGIN
  IF p_type NOT IN ('user.signed_up', 'workspace.created', 'ticket.created', 'ticket.replied', 'complaint.created',
                    'payment.paid', 'payment.failed', 'tokens.low', 'tokens.depleted', 'channel.connected') THEN
    RETURN;
  END IF;
  -- Only the customer's replies; the admin's own answers don't notify.
  IF p_type = 'ticket.replied' AND COALESCE(p_data #>> '{message,author_role}', '') <> 'customer' THEN RETURN; END IF;
  SELECT value -> 'disabled' INTO v_disabled FROM public.platform_settings WHERE key = 'admin_notifications';
  IF v_disabled IS NULL THEN v_disabled := '["tokens.low"]'::jsonb; END IF;
  IF v_disabled ? p_type THEN RETURN; END IF;
  INSERT INTO public.platform_notifications (type, workspace_id, data) VALUES (p_type, p_workspace, COALESCE(p_data, '{}'::jsonb));
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'platform_notify % failed: %', p_type, SQLERRM;
END;
$$;

-- Every platform event: webhook deliveries (as before) + admin notification.
CREATE OR REPLACE FUNCTION public.platform_webhook_emit(p_workspace uuid, p_type text, p_data jsonb, p_event text DEFAULT NULL) RETURNS integer
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
  PERFORM public.platform_notify(p_workspace, p_type, p_data);
  RETURN v_count;
END;
$$;

-- The event triggers used to stop when no platform webhook existed; admins
-- are notified anyway now.
CREATE OR REPLACE FUNCTION public.platform_webhook_active() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
    AS $$ SELECT true $$;

-- New entry in the complaints book (it had no platform event yet).
CREATE OR REPLACE FUNCTION public.platform_webhook_on_complaint() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.platform_webhook_emit_safe(NULL, 'complaint.created', jsonb_build_object(
    'complaint', jsonb_build_object('id', NEW.id, 'year', NEW.year, 'number', NEW.number, 'kind', NEW.kind,
      'consumer_name', NEW.consumer_name, 'email', NEW.email, 'created_at', NEW.created_at)));
  RETURN NULL;
END;
$$;
CREATE TRIGGER platform_webhook_events AFTER INSERT ON public.complaints FOR EACH ROW EXECUTE FUNCTION public.platform_webhook_on_complaint();
