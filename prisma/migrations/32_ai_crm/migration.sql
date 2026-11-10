-- The AI agent registers what it learns in the CRM: the customer's data,
-- deals that follow the business's pipeline, tags, tasks and a summary note.
--   pipeline_stages.ai_hint    when a customer belongs in this stage, in the business's words (the AI reads it)
--   pipeline_stages.ai_events  facts that move a customer's deal here on their own:
--                              booking_created | booking_completed | order_created | order_paid
--   tags.ai_hint               when the AI should put this tag on a customer
--   ai_agents.crm_actions      the agent may write to the CRM (each action costs credits)
--   custom_fields.key          fixed key of a field the system creates (ai_extra_info = "Más información del cliente")
ALTER TABLE public.pipeline_stages
  ADD COLUMN ai_hint text,
  ADD COLUMN ai_events text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.pipeline_stages ADD CONSTRAINT pipeline_stages_ai_events_check
  CHECK (ai_events <@ ARRAY['booking_created', 'booking_completed', 'order_created', 'order_paid']::text[]);
ALTER TABLE public.tags ADD COLUMN ai_hint text;
ALTER TABLE public.ai_agents ADD COLUMN crm_actions boolean NOT NULL DEFAULT true;
ALTER TABLE public.custom_fields ADD COLUMN key text;
CREATE UNIQUE INDEX custom_fields_workspace_key ON public.custom_fields (workspace_id, key) WHERE key IS NOT NULL;

-- Timeline row for what the AI (or an automatic fact) wrote in the CRM.
ALTER TABLE public.conversation_events DROP CONSTRAINT conversation_events_type_check;
ALTER TABLE public.conversation_events ADD CONSTRAINT conversation_events_type_check
  CHECK (type = ANY (ARRAY['assigned', 'unassigned', 'transferred', 'resolved', 'reopened', 'priority', 'tag_added', 'tag_removed', 'call', 'ai_handover', 'ai_crm']));

-- Default meaning for the stages of the sales pipeline every business starts with.
CREATE OR REPLACE FUNCTION public.sales_stage_ai_defaults(pid uuid, loc text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.pipeline_stages s
     SET ai_hint = CASE s.key
       WHEN 'interested' THEN CASE WHEN loc = 'en'
         THEN 'The customer shows real interest in a product or service: asks for the price, availability or how to buy or book.'
         ELSE 'El cliente muestra interés concreto en un producto o servicio: pregunta el precio, la disponibilidad o cómo comprar o reservar.' END
       WHEN 'proposal' THEN CASE WHEN loc = 'en'
         THEN 'The customer received a concrete price or quote, or has products in the cart.'
         ELSE 'El cliente recibió un precio o una cotización concreta, o tiene productos en el carrito.' END
       WHEN 'negotiation' THEN CASE WHEN loc = 'en'
         THEN 'The customer negotiates terms (discount, payment method, dates) or says they will think about it.'
         ELSE 'El cliente negocia condiciones (descuento, forma de pago, fechas) o dice que lo va a pensar.' END
       WHEN 'closing' THEN CASE WHEN loc = 'en'
         THEN 'The customer confirms they buy or book.'
         ELSE 'El cliente confirma que compra o reserva.' END
       END,
         ai_events = CASE WHEN s.key = 'closing' THEN ARRAY['booking_created', 'order_created'] ELSE s.ai_events END
   WHERE s.pipeline_id = pid AND s.ai_hint IS NULL AND s.key IN ('interested', 'proposal', 'negotiation', 'closing');
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_sales_pipeline(ws uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  pid uuid;
  loc text;
  stage_keys text[] := ARRAY['new', 'contacted', 'interested', 'proposal', 'negotiation', 'closing'];
  colors text[] := ARRAY['#3b82f6', '#06b6d4', '#8b5cf6', '#f97316', '#eab308', '#22c55e'];
  names text[];
  i int;
BEGIN
  SELECT w.locale INTO loc FROM public.workspaces w WHERE w.id = ws;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('sales_pipeline:' || ws::text));
  SELECT id INTO pid FROM public.pipelines WHERE workspace_id = ws AND key = 'sales';
  IF pid IS NULL THEN
    IF loc = 'en' THEN
      names := ARRAY['New lead', 'Contacted', 'Interested', 'Proposal / Quote', 'Negotiation', 'Closing'];
    ELSE
      names := ARRAY['Nuevo lead', 'Contactado', 'Interesado', 'Propuesta / Cotización', 'Negociación', 'Cierre'];
    END IF;
    INSERT INTO public.pipelines (workspace_id, name, key, user_id)
    VALUES (ws, CASE WHEN loc = 'en' THEN 'Sales' ELSE 'Ventas' END, 'sales', NULL)
    RETURNING id INTO pid;
    FOR i IN 1 .. array_length(stage_keys, 1) LOOP
      INSERT INTO public.pipeline_stages (pipeline_id, workspace_id, name, position, color, key)
      VALUES (pid, ws, names[i], i - 1, colors[i], stage_keys[i]);
    END LOOP;
    PERFORM public.sales_stage_ai_defaults(pid, loc);
  END IF;
  RETURN pid;
END;
$$;

-- Existing sales pipelines get the default meanings (only stages still without one).
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN SELECT pl.id, w.locale FROM public.pipelines pl JOIN public.workspaces w ON w.id = pl.workspace_id WHERE pl.key = 'sales' LOOP
    PERFORM public.sales_stage_ai_defaults(p.id, p.locale);
  END LOOP;
END $$;

-- A fact (booking made or completed, order placed or paid) moves the
-- customer's open deal forward to the stage marked with it, or opens one
-- there. Never moves a deal back. Real estate keeps its own pipeline logic.
CREATE OR REPLACE FUNCTION public.crm_fact(ws uuid, contact uuid, conv uuid, fact text, amount numeric DEFAULT NULL, cur text DEFAULT NULL) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  st record;
  d record;
  cur_pos int;
  title text;
  moved boolean := false;
BEGIN
  IF contact IS NULL THEN
    RETURN;
  END IF;
  SELECT s.id, s.pipeline_id, s.position, s.name INTO st
    FROM public.pipeline_stages s JOIN public.pipelines p ON p.id = s.pipeline_id
   WHERE s.workspace_id = ws AND fact = ANY (s.ai_events) AND p.key IS DISTINCT FROM 'real_estate'
   ORDER BY p.created_at, s.position
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT dl.id, dl.stage_id, dl.value INTO d FROM public.deals dl
   WHERE dl.workspace_id = ws AND dl.contact_id = contact AND dl.pipeline_id = st.pipeline_id AND dl.status = 'open'
   ORDER BY dl.created_at DESC LIMIT 1;
  moved := FOUND;
  IF moved THEN
    SELECT position INTO cur_pos FROM public.pipeline_stages WHERE id = d.stage_id;
    IF cur_pos IS NOT NULL AND cur_pos >= st.position THEN
      -- Already there or further: only fill in the amount of an order.
      IF amount IS NOT NULL AND amount > 0 AND d.value = 0 THEN
        UPDATE public.deals SET value = amount, currency = COALESCE(cur, currency), updated_at = now() WHERE id = d.id;
      END IF;
      RETURN;
    END IF;
    UPDATE public.deals
       SET stage_id = st.id, updated_at = now(),
           value = CASE WHEN amount IS NOT NULL AND amount > 0 AND value = 0 THEN amount ELSE value END,
           currency = CASE WHEN amount IS NOT NULL AND amount > 0 AND value = 0 THEN COALESCE(cur, currency) ELSE currency END
     WHERE id = d.id;
  ELSE
    SELECT COALESCE(NULLIF(trim(c.name), ''), c.phone, 'Cliente') INTO title FROM public.contacts c WHERE c.id = contact;
    INSERT INTO public.deals (workspace_id, pipeline_id, stage_id, contact_id, conversation_id, title, value, currency, user_id)
    VALUES (ws, st.pipeline_id, st.id, contact, conv, COALESCE(title, 'Cliente'), COALESCE(amount, 0),
            COALESCE(cur, (SELECT w.currency FROM public.workspaces w WHERE w.id = ws), 'USD'), NULL);
  END IF;
  IF conv IS NOT NULL THEN
    INSERT INTO public.conversation_events (workspace_id, conversation_id, type, data)
    VALUES (ws, conv, 'ai_crm', jsonb_build_object('auto', true, 'fact', fact, 'actions',
            jsonb_build_array(jsonb_build_object('kind', CASE WHEN moved THEN 'deal_moved' ELSE 'deal_created' END, 'stage', st.name))));
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- A CRM hiccup never blocks a booking or an order.
  RAISE WARNING 'crm_fact % failed for %: %', fact, contact, SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.bookings_crm_fact() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' AND COALESCE(NEW.status, 'confirmed') IN ('pending', 'confirmed') THEN
    PERFORM public.crm_fact(NEW.workspace_id, NEW.contact_id, NEW.conversation_id, 'booking_created');
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    PERFORM public.crm_fact(NEW.workspace_id, NEW.contact_id, NEW.conversation_id, 'booking_completed');
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER bookings_crm_fact AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_crm_fact();

CREATE OR REPLACE FUNCTION public.orders_crm_fact() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    PERFORM public.crm_fact(NEW.workspace_id, NEW.contact_id, NEW.conversation_id, 'order_created', NEW.total, NEW.currency);
  END IF;
  IF NEW.payment_status = 'paid' AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM 'paid') THEN
    PERFORM public.crm_fact(NEW.workspace_id, NEW.contact_id, NEW.conversation_id, 'order_paid', NEW.total, NEW.currency);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER orders_crm_fact AFTER INSERT OR UPDATE OF payment_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_crm_fact();
