-- WhatsApp calls answered by an AI agent (voice service, see voice/).
--   ai_agent_id    the agent that took the call (null = a person or nobody)
--   ai_transcript  [{role: 'user' | 'assistant', text, at}] sent by the voice service
--   ai_summary     short summary written after the call
--   billed_at      'call_minute' tokens charged (once per call)
-- How each number answers lives in channels.settings.calling.ai (no column).
ALTER TABLE public.whatsapp_calls
  ADD COLUMN ai_agent_id uuid REFERENCES public.ai_agents (id) ON DELETE SET NULL,
  ADD COLUMN ai_transcript jsonb,
  ADD COLUMN ai_summary text,
  ADD COLUMN billed_at timestamptz;
