-- ============================================================
-- 028 — AI usage metering
--
-- One row per model call: tokens reported by the provider and the cost
-- in USD at the price table in effect (platform_settings 'ai_pricing',
-- defaults in src/lib/ai/pricing.ts). Basis for client billing (fixed
-- price per AI reply) and for the platform's margin reports.
-- Written by the server (service role); workspace admins can read their
-- own usage.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ai_agent_id UUID REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL,
  -- reply | playground | import | triage | followup | catalog
  purpose TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(14,8) NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ws_created ON public.ai_usage(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON public.ai_usage(created_at DESC);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY ws_admin_read ON public.ai_usage FOR SELECT USING (public.ws_access(workspace_id, 'admin'));
