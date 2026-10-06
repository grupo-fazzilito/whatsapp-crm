-- ============================================================
-- 022 — Channels (omnichannel) + AI agents
--
-- channels        one row per connected account: each WhatsApp number,
--                 Facebook page, Instagram account, TikTok account or
--                 web-chat widget. A workspace can have many.
-- channel_secrets encrypted credentials, service-role only (no client
--                 policies at all, so tokens never reach the browser).
-- ai_agents       AI personas a workspace builds (tone, personality,
--                 instructions, skills). Each channel may point to one;
--                 a channel without an agent is handled by humans only.
-- contact_identities  how a contact is known on each channel (phone,
--                 PSID, IGSID, TikTok id, web visitor id).
--
-- whatsapp_config rows are migrated into channels. The table stays for
-- now (read-only legacy) and is dropped in a later migration.
-- ============================================================

-- ------------------------------------------------------------
-- AI agents
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE DEFAULT public.active_ws(),
  name TEXT NOT NULL,
  avatar_url TEXT,
  -- Who the agent is ("Sofía, recepcionista amable de la barbería").
  persona TEXT,
  tone TEXT NOT NULL DEFAULT 'friendly',
  -- Free-form instructions the owner writes (do/don't, sales pitch...).
  instructions TEXT,
  -- 'auto' answers in the customer's language.
  language TEXT NOT NULL DEFAULT 'auto' CHECK (language IN ('auto', 'es', 'en')),
  -- What the agent may do: faq, bookings, catalog, orders, handover.
  skills TEXT[] NOT NULL DEFAULT ARRAY['faq', 'handover'],
  greeting_message TEXT,
  after_hours_message TEXT,
  escalation_keywords TEXT[] NOT NULL DEFAULT ARRAY['humano', 'agente', 'asesor', 'human', 'agent'],
  -- Optional: only answer within business hours.
  business_hours_only BOOLEAN NOT NULL DEFAULT false,
  -- Optional model override, e.g. 'gemini-2.5-flash'. NULL = platform default.
  model TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_agents_workspace ON public.ai_agents(workspace_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.ai_agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- Channels
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE DEFAULT public.active_ws(),
  type TEXT NOT NULL CHECK (type IN ('whatsapp', 'messenger', 'instagram', 'tiktok', 'webchat')),
  name TEXT NOT NULL,
  -- What the channel is for: shown in the inbox ("Atención", "Ventas"...).
  purpose TEXT,
  -- Provider id that inbound webhooks carry: WhatsApp phone_number_id,
  -- Facebook page id, Instagram account id, TikTok business id, or the
  -- widget public key for web chat.
  external_id TEXT NOT NULL,
  -- Human-readable handle: +52 55..., @cuenta, page name, domain.
  display_handle TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected', 'error')),
  status_detail TEXT,
  -- Non-secret per-type config (waba_id, page_id, widget colors, allowed origins...).
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_agent_id UUID REFERENCES public.ai_agents(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (type, external_id)
);
CREATE INDEX IF NOT EXISTS idx_channels_workspace ON public.channels(workspace_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.channels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.channel_secrets (
  channel_id UUID PRIMARY KEY REFERENCES public.channels(id) ON DELETE CASCADE,
  -- Values are encrypted with ENCRYPTION_KEY (AES-256-GCM) by the app.
  secrets JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Contact identities
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('whatsapp', 'messenger', 'instagram', 'tiktok', 'webchat')),
  external_id TEXT NOT NULL,
  handle TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, channel_type, external_id)
);
CREATE INDEX IF NOT EXISTS idx_contact_identities_contact ON public.contact_identities(contact_id);
CREATE TRIGGER set_ws_from_parent BEFORE INSERT ON public.contact_identities
  FOR EACH ROW EXECUTE FUNCTION public.set_ws_from_parent('contacts', 'contact_id');

-- ------------------------------------------------------------
-- Existing tables
-- ------------------------------------------------------------
ALTER TABLE public.contacts ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ai_state JSONB NOT NULL DEFAULT '{}'::jsonb;
-- When an agent takes over, the AI stays quiet until this time (or until
-- the conversation is handed back).
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ai_paused_until TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_conversations_channel ON public.conversations(channel_id);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned ON public.conversations(workspace_id, assigned_agent_id);

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS ai_agent_id UUID REFERENCES public.ai_agents(id) ON DELETE SET NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_content_type_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_content_type_check CHECK (content_type IN
  ('text', 'image', 'document', 'audio', 'video', 'location', 'template', 'interactive', 'sticker', 'system'));
CREATE INDEX IF NOT EXISTS idx_messages_external ON public.messages(workspace_id, message_id);

ALTER TABLE public.message_templates ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES public.channels(id) ON DELETE CASCADE;
ALTER TABLE public.broadcasts ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES public.channels(id) ON DELETE SET NULL;

-- ------------------------------------------------------------
-- Data migration
-- ------------------------------------------------------------

-- ai_settings (one per clinic) → a default agent per workspace.
INSERT INTO public.ai_agents (workspace_id, name, tone, skills, greeting_message, after_hours_message, escalation_keywords, enabled, created_by)
SELECT c.workspace_id,
       'Asistente principal',
       COALESCE(s.ai_tone, 'friendly'),
       ARRAY['faq', 'bookings', 'handover'],
       s.greeting_message,
       s.after_hours_message,
       COALESCE(s.escalation_keywords, ARRAY['humano', 'agente', 'human', 'agent']),
       COALESCE(s.ai_enabled, true),
       c.user_id
FROM public.ai_settings s
JOIN public.clinics c ON c.id = s.clinic_id
WHERE NOT EXISTS (SELECT 1 FROM public.ai_agents a WHERE a.workspace_id = c.workspace_id);

-- whatsapp_config → channels (+ secrets), linked to the default agent.
WITH moved AS (
  INSERT INTO public.channels (workspace_id, type, name, purpose, external_id, status, settings, ai_agent_id, created_by)
  SELECT w.workspace_id, 'whatsapp', 'WhatsApp', NULL, w.phone_number_id,
         CASE WHEN w.status = 'connected' THEN 'connected' ELSE 'disconnected' END,
         jsonb_build_object('waba_id', w.waba_id),
         (SELECT a.id FROM public.ai_agents a WHERE a.workspace_id = w.workspace_id ORDER BY a.created_at LIMIT 1),
         w.user_id
  FROM public.whatsapp_config w
  ON CONFLICT (type, external_id) DO NOTHING
  RETURNING id, workspace_id, external_id
)
INSERT INTO public.channel_secrets (channel_id, secrets)
SELECT m.id, jsonb_strip_nulls(jsonb_build_object('access_token', w.access_token, 'verify_token', w.verify_token))
FROM moved m
JOIN public.whatsapp_config w ON w.phone_number_id = m.external_id AND w.workspace_id = m.workspace_id;

-- Existing conversations belonged to the workspace's only WhatsApp number.
UPDATE public.conversations cv
SET channel_id = ch.id
FROM public.channels ch
WHERE cv.channel_id IS NULL AND ch.workspace_id = cv.workspace_id AND ch.type = 'whatsapp';

-- Existing contacts are WhatsApp contacts identified by phone.
INSERT INTO public.contact_identities (workspace_id, contact_id, channel_type, external_id, handle)
SELECT workspace_id, id, 'whatsapp', regexp_replace(phone, '[^0-9]', '', 'g'), phone
FROM public.contacts
WHERE phone IS NOT NULL AND regexp_replace(phone, '[^0-9]', '', 'g') <> ''
ON CONFLICT (workspace_id, channel_type, external_id) DO NOTHING;

UPDATE public.message_templates t
SET channel_id = ch.id
FROM public.channels ch
WHERE t.channel_id IS NULL AND ch.workspace_id = t.workspace_id AND ch.type = 'whatsapp';

-- Templates are unique per workspace + name + language (sync upserts on it).
DELETE FROM public.message_templates a USING public.message_templates b
WHERE a.workspace_id = b.workspace_id AND a.name = b.name AND a.language = b.language AND a.created_at < b.created_at;
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_templates_ws_name_lang
  ON public.message_templates (workspace_id, name, language);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_secrets ENABLE ROW LEVEL SECURITY;  -- no policies: service role only
ALTER TABLE public.contact_identities ENABLE ROW LEVEL SECURITY;

CREATE POLICY ws_member_read ON public.ai_agents FOR SELECT USING (public.ws_access(workspace_id));
CREATE POLICY ws_admin_write ON public.ai_agents FOR ALL
  USING (public.ws_access(workspace_id, 'admin')) WITH CHECK (public.ws_access(workspace_id, 'admin'));

CREATE POLICY ws_member_read ON public.channels FOR SELECT USING (public.ws_access(workspace_id));
CREATE POLICY ws_admin_write ON public.channels FOR ALL
  USING (public.ws_access(workspace_id, 'admin')) WITH CHECK (public.ws_access(workspace_id, 'admin'));

CREATE POLICY ws_member_all ON public.contact_identities FOR ALL
  USING (public.ws_access(workspace_id)) WITH CHECK (public.ws_access(workspace_id));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'channels') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.channels;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
