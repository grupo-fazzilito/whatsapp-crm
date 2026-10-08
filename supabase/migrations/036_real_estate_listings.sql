-- ============================================================
-- 036 — Real estate: listing status, sales pipeline, owner captures
--
-- 1. pipelines.key / pipeline_stages.key: stable identifiers so code
--    (the AI lead engine) can move deals by stage key instead of name.
-- 2. ensure_real_estate_pipeline(ws): idempotent "Ventas inmobiliarias"
--    pipeline (7 keyed stages) + real-estate lost reasons. Runs on
--    workspace creation (industry real_estate), as a backfill below, and
--    from POST /api/real-estate/pipeline (service role).
-- 3. Listing status: products of real_estate workspaces whose
--    attributes.listing_status is sold/rented are forced inactive, so the
--    AI (which only reads active products) never offers them. Moving a
--    listing back to available/reserved re-activates it unless the same
--    write also sets is_active explicitly.
-- 4. property_captures: owners who want to sell/rent their property
--    through the agency ("Captación"), created by the AI or manually.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Stable keys
-- ------------------------------------------------------------
ALTER TABLE public.pipelines ADD COLUMN IF NOT EXISTS key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pipelines_ws_key
  ON public.pipelines(workspace_id, key) WHERE key IS NOT NULL;

ALTER TABLE public.pipeline_stages ADD COLUMN IF NOT EXISTS key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pipeline_stages_key
  ON public.pipeline_stages(pipeline_id, key) WHERE key IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Real-estate sales pipeline
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_real_estate_pipeline(ws UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid UUID;
  loc TEXT;
  s JSONB;
  reasons JSONB;
  stage_keys TEXT[] := ARRAY['new', 'qualified', 'viewing_scheduled', 'viewed', 'negotiation', 'reservation', 'won'];
  colors TEXT[] := ARRAY['#3b82f6', '#06b6d4', '#8b5cf6', '#a855f7', '#f97316', '#eab308', '#22c55e'];
  names TEXT[];
  i INT;
BEGIN
  SELECT w.locale, COALESCE(w.settings, '{}'::jsonb) INTO loc, s FROM public.workspaces w WHERE w.id = ws;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Serialize concurrent calls for the same workspace (button double-click).
  PERFORM pg_advisory_xact_lock(hashtext('re_pipeline:' || ws::text));

  SELECT id INTO pid FROM public.pipelines WHERE workspace_id = ws AND key = 'real_estate';
  IF pid IS NULL THEN
    IF loc = 'en' THEN
      names := ARRAY['New lead', 'Qualified', 'Viewing scheduled', 'Viewed', 'Negotiation / Offer', 'Reservation', 'Closed won'];
    ELSE
      names := ARRAY['Nuevo lead', 'Calificado', 'Visita agendada', 'Visitó', 'Negociación / Oferta', 'Separación', 'Cierre ganado'];
    END IF;
    INSERT INTO public.pipelines (workspace_id, name, key, user_id)
    VALUES (ws, CASE WHEN loc = 'en' THEN 'Real estate sales' ELSE 'Ventas inmobiliarias' END, 'real_estate', NULL)
    RETURNING id INTO pid;
    FOR i IN 1 .. array_length(stage_keys, 1) LOOP
      INSERT INTO public.pipeline_stages (pipeline_id, workspace_id, name, position, color, key)
      VALUES (pid, ws, names[i], i - 1, colors[i], stage_keys[i]);
    END LOOP;
  END IF;

  -- Lost reasons: only when the workspace has none configured yet.
  IF jsonb_typeof(s #> '{crm,lost_reasons}') IS DISTINCT FROM 'array'
     OR jsonb_array_length(s #> '{crm,lost_reasons}') = 0 THEN
    IF loc = 'en' THEN
      reasons := '["Insufficient budget", "Did not qualify for a mortgage", "Chose another property", "Bought/rented through another agency", "Stopped responding", "Did not like the area", "Other"]'::jsonb;
    ELSE
      reasons := '["Presupuesto insuficiente", "No calificó para crédito", "Eligió otra propiedad", "Compró/alquiló con otra inmobiliaria", "Dejó de responder", "Zona no le convence", "Otro"]'::jsonb;
    END IF;
    UPDATE public.workspaces
    SET settings = jsonb_set(
      COALESCE(settings, '{}'::jsonb),
      '{crm}',
      CASE WHEN jsonb_typeof(settings -> 'crm') = 'object' THEN settings -> 'crm' ELSE '{}'::jsonb END
        || jsonb_build_object('lost_reasons', reasons)
    )
    WHERE id = ws;
  END IF;

  RETURN pid;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ensure_real_estate_pipeline(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_real_estate_pipeline(UUID) TO service_role;

-- New real-estate workspaces get the pipeline right away. Never blocks
-- workspace creation (signup runs inside handle_new_user).
CREATE OR REPLACE FUNCTION public.workspaces_real_estate_seed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.industry = 'real_estate' THEN
    BEGIN
      PERFORM public.ensure_real_estate_pipeline(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'real-estate pipeline seed failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS workspaces_real_estate_seed ON public.workspaces;
CREATE TRIGGER workspaces_real_estate_seed AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.workspaces_real_estate_seed();

-- Backfill existing real-estate workspaces.
DO $$
DECLARE w RECORD;
BEGIN
  FOR w IN SELECT id FROM public.workspaces WHERE industry = 'real_estate' LOOP
    PERFORM public.ensure_real_estate_pipeline(w.id);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3. Listing status → visibility
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.products_listing_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  st TEXT := NEW.attributes ->> 'listing_status';
  old_st TEXT := CASE WHEN TG_OP = 'UPDATE' THEN OLD.attributes ->> 'listing_status' END;
BEGIN
  IF st IS NULL AND old_st IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = NEW.workspace_id AND industry = 'real_estate') THEN
    RETURN NEW;
  END IF;
  IF st IN ('sold', 'rented') THEN
    NEW.is_active := false;
  ELSIF TG_OP = 'UPDATE' AND old_st IN ('sold', 'rented') AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN
    NEW.is_active := true;
  END IF;
  RETURN NEW;
END;
$$;
-- After a_products_null_defaults, before products_search_refresh (name order).
DROP TRIGGER IF EXISTS b_products_listing_status ON public.products;
CREATE TRIGGER b_products_listing_status BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_listing_status();

-- ------------------------------------------------------------
-- 4. Owner captures ("Captación")
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.property_captures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE DEFAULT public.active_ws(),
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  owner_name TEXT,
  owner_phone TEXT,
  operation TEXT CHECK (operation IN ('sale', 'rent')),
  property_type TEXT,
  address TEXT,
  district TEXT,
  area_m2 NUMERIC(12,2),
  bedrooms INTEGER,
  bathrooms INTEGER,
  parking INTEGER,
  expected_price NUMERIC(14,2),
  currency TEXT,
  description TEXT,
  -- Photo references: https URLs (catalog bucket / external),
  -- /api/media/{channelId}/{mediaId} (WhatsApp proxy) or
  -- sb://attachments/<path> (private attachments bucket).
  photos TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'evaluated', 'signed', 'rejected', 'published')),
  assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('ai', 'manual')),
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_property_captures_ws_status ON public.property_captures(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_captures_contact ON public.property_captures(contact_id);
CREATE INDEX IF NOT EXISTS idx_property_captures_conversation ON public.property_captures(conversation_id);
DROP TRIGGER IF EXISTS set_updated_at ON public.property_captures;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.property_captures
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.property_captures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_member_read ON public.property_captures;
CREATE POLICY ws_member_read ON public.property_captures FOR SELECT
  USING (public.ws_access(workspace_id));
DROP POLICY IF EXISTS ws_member_insert ON public.property_captures;
CREATE POLICY ws_member_insert ON public.property_captures FOR INSERT
  WITH CHECK (public.ws_access(workspace_id));
DROP POLICY IF EXISTS ws_member_update ON public.property_captures;
CREATE POLICY ws_member_update ON public.property_captures FOR UPDATE
  USING (public.ws_access(workspace_id)) WITH CHECK (public.ws_access(workspace_id));
DROP POLICY IF EXISTS ws_admin_delete ON public.property_captures;
CREATE POLICY ws_admin_delete ON public.property_captures FOR DELETE
  USING (public.ws_access(workspace_id, 'admin'));

NOTIFY pgrst, 'reload schema';
