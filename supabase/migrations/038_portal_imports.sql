-- ============================================================
-- 038 — Portal imports (real estate)
--
-- Listings imported from the agency's own sources keep a link to where
-- they came from so a re-import updates them instead of duplicating:
--   products.external_source   'mercadolibre' | 'feed:<feed id>' | 'file:<label>'
--   products.external_id       id in that source (e.g. MPE123456789)
--   products.external_url      public link in the source (permalink)
--   products.external_synced_at last time an import wrote the row
--   products.external_missing_since set when the listing disappeared
--                              from its source (product deactivated, never
--                              deleted); cleared when it comes back.
--
-- portal_connections   one OAuth connection per workspace and provider
--                      (Mercado Libre). Tokens are encrypted by the app
--                      and the table is service-role only (no policies).
-- portal_feeds         XML / JSON / CSV feed URLs exported by the agency's
--                      own CRM / website, with the field mapping and an
--                      optional daily re-import.
-- portal_import_runs   history + last summary shown in the UI.
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS external_source TEXT CHECK (external_source IS NULL OR char_length(external_source) <= 120),
  ADD COLUMN IF NOT EXISTS external_id TEXT CHECK (external_id IS NULL OR char_length(external_id) <= 200),
  ADD COLUMN IF NOT EXISTS external_url TEXT CHECK (external_url IS NULL OR char_length(external_url) <= 2000),
  ADD COLUMN IF NOT EXISTS external_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS external_missing_since TIMESTAMPTZ;

-- NULLs are distinct: products without a source are unaffected.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_products_external') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT uq_products_external UNIQUE (workspace_id, external_source, external_id);
  END IF;
END $$;

-- ------------------------------------------------------------
-- OAuth connections (service role only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portal_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('mercadolibre')),
  external_user_id TEXT NOT NULL,
  nickname TEXT,
  site_id TEXT,
  -- AES-GCM ciphertexts (src/lib/whatsapp/encryption.ts).
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  last_error TEXT,
  auto_import BOOLEAN NOT NULL DEFAULT true,
  last_import_at TIMESTAMPTZ,
  connected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider)
);
DROP TRIGGER IF EXISTS set_updated_at ON public.portal_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.portal_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
ALTER TABLE public.portal_connections ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: tokens never reach the browser. The API
-- routes read it with the service role after checking the workspace.

-- ------------------------------------------------------------
-- Feeds
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portal_feeds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE DEFAULT public.active_ws(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  -- Which portal the agency publishes this data on (label only).
  portal TEXT NOT NULL DEFAULT 'other' CHECK (portal IN ('urbania', 'adondevivir', 'mercadolibre', 'own_crm', 'other')),
  url TEXT NOT NULL CHECK (url ~ '^https?://' AND char_length(url) <= 2000),
  format TEXT NOT NULL DEFAULT 'auto' CHECK (format IN ('auto', 'xml', 'json', 'csv')),
  -- {"<source path>": "<target>"}; target = fixed product column, attr:<key>, external_id, external_url
  mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Path of the repeated element that holds one listing (auto-detected).
  item_path TEXT,
  schedule TEXT NOT NULL DEFAULT 'daily' CHECK (schedule IN ('manual', 'daily')),
  deactivate_missing BOOLEAN NOT NULL DEFAULT true,
  last_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_portal_feeds_ws ON public.portal_feeds(workspace_id);
CREATE INDEX IF NOT EXISTS idx_portal_feeds_due ON public.portal_feeds(schedule, last_run_at);
DROP TRIGGER IF EXISTS set_updated_at ON public.portal_feeds;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.portal_feeds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- Import runs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.portal_import_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('mercadolibre', 'feed', 'file')),
  feed_id UUID REFERENCES public.portal_feeds(id) ON DELETE SET NULL,
  trigger TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'schedule')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'error')),
  total INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  deactivated INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  -- [{ref, error}] (max 50) and free-form notes (e.g. currencies seen).
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  started_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_portal_import_runs_ws ON public.portal_import_runs(workspace_id, started_at DESC);

-- ------------------------------------------------------------
-- RLS: admins of the workspace read/write feeds, read runs.
-- Runs are written by the server (service role).
-- ------------------------------------------------------------
ALTER TABLE public.portal_feeds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_admin_all ON public.portal_feeds;
CREATE POLICY ws_admin_all ON public.portal_feeds FOR ALL
  USING (public.ws_access(workspace_id, 'admin')) WITH CHECK (public.ws_access(workspace_id, 'admin'));

ALTER TABLE public.portal_import_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_admin_read ON public.portal_import_runs;
CREATE POLICY ws_admin_read ON public.portal_import_runs FOR SELECT
  USING (public.ws_access(workspace_id, 'admin'));

NOTIFY pgrst, 'reload schema';
