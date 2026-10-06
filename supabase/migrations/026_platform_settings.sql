-- ============================================================
-- 026 — Platform settings (SaaS operator configuration)
--
-- Key/value store edited from the platform admin panel. Secret values
-- (API keys) are encrypted by the app with ENCRYPTION_KEY before they
-- are stored. Service role only: RLS on, no policies, so no client
-- (not even workspace owners) can read it.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
