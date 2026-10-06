-- ============================================================
-- 021 — Workspaces (multi-tenant foundation)
--
-- Every business is a workspace. Users join workspaces through
-- workspace_members with a role (owner > admin > agent). All tenant
-- data carries a workspace_id and RLS checks membership instead of
-- auth.uid() = user_id.
--
-- Existing data is converted: one workspace per existing profile,
-- with that user as owner. user_id columns are kept as "created by"
-- (nullable, ON DELETE SET NULL) so removing a member never deletes
-- the business's data.
--
-- Active workspace: clients send the `x-workspace-id` header. RLS
-- intersects it with membership, so a user who belongs to several
-- workspaces only sees the active one even on unfiltered queries.
-- Inserts default workspace_id from the same header.
-- ============================================================

-- ------------------------------------------------------------
-- Core tables
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  industry TEXT NOT NULL DEFAULT 'generic',
  country TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  locale TEXT NOT NULL DEFAULT 'es' CHECK (locale IN ('es', 'en')),
  description TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  google_map_link TEXT,
  logo_url TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.workspace_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('owner', 'admin', 'agent')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON public.workspace_members(user_id);

CREATE TABLE IF NOT EXISTS public.workspace_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin', 'agent')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_ws ON public.workspace_invitations(workspace_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.workspaces;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at ON public.workspace_members;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'es';

-- ------------------------------------------------------------
-- Helper functions
-- ------------------------------------------------------------

-- Workspace selected by the client (x-workspace-id header), or NULL.
CREATE OR REPLACE FUNCTION public.active_ws()
RETURNS UUID
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  raw TEXT;
BEGIN
  raw := NULLIF(current_setting('request.headers', true), '')::json ->> 'x-workspace-id';
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.ws_role_rank(r TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE r WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 WHEN 'agent' THEN 1 ELSE 0 END
$$;

-- True when the current user is an active member of `ws` with at least `min_role`.
CREATE OR REPLACE FUNCTION public.is_ws_member(ws UUID, min_role TEXT DEFAULT 'agent')
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = ws
      AND m.user_id = auth.uid()
      AND m.status = 'active'
      AND public.ws_role_rank(m.role) >= public.ws_role_rank(min_role)
  )
$$;

-- Row is visible when the user is a member AND it belongs to the active
-- workspace (when the client declared one).
CREATE OR REPLACE FUNCTION public.ws_access(ws UUID, min_role TEXT DEFAULT 'agent')
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT public.is_ws_member(ws, min_role)
     AND ws = COALESCE(public.active_ws(), ws)
$$;

GRANT EXECUTE ON FUNCTION public.active_ws() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ws_role_rank(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_ws_member(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ws_access(UUID, TEXT) TO authenticated, service_role;

-- First workspace a user owns (used to backfill legacy writes that only
-- carry user_id, e.g. service-role code paths not yet migrated).
CREATE OR REPLACE FUNCTION public.default_ws_for_user(uid UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.workspace_id FROM public.workspace_members m
  WHERE m.user_id = uid AND m.status = 'active'
  ORDER BY public.ws_role_rank(m.role) DESC, m.created_at ASC
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.industry_from_business_type(bt TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN bt IS NULL OR bt = '' THEN 'generic'
    WHEN lower(bt) LIKE 'healthcare%' THEN 'clinic'
    WHEN lower(bt) = 'education' THEN 'academy'
    WHEN lower(bt) LIKE 'hotel%' OR lower(bt) LIKE '%restaurant%' THEN 'restaurant'
    WHEN lower(bt) IN ('clinic','barbershop','spa_salon','academy','restaurant','store','real_estate','generic') THEN lower(bt)
    ELSE 'generic'
  END
$$;

CREATE OR REPLACE FUNCTION public.make_ws_slug(n TEXT)
RETURNS TEXT
LANGUAGE sql
VOLATILE
AS $$
  SELECT COALESCE(NULLIF(trim(both '-' from regexp_replace(lower(COALESCE(n, '')), '[^a-z0-9]+', '-', 'g')), ''), 'workspace')
         || '-' || substr(md5(random()::text), 1, 6)
$$;

-- ------------------------------------------------------------
-- Backfill: one workspace per existing profile
-- ------------------------------------------------------------
DO $$
DECLARE
  p RECORD;
  ws UUID;
  wname TEXT;
BEGIN
  FOR p IN SELECT * FROM public.profiles LOOP
    IF EXISTS (SELECT 1 FROM public.workspace_members WHERE user_id = p.user_id) THEN
      CONTINUE;
    END IF;
    wname := COALESCE(NULLIF(p.business_name, ''), NULLIF(p.full_name, ''), split_part(p.email, '@', 1));
    INSERT INTO public.workspaces (name, slug, industry, created_by)
    VALUES (wname, public.make_ws_slug(wname), public.industry_from_business_type(p.business_type), p.user_id)
    RETURNING id INTO ws;
    INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (ws, p.user_id, 'owner');
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- workspace_id on every tenant table
-- ------------------------------------------------------------

-- Fills workspace_id on insert for top-level tables: explicit value >
-- active workspace header > the creator's default workspace.
CREATE OR REPLACE FUNCTION public.set_ws_from_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    NEW.workspace_id := COALESCE(public.active_ws(), public.default_ws_for_user(NEW.user_id));
  END IF;
  RETURN NEW;
END;
$$;

-- Fills workspace_id on insert for child tables from their parent row.
-- TG_ARGV[0] = parent table, TG_ARGV[1] = FK column on the child.
CREATE OR REPLACE FUNCTION public.set_ws_from_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_id UUID;
BEGIN
  IF NEW.workspace_id IS NULL THEN
    parent_id := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
    IF parent_id IS NOT NULL THEN
      EXECUTE format('SELECT workspace_id FROM public.%I WHERE id = $1', TG_ARGV[0])
        INTO NEW.workspace_id USING parent_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
  -- Tables that own a user_id today.
  top_tables TEXT[] := ARRAY[
    'contacts','tags','custom_fields','contact_notes','conversations','whatsapp_config',
    'message_templates','pipelines','deals','broadcasts','automations','automation_logs',
    'automation_pending_executions','flows','flow_runs','clinics'
  ];
  -- child table, parent table, fk column (order matters: parents first)
  children TEXT[][] := ARRAY[
    ARRAY['contact_tags','contacts','contact_id'],
    ARRAY['contact_custom_values','contacts','contact_id'],
    ARRAY['messages','conversations','conversation_id'],
    ARRAY['message_reactions','conversations','conversation_id'],
    ARRAY['pipeline_stages','pipelines','pipeline_id'],
    ARRAY['broadcast_recipients','broadcasts','broadcast_id'],
    ARRAY['automation_steps','automations','automation_id'],
    ARRAY['flow_nodes','flows','flow_id'],
    ARRAY['flow_run_events','flow_runs','flow_run_id'],
    ARRAY['clinic_timings','clinics','clinic_id'],
    ARRAY['doctors','clinics','clinic_id'],
    ARRAY['clinic_services','clinics','clinic_id'],
    ARRAY['clinic_faqs','clinics','clinic_id'],
    ARRAY['ai_settings','clinics','clinic_id'],
    ARRAY['appointments','clinics','clinic_id'],
    ARRAY['ai_chat_logs','clinics','clinic_id'],
    ARRAY['patient_intake','clinics','clinic_id'],
    ARRAY['patient_feedback','clinics','clinic_id']
  ];
  c TEXT[];
  fk RECORD;
BEGIN
  FOREACH t IN ARRAY top_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE', t);
    EXECUTE format('UPDATE public.%I SET workspace_id = public.default_ws_for_user(user_id) WHERE workspace_id IS NULL', t);
    EXECUTE format('DELETE FROM public.%I WHERE workspace_id IS NULL', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN workspace_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN workspace_id SET DEFAULT public.active_ws()', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(workspace_id)', 'idx_' || t || '_workspace', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN user_id DROP NOT NULL', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN user_id SET DEFAULT auth.uid()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS set_ws_from_user ON public.%I', t);
    EXECUTE format('CREATE TRIGGER set_ws_from_user BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_ws_from_user()', t);

    -- user_id now means "created by": never cascade-delete business data.
    FOR fk IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = format('public.%I', t)::regclass AND contype = 'f'
        AND pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (user_id) REFERENCES auth.users%'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', t, fk.conname);
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL', t, fk.conname);
    END LOOP;
  END LOOP;

  FOREACH c SLICE 1 IN ARRAY children LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE', c[1]);
    EXECUTE format('UPDATE public.%I ch SET workspace_id = p.workspace_id FROM public.%I p WHERE p.id = ch.%I AND ch.workspace_id IS NULL', c[1], c[2], c[3]);
    EXECUTE format('DELETE FROM public.%I WHERE workspace_id IS NULL', c[1]);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN workspace_id SET NOT NULL', c[1]);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(workspace_id)', 'idx_' || c[1] || '_workspace', c[1]);
    EXECUTE format('DROP TRIGGER IF EXISTS set_ws_from_parent ON public.%I', c[1]);
    EXECUTE format('CREATE TRIGGER set_ws_from_parent BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_ws_from_parent(%L, %L)', c[1], c[2], c[3]);
  END LOOP;
END $$;

-- One-per-user constraints become one-per-workspace.
ALTER TABLE public.clinics DROP CONSTRAINT IF EXISTS clinics_user_id_key;
ALTER TABLE public.clinics ADD CONSTRAINT clinics_workspace_id_key UNIQUE (workspace_id);
ALTER TABLE public.whatsapp_config DROP CONSTRAINT IF EXISTS whatsapp_config_user_id_key;
ALTER TABLE public.whatsapp_config ADD CONSTRAINT whatsapp_config_workspace_id_key UNIQUE (workspace_id);
DROP INDEX IF EXISTS public.idx_one_active_run_per_contact;
CREATE UNIQUE INDEX idx_one_active_run_per_contact ON public.flow_runs (workspace_id, contact_id) WHERE status = 'active';

-- ------------------------------------------------------------
-- RLS: replace every per-user policy with membership checks
-- ------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
  t TEXT;
  -- Any member can read and write.
  member_tables TEXT[] := ARRAY[
    'contacts','contact_tags','contact_custom_values','contact_notes','conversations','messages',
    'deals','automation_logs','appointments','ai_chat_logs','patient_intake','patient_feedback'
  ];
  -- Members read, admins write.
  admin_tables TEXT[] := ARRAY[
    'tags','custom_fields','whatsapp_config','message_templates','pipelines','pipeline_stages',
    'broadcasts','broadcast_recipients','automations','automation_steps','flows','flow_nodes',
    'clinics','clinic_timings','doctors','clinic_services','clinic_faqs','ai_settings'
  ];
  -- Members read; writes are service-role only.
  readonly_tables TEXT[] := ARRAY['flow_runs','flow_run_events'];
  all_tables TEXT[];
BEGIN
  all_tables := member_tables || admin_tables || readonly_tables
                || ARRAY['message_reactions','automation_pending_executions'];

  FOREACH t IN ARRAY all_tables LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;

  FOREACH t IN ARRAY member_tables LOOP
    EXECUTE format($p$CREATE POLICY ws_member_all ON public.%I FOR ALL
      USING (public.ws_access(workspace_id)) WITH CHECK (public.ws_access(workspace_id))$p$, t);
  END LOOP;

  FOREACH t IN ARRAY admin_tables LOOP
    EXECUTE format($p$CREATE POLICY ws_member_read ON public.%I FOR SELECT
      USING (public.ws_access(workspace_id))$p$, t);
    EXECUTE format($p$CREATE POLICY ws_admin_write ON public.%I FOR ALL
      USING (public.ws_access(workspace_id, 'admin')) WITH CHECK (public.ws_access(workspace_id, 'admin'))$p$, t);
  END LOOP;

  FOREACH t IN ARRAY readonly_tables LOOP
    EXECUTE format($p$CREATE POLICY ws_member_read ON public.%I FOR SELECT
      USING (public.ws_access(workspace_id))$p$, t);
  END LOOP;
END $$;

-- Reactions: any member reads/adds; agents only edit their own.
CREATE POLICY ws_member_read ON public.message_reactions FOR SELECT
  USING (public.ws_access(workspace_id));
CREATE POLICY ws_member_insert ON public.message_reactions FOR INSERT
  WITH CHECK (public.ws_access(workspace_id));
CREATE POLICY ws_own_update ON public.message_reactions FOR UPDATE
  USING (actor_type = 'agent' AND actor_id = auth.uid() AND public.ws_access(workspace_id));
CREATE POLICY ws_own_delete ON public.message_reactions FOR DELETE
  USING (actor_type = 'agent' AND actor_id = auth.uid() AND public.ws_access(workspace_id));

-- Workspaces / members / invitations
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;

-- Members see every workspace they belong to (needed for the switcher,
-- so this one deliberately ignores the active-workspace header).
CREATE POLICY ws_read ON public.workspaces FOR SELECT USING (public.is_ws_member(id));
CREATE POLICY ws_update ON public.workspaces FOR UPDATE
  USING (public.is_ws_member(id, 'admin')) WITH CHECK (public.is_ws_member(id, 'admin'));
-- Creation and deletion go through server routes (service role).

CREATE POLICY wsm_read ON public.workspace_members FOR SELECT
  USING (user_id = auth.uid() OR public.is_ws_member(workspace_id));
CREATE POLICY wsm_admin_write ON public.workspace_members FOR ALL
  USING (public.is_ws_member(workspace_id, 'admin')) WITH CHECK (public.is_ws_member(workspace_id, 'admin'));

CREATE POLICY wsi_admin_all ON public.workspace_invitations FOR ALL
  USING (public.is_ws_member(workspace_id, 'admin')) WITH CHECK (public.is_ws_member(workspace_id, 'admin'));

-- Teammates can see each other's basic profile (name/avatar in inbox).
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY profiles_read ON public.profiles FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.workspace_members mine
    JOIN public.workspace_members theirs ON theirs.workspace_id = mine.workspace_id
    WHERE mine.user_id = auth.uid() AND theirs.user_id = profiles.user_id
  )
);
-- Users must not grant themselves platform admin.
CREATE OR REPLACE FUNCTION public.protect_platform_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin
     AND COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
    NEW.is_platform_admin := OLD.is_platform_admin;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS protect_platform_admin ON public.profiles;
CREATE TRIGGER protect_platform_admin BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_platform_admin();

-- Portfolio (marketing showcase) is platform content: only platform admins write.
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'portfolio_items' AND cmd <> 'SELECT' LOOP
    EXECUTE format('DROP POLICY %I ON public.portfolio_items', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY portfolio_platform_admin_write ON public.portfolio_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_platform_admin))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_platform_admin));

-- ------------------------------------------------------------
-- Signup: profile + workspace (+ owner membership)
-- Users who sign up from an invitation (metadata.invite = true) get
-- no workspace of their own; the invite route adds the membership.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  ws UUID;
  wname TEXT;
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email, business_name, business_type, locale)
  VALUES (
    NEW.id,
    COALESCE(meta ->> 'full_name', ''),
    NEW.email,
    COALESCE(meta ->> 'business_name', ''),
    COALESCE(meta ->> 'business_type', ''),
    CASE WHEN meta ->> 'locale' IN ('es', 'en') THEN meta ->> 'locale' ELSE 'es' END
  );

  IF COALESCE((meta ->> 'invite')::boolean, false) THEN
    RETURN NEW;
  END IF;

  wname := COALESCE(NULLIF(meta ->> 'business_name', ''), NULLIF(meta ->> 'full_name', ''), split_part(NEW.email, '@', 1));
  INSERT INTO public.workspaces (name, slug, industry, country, currency, timezone, locale, created_by)
  VALUES (
    wname,
    public.make_ws_slug(wname),
    public.industry_from_business_type(meta ->> 'business_type'),
    NULLIF(meta ->> 'country', ''),
    COALESCE(NULLIF(meta ->> 'currency', ''), 'USD'),
    COALESCE(NULLIF(meta ->> 'timezone', ''), 'UTC'),
    CASE WHEN meta ->> 'locale' IN ('es', 'en') THEN meta ->> 'locale' ELSE 'es' END,
    NEW.id
  )
  RETURNING id INTO ws;
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (ws, NEW.id, 'owner');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Realtime: membership rows (switcher refresh)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'workspace_members') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_members;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
