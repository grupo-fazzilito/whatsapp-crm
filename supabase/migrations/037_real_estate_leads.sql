-- ============================================================
-- 037 — Real estate leads: qualification profile, routing rules,
-- property ↔ lead matching alerts, viewing follow-up bookkeeping.
--
-- lead_profiles               one per contact and workspace: what the
--                             customer looks for (filled by the AI agent
--                             and editable by the team), score 0-100 and
--                             temperature hot|warm|cold.
-- real_estate_routing_rules   ordered rules: when a lead qualifies, the
--                             first active rule whose conditions match
--                             assigns the conversation to a member or a
--                             team (round robin inside the team).
-- property_match_jobs         queue filled by a trigger on products when
--                             a listing is created/activated or its price
--                             or status changes; the cron drains it and
--                             notifies the team / matching leads.
-- lead_property_alerts        which listing was already offered to which
--                             lead (never alert twice).
-- bookings                    + viewing bookkeeping (stage sync, location
--                             reminder, post-visit feedback).
-- ============================================================

-- ------------------------------------------------------------
-- Lead profiles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE DEFAULT public.active_ws(),
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  -- Latest conversation the profile was updated from (alerts / routing).
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  operation TEXT CHECK (operation IS NULL OR operation IN ('buy', 'rent')),
  property_types TEXT[] NOT NULL DEFAULT '{}',
  zones TEXT[] NOT NULL DEFAULT '{}',
  budget_min NUMERIC(14,2) CHECK (budget_min IS NULL OR budget_min >= 0),
  budget_max NUMERIC(14,2) CHECK (budget_max IS NULL OR budget_max >= 0),
  currency TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  bedrooms_min INTEGER CHECK (bedrooms_min IS NULL OR bedrooms_min BETWEEN 0 AND 50),
  bathrooms_min INTEGER CHECK (bathrooms_min IS NULL OR bathrooms_min BETWEEN 0 AND 50),
  parking_min INTEGER CHECK (parking_min IS NULL OR parking_min BETWEEN 0 AND 50),
  financing TEXT NOT NULL DEFAULT 'unknown' CHECK (financing IN ('cash', 'mortgage', 'unknown')),
  mortgage_preapproved BOOLEAN NOT NULL DEFAULT false,
  move_in TEXT CHECK (move_in IS NULL OR char_length(move_in) <= 120),
  purpose TEXT NOT NULL DEFAULT 'unknown' CHECK (purpose IN ('live', 'invest', 'unknown')),
  notes TEXT CHECK (notes IS NULL OR char_length(notes) <= 2000),
  score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  temperature TEXT NOT NULL DEFAULT 'cold' CHECK (temperature IN ('hot', 'warm', 'cold')),
  qualified_at TIMESTAMPTZ,
  alerts_opt_in BOOLEAN NOT NULL DEFAULT false,
  last_matched_at TIMESTAMPTZ,
  updated_by TEXT NOT NULL DEFAULT 'ai' CHECK (updated_by IN ('ai', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_profiles_ws_qualified ON public.lead_profiles(workspace_id, qualified_at);
CREATE INDEX IF NOT EXISTS idx_lead_profiles_ws_temp ON public.lead_profiles(workspace_id, temperature, score DESC);
CREATE INDEX IF NOT EXISTS idx_lead_profiles_zones ON public.lead_profiles USING GIN (zones);

DROP TRIGGER IF EXISTS set_updated_at ON public.lead_profiles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.lead_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Linked rows must live in the same workspace; the workspace never moves.
CREATE OR REPLACE FUNCTION public.lead_profiles_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.workspace_id := OLD.workspace_id;
    NEW.contact_id := OLD.contact_id;
    NEW.created_at := OLD.created_at;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'contact_other_workspace' USING ERRCODE = '23514';
  END IF;
  IF NEW.conversation_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = NEW.conversation_id AND c.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'conversation_other_workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS lead_profiles_guard ON public.lead_profiles;
CREATE TRIGGER lead_profiles_guard BEFORE INSERT OR UPDATE ON public.lead_profiles
  FOR EACH ROW EXECUTE FUNCTION public.lead_profiles_guard();

ALTER TABLE public.lead_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_member_all ON public.lead_profiles;
CREATE POLICY ws_member_all ON public.lead_profiles FOR ALL
  USING (public.ws_access(workspace_id)) WITH CHECK (public.ws_access(workspace_id));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'lead_profiles') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_profiles;
  END IF;
END $$;

-- ------------------------------------------------------------
-- Routing rules
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.real_estate_routing_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE DEFAULT public.active_ws(),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  -- Lower first.
  priority INTEGER NOT NULL DEFAULT 0,
  -- {zones: text[], operation: 'buy'|'rent'|null, property_types: text[],
  --  budget_min: number|null, budget_max: number|null}
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(conditions) = 'object'),
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Exactly one target.
  CHECK ((team_id IS NULL) <> (user_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_re_routing_rules_ws ON public.real_estate_routing_rules(workspace_id, active, priority);

DROP TRIGGER IF EXISTS set_updated_at ON public.real_estate_routing_rules;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.real_estate_routing_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public.re_routing_rules_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.workspace_id := OLD.workspace_id;
  END IF;
  IF NEW.team_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = NEW.team_id AND t.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'team_other_workspace' USING ERRCODE = '23514';
  END IF;
  IF NEW.user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.workspace_members m
                     WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.user_id AND m.status = 'active') THEN
    RAISE EXCEPTION 'user_not_member' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS re_routing_rules_guard ON public.real_estate_routing_rules;
CREATE TRIGGER re_routing_rules_guard BEFORE INSERT OR UPDATE ON public.real_estate_routing_rules
  FOR EACH ROW EXECUTE FUNCTION public.re_routing_rules_guard();

ALTER TABLE public.real_estate_routing_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_member_read ON public.real_estate_routing_rules;
CREATE POLICY ws_member_read ON public.real_estate_routing_rules FOR SELECT USING (public.ws_access(workspace_id));
DROP POLICY IF EXISTS ws_admin_write ON public.real_estate_routing_rules;
CREATE POLICY ws_admin_write ON public.real_estate_routing_rules FOR ALL
  USING (public.ws_access(workspace_id, 'admin')) WITH CHECK (public.ws_access(workspace_id, 'admin'));

-- ------------------------------------------------------------
-- Matching queue
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.property_match_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('created', 'activated', 'price', 'status')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
-- One pending job per listing: later edits fold into it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_match_jobs_pending ON public.property_match_jobs(product_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_property_match_jobs_due ON public.property_match_jobs(status, run_after);

ALTER TABLE public.property_match_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_member_read ON public.property_match_jobs;
CREATE POLICY ws_member_read ON public.property_match_jobs FOR SELECT USING (public.ws_access(workspace_id));

-- Listing status may live in a column (real-estate listings) or in
-- attributes; to_jsonb() reads either without depending on the column.
CREATE OR REPLACE FUNCTION public.listing_status_of(p public.products)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$ SELECT COALESCE(to_jsonb(p)->>'listing_status', p.attributes->>'listing_status') $$;

CREATE OR REPLACE FUNCTION public.enqueue_property_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  why TEXT;
BEGIN
  IF NOT NEW.is_active THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = NEW.workspace_id AND w.industry = 'real_estate') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    why := 'created';
  ELSIF NOT OLD.is_active THEN
    why := 'activated';
  ELSIF NEW.price IS DISTINCT FROM OLD.price THEN
    why := 'price';
  ELSIF public.listing_status_of(NEW) IS DISTINCT FROM public.listing_status_of(OLD) THEN
    why := 'status';
  ELSE
    RETURN NULL;
  END IF;
  -- Small delay so a listing being edited in several saves alerts once.
  INSERT INTO public.property_match_jobs (workspace_id, product_id, reason, run_after)
  VALUES (NEW.workspace_id, NEW.id, why, NOW() + INTERVAL '2 minutes')
  ON CONFLICT (product_id) WHERE status = 'pending'
  DO UPDATE SET run_after = EXCLUDED.run_after;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS enqueue_property_match ON public.products;
CREATE TRIGGER enqueue_property_match AFTER INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_property_match();

-- ------------------------------------------------------------
-- Alerts already sent (lead × listing)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_property_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_profile_id UUID NOT NULL REFERENCES public.lead_profiles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  -- 'customer' = sent to the lead; 'team' = only the team was told.
  delivery TEXT NOT NULL CHECK (delivery IN ('customer', 'team')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_profile_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_lead_property_alerts_ws ON public.lead_property_alerts(workspace_id, created_at);
ALTER TABLE public.lead_property_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_member_read ON public.lead_property_alerts;
CREATE POLICY ws_member_read ON public.lead_property_alerts FOR SELECT USING (public.ws_access(workspace_id));

-- ------------------------------------------------------------
-- Viewings (bookings with a property)
-- ------------------------------------------------------------
-- Deal moved to "visita agendada" for this booking.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS viewing_stage_synced_at TIMESTAMPTZ;
-- Location re-sent with the reminder before the visit.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS viewing_location_sent_at TIMESTAMPTZ;
-- Post-visit question sent (or skipped: closed reply window).
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS viewing_feedback_sent_at TIMESTAMPTZ;
-- Customer's answer: interested | others | not_convinced.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS viewing_feedback TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_viewing_feedback_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_viewing_feedback_check
      CHECK (viewing_feedback IS NULL OR viewing_feedback IN ('interested', 'others', 'not_convinced'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_bookings_viewing_pending ON public.bookings(booking_date)
  WHERE product_id IS NOT NULL AND viewing_feedback_sent_at IS NULL;
