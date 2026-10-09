-- ============================================================
-- 044 — WhatsApp messages Meta bills, per number and period
--
-- Since Oct 1, 2026 Meta charges per delivered outbound message on the
-- WhatsApp Business Platform: free-form replies ("service", with 1,000
-- free per business phone number per month) and templates by category.
-- This counts what the platform sent through each WhatsApp channel:
--   service   agent/bot non-template messages (not internal notes,
--             not failed, not echoes typed in the WhatsApp Business app)
--   marketing / utility / authentication / other_template
--             templates, categorised by message_templates.category
-- Estimates only: Meta's invoice is the source of truth (it bills by
-- recipient country and does not charge inside free entry-point windows).
-- Called by the server (service role) for /api/reports/meta-usage.
-- ============================================================
CREATE OR REPLACE FUNCTION public.meta_message_usage(ws UUID, since TIMESTAMPTZ, until TIMESTAMPTZ)
RETURNS TABLE (
  channel_id UUID,
  service BIGINT,
  marketing BIGINT,
  utility BIGINT,
  authentication BIGINT,
  other_template BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH sent AS (
    SELECT c.channel_id, m.content_type, m.template_name
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    JOIN public.channels ch ON ch.id = c.channel_id AND ch.type = 'whatsapp'
    WHERE m.workspace_id = ws
      AND m.created_at >= since AND m.created_at < until
      AND m.sender_type IN ('agent', 'bot')
      AND m.content_type <> 'system'
      AND COALESCE(m.is_internal, false) = false
      AND m.status IN ('sent', 'delivered', 'read')
      AND COALESCE(m.metadata->>'source', '') <> 'whatsapp_business_app'
  ),
  classified AS (
    SELECT s.channel_id,
      CASE WHEN s.content_type <> 'template' THEN 'service'
           ELSE COALESCE((
             SELECT lower(t.category) FROM public.message_templates t
             WHERE t.workspace_id = ws AND t.name = s.template_name
               AND (t.channel_id = s.channel_id OR t.channel_id IS NULL)
             ORDER BY (t.channel_id = s.channel_id) DESC NULLS LAST
             LIMIT 1), 'other')
      END AS kind
    FROM sent s
  )
  SELECT channel_id,
    COUNT(*) FILTER (WHERE kind = 'service'),
    COUNT(*) FILTER (WHERE kind = 'marketing'),
    COUNT(*) FILTER (WHERE kind = 'utility'),
    COUNT(*) FILTER (WHERE kind = 'authentication'),
    COUNT(*) FILTER (WHERE kind NOT IN ('service', 'marketing', 'utility', 'authentication'))
  FROM classified
  GROUP BY channel_id;
$$;

REVOKE EXECUTE ON FUNCTION public.meta_message_usage(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_message_usage(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- Speeds up the per-period scan (workspace + time) used above.
CREATE INDEX IF NOT EXISTS idx_messages_ws_created ON public.messages(workspace_id, created_at);
