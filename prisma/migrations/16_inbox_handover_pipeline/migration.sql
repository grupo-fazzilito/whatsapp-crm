-- 1. Every business starts with a sales pipeline (real estate keeps its own).
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
  END IF;
  RETURN pid;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspaces_sales_pipeline_seed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.industry IS DISTINCT FROM 'real_estate' THEN
    BEGIN
      PERFORM public.ensure_sales_pipeline(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'sales pipeline seed failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER workspaces_sales_pipeline_seed AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.workspaces_sales_pipeline_seed();

-- Existing businesses without any pipeline get theirs now.
DO $$
DECLARE
  w record;
BEGIN
  FOR w IN SELECT id, industry FROM public.workspaces ws WHERE NOT EXISTS (SELECT 1 FROM public.pipelines p WHERE p.workspace_id = ws.id) LOOP
    IF w.industry = 'real_estate' THEN
      PERFORM public.ensure_real_estate_pipeline(w.id);
    ELSE
      PERFORM public.ensure_sales_pipeline(w.id);
    END IF;
  END LOOP;
END $$;

-- 2. AI → human handover shows in the conversation and notifies people.
ALTER TABLE public.conversation_events DROP CONSTRAINT conversation_events_type_check;
ALTER TABLE public.conversation_events ADD CONSTRAINT conversation_events_type_check
  CHECK (type = ANY (ARRAY['assigned', 'unassigned', 'transferred', 'resolved', 'reopened', 'priority', 'tag_added', 'tag_removed', 'call', 'ai_handover']));

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY['mention', 'assigned', 'transferred', 'system', 'billing', 'handover']));

-- 3. Who an AI agent hands conversations to: round-robin (auto), one member or a team.
ALTER TABLE public.ai_agents
  ADD COLUMN handover_mode text DEFAULT 'auto' NOT NULL CHECK (handover_mode IN ('auto', 'member', 'team')),
  ADD COLUMN handover_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN handover_team_id uuid REFERENCES public.teams (id) ON DELETE SET NULL;

-- 4. Conversations waiting for a person (AI handed over and nobody answered yet).
--    Cleared when a team member replies, resolves it or gives it back to the AI.
ALTER TABLE public.conversations ADD COLUMN needs_human_since timestamptz;
CREATE INDEX idx_conversations_needs_human ON public.conversations (workspace_id) WHERE needs_human_since IS NOT NULL;
