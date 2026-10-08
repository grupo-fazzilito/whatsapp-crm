-- ============================================================
-- 040 — AI assist in the inbox
--
-- messages       + transcript      (voice notes → text; automatic on
--                                   inbound audio or on demand)
--                + ai_media_text   (AI description / extracted text of
--                                   images and PDFs)
--                + ai_processed_at (last time AI read this media)
-- conversations  + ai_summary      (JSON text: key_points[],
--                                   customer_intent, pending[],
--                                   next_step, written in the workspace
--                                   language)
--                + ai_summary_at / ai_summary_by
-- ai_usage       + audio_seconds   (providers that bill audio per
--                                   minute, e.g. OpenAI whisper-1)
--
-- Writes happen server-side (service role) after the API checked the
-- caller can see the conversation; existing RLS policies of messages /
-- conversations already cover reads.
-- Workspace switches live in workspaces.settings.ai_assist
-- {auto_transcribe (default true), auto_read_images (default false)}.
-- ============================================================
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS transcript TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS ai_media_text TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS ai_processed_at TIMESTAMPTZ;

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ai_summary TEXT;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ai_summary_at TIMESTAMPTZ;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ai_summary_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.ai_usage ADD COLUMN IF NOT EXISTS audio_seconds NUMERIC(10,2);
