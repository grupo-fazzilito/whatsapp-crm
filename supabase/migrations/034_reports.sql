-- ============================================================
-- 034 — Reports (read-only aggregation)
--
-- Four functions feed /api/reports. Each returns ONE jsonb document so
-- PostgREST's max-rows cap never truncates a group-by silently.
--
--   reports_volume    messages in/out by day, channel, hour-of-day x
--                     day-of-week, per agent / AI agent, AI-vs-human mix,
--                     conversations started
--   reports_stream    compact ordered message stream used by the TS
--                     session / first-response / SLA helpers
--                     (src/lib/reports/sessions.ts)
--   reports_snapshot  "right now": unanswered conversations, open load
--   reports_business  orders, bookings, conversion, AI cost, handovers
--
-- Common arguments: p_ws workspace, [p_from, p_to) instants, p_tz the
-- workspace IANA zone for day/hour buckets, p_channels (NULL = all),
-- p_agents (NULL = all; else conversations assigned to — or answered in
-- the window by — one of those users), p_team (NULL = all; else
-- conversations routed to that team or assigned to one of its members).
--
-- Security: SECURITY INVOKER. EXECUTE is granted to service_role only:
-- the route checks the caller's role (admin = whole workspace, agent =
-- personal view) before calling. reports_guard() is defence in depth for
-- any other caller (requires workspace admin).
--
-- Columns other features add later (messages.is_internal,
-- conversations.resolved_at) are detected at run time, so this file
-- works with or without them. Internal notes never count as replies.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_messages_ws_created ON public.messages (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON public.messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_ws_created ON public.conversations (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bookings_ws_created ON public.bookings (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_chat_logs_ws_intent ON public.ai_chat_logs (workspace_id, detected_intent, created_at);

CREATE OR REPLACE FUNCTION public.reports_guard(p_ws UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN;
  END IF;
  IF NOT public.is_ws_member(p_ws, 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reports_has_column(p_table TEXT, p_column TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = p_table AND column_name = p_column
  )
$$;

-- Shared CTEs: conv (filtered conversations) and msg (countable messages
-- in the window). $1 ws, $2 from, $3 to, $4 tz, $5 channels, $6 agents,
-- $7 team.
CREATE OR REPLACE FUNCTION public.reports_base_cte()
RETURNS TEXT
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_internal TEXT := CASE WHEN public.reports_has_column('messages', 'is_internal')
                          THEN ' AND NOT COALESCE(m.is_internal, false)' ELSE '' END;
  v_team TEXT := CASE
    WHEN to_regclass('public.team_members') IS NULL THEN ''
    WHEN public.reports_has_column('conversations', 'team_id') THEN
      ' AND ($7::uuid IS NULL OR c.team_id = $7 OR c.assigned_agent_id IN (SELECT tm.user_id FROM public.team_members tm WHERE tm.team_id = $7))'
    ELSE
      ' AND ($7::uuid IS NULL OR c.assigned_agent_id IN (SELECT tm.user_id FROM public.team_members tm WHERE tm.team_id = $7))'
  END;
BEGIN
  RETURN format($q$
    conv AS (
      SELECT c.id, c.channel_id
      FROM public.conversations c
      WHERE c.workspace_id = $1
        AND ($5::uuid[] IS NULL OR c.channel_id = ANY($5))
        AND ($6::uuid[] IS NULL
             OR c.assigned_agent_id = ANY($6)
             OR EXISTS (SELECT 1 FROM public.messages m
                        WHERE m.conversation_id = c.id AND m.sender_type = 'agent'
                          AND m.sender_id = ANY($6)
                          AND m.created_at >= $2 AND m.created_at < $3 %1$s))
        %2$s
    ),
    msg AS (
      SELECT m.conversation_id, m.sender_type, m.sender_id, m.ai_agent_id, m.created_at, conv.channel_id
      FROM public.messages m
      JOIN conv ON conv.id = m.conversation_id
      WHERE m.workspace_id = $1
        AND m.created_at >= $2 AND m.created_at < $3
        AND m.content_type <> 'system' %1$s
    )
  $q$, v_internal, v_team);
END;
$$;

-- ------------------------------------------------------------
-- Volume
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reports_volume(
  p_ws UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ, p_tz TEXT,
  p_channels UUID[] DEFAULT NULL, p_agents UUID[] DEFAULT NULL, p_team UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result JSONB;
BEGIN
  PERFORM public.reports_guard(p_ws);
  EXECUTE 'WITH ' || public.reports_base_cte() || $q$
    SELECT jsonb_build_object(
      'by_day', COALESCE((
        SELECT jsonb_agg(x ORDER BY x.day) FROM (
          SELECT to_char(created_at AT TIME ZONE $4, 'YYYY-MM-DD') AS day,
                 count(*) FILTER (WHERE sender_type = 'customer') AS inbound,
                 count(*) FILTER (WHERE sender_type = 'agent') AS agent,
                 count(*) FILTER (WHERE sender_type = 'bot') AS bot
          FROM msg GROUP BY 1) x), '[]'::jsonb),
      'by_channel', COALESCE((
        SELECT jsonb_agg(x) FROM (
          SELECT channel_id,
                 count(*) FILTER (WHERE sender_type = 'customer') AS inbound,
                 count(*) FILTER (WHERE sender_type = 'agent') AS agent,
                 count(*) FILTER (WHERE sender_type = 'bot') AS bot,
                 count(DISTINCT conversation_id) AS conversations
          FROM msg GROUP BY 1) x), '[]'::jsonb),
      'heatmap', COALESCE((
        SELECT jsonb_agg(x) FROM (
          SELECT (extract(isodow FROM created_at AT TIME ZONE $4)::int - 1) AS dow,
                 extract(hour FROM created_at AT TIME ZONE $4)::int AS hour,
                 count(*) AS inbound
          FROM msg WHERE sender_type = 'customer' GROUP BY 1, 2) x), '[]'::jsonb),
      'by_agent', COALESCE((
        SELECT jsonb_agg(x) FROM (
          SELECT sender_id AS user_id, count(*) AS messages, count(DISTINCT conversation_id) AS conversations
          FROM msg WHERE sender_type = 'agent' AND sender_id IS NOT NULL GROUP BY 1) x), '[]'::jsonb),
      'by_ai_agent', COALESCE((
        SELECT jsonb_agg(x) FROM (
          SELECT ai_agent_id, count(*) AS messages, count(DISTINCT conversation_id) AS conversations
          FROM msg WHERE sender_type = 'bot' GROUP BY 1) x), '[]'::jsonb),
      'mix', (
        SELECT jsonb_build_object(
          'ai_only', count(*) FILTER (WHERE b > 0 AND a = 0),
          'human_only', count(*) FILTER (WHERE a > 0 AND b = 0),
          'both', count(*) FILTER (WHERE a > 0 AND b > 0),
          'no_reply', count(*) FILTER (WHERE a = 0 AND b = 0 AND c > 0))
        FROM (SELECT conversation_id,
                     count(*) FILTER (WHERE sender_type = 'agent') AS a,
                     count(*) FILTER (WHERE sender_type = 'bot') AS b,
                     count(*) FILTER (WHERE sender_type = 'customer') AS c
              FROM msg GROUP BY 1) s),
      'conversations_started', (
        SELECT count(*) FROM public.conversations c JOIN conv ON conv.id = c.id
        WHERE c.created_at >= $2 AND c.created_at < $3)
    )
  $q$ INTO result USING p_ws, p_from, p_to, p_tz, p_channels, p_agents, p_team;
  RETURN result;
END;
$$;

-- ------------------------------------------------------------
-- Message stream: [[conversation_id, kind c|a|b, sender_id, ai_agent_id, epoch_ms], ...]
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reports_stream(
  p_ws UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ,
  p_channels UUID[] DEFAULT NULL, p_agents UUID[] DEFAULT NULL, p_team UUID DEFAULT NULL,
  p_limit INT DEFAULT 100000
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result JSONB;
BEGIN
  PERFORM public.reports_guard(p_ws);
  EXECUTE 'WITH ' || public.reports_base_cte() || $q$,
    lim AS (SELECT * FROM msg ORDER BY created_at LIMIT $8 + 1)
    SELECT jsonb_build_object(
      'truncated', (SELECT count(*) FROM lim) > $8,
      'rows', COALESCE((
        SELECT jsonb_agg(jsonb_build_array(
                 conversation_id,
                 CASE sender_type WHEN 'customer' THEN 'c' WHEN 'agent' THEN 'a' ELSE 'b' END,
                 sender_id, ai_agent_id,
                 floor(extract(epoch FROM created_at) * 1000)::bigint) ORDER BY created_at)
        FROM (SELECT * FROM lim ORDER BY created_at LIMIT $8) l), '[]'::jsonb)
    )
  $q$ INTO result USING p_ws, p_from, p_to, 'UTC'::text, p_channels, p_agents, p_team, GREATEST(1, LEAST(p_limit, 200000));
  RETURN result;
END;
$$;

-- ------------------------------------------------------------
-- Snapshot (now): unanswered conversations and open load per agent
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reports_snapshot(
  p_ws UUID, p_channels UUID[] DEFAULT NULL, p_agents UUID[] DEFAULT NULL, p_team UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result JSONB;
  v_internal TEXT := CASE WHEN public.reports_has_column('messages', 'is_internal')
                          THEN ' AND NOT COALESCE(m.is_internal, false)' ELSE '' END;
  v_resolved TEXT := CASE WHEN public.reports_has_column('conversations', 'resolved_at')
                          THEN ' AND (c.resolved_at IS NULL OR c.resolved_at < l.created_at)' ELSE '' END;
  v_team TEXT := CASE
    WHEN to_regclass('public.team_members') IS NULL THEN ''
    WHEN public.reports_has_column('conversations', 'team_id') THEN
      ' AND ($4::uuid IS NULL OR c.team_id = $4 OR c.assigned_agent_id IN (SELECT tm.user_id FROM public.team_members tm WHERE tm.team_id = $4))'
    ELSE
      ' AND ($4::uuid IS NULL OR c.assigned_agent_id IN (SELECT tm.user_id FROM public.team_members tm WHERE tm.team_id = $4))'
  END;
BEGIN
  PERFORM public.reports_guard(p_ws);
  EXECUTE format($q$
    WITH conv AS (
      SELECT c.id, c.channel_id, c.contact_id, c.assigned_agent_id, c.status
      FROM public.conversations c
      WHERE c.workspace_id = $1 AND c.status <> 'closed'
        AND ($2::uuid[] IS NULL OR c.channel_id = ANY($2))
        AND ($3::uuid[] IS NULL OR c.assigned_agent_id = ANY($3))
        %3$s
    ),
    waiting AS (
      SELECT c.id, c.channel_id, c.contact_id, c.assigned_agent_id, l.created_at AS last_at,
             (SELECT min(m.created_at) FROM public.messages m
               WHERE m.conversation_id = c.id AND m.sender_type = 'customer'
                 AND m.content_type <> 'system'
                 AND m.created_at > COALESCE((SELECT max(r.created_at) FROM public.messages r
                                              WHERE r.conversation_id = c.id AND r.sender_type <> 'customer'
                                                AND r.content_type <> 'system' %1$s), '-infinity')) AS since
      FROM public.conversations c
      JOIN conv ON conv.id = c.id
      CROSS JOIN LATERAL (
        SELECT m.sender_type, m.created_at FROM public.messages m
        WHERE m.conversation_id = c.id AND m.content_type <> 'system' %1$s
        ORDER BY m.created_at DESC LIMIT 1
      ) l
      WHERE l.sender_type = 'customer' %2$s
    )
    SELECT jsonb_build_object(
      'unanswered', (SELECT count(*) FROM waiting),
      'oldest_waiting', (SELECT min(since) FROM waiting),
      'waiting', COALESCE((
        SELECT jsonb_agg(x ORDER BY x.since) FROM (
          SELECT w.id AS conversation_id, w.since, w.channel_id, w.assigned_agent_id,
                 COALESCE(ct.name, ct.phone) AS contact
          FROM waiting w LEFT JOIN public.contacts ct ON ct.id = w.contact_id
          ORDER BY w.since LIMIT 20) x), '[]'::jsonb),
      'open_load', COALESCE((
        SELECT jsonb_agg(x) FROM (
          SELECT assigned_agent_id AS user_id,
                 count(*) FILTER (WHERE status = 'open') AS open,
                 count(*) FILTER (WHERE status = 'pending') AS pending
          FROM conv WHERE assigned_agent_id IS NOT NULL GROUP BY 1) x), '[]'::jsonb)
    )
  $q$, v_internal, v_resolved, v_team) INTO result USING p_ws, p_channels, p_agents, p_team;
  RETURN result;
END;
$$;

-- ------------------------------------------------------------
-- Business: orders, bookings, conversion, AI cost and handovers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reports_business(
  p_ws UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ,
  p_channels UUID[] DEFAULT NULL, p_agents UUID[] DEFAULT NULL, p_team UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result JSONB;
BEGIN
  PERFORM public.reports_guard(p_ws);
  EXECUTE 'WITH ' || public.reports_base_cte() || $q$,
    active AS (SELECT DISTINCT conversation_id FROM msg WHERE sender_type = 'customer'),
    ord AS (
      SELECT o.* FROM public.orders o
      WHERE o.workspace_id = $1 AND o.created_at >= $2 AND o.created_at < $3
        AND ($5::uuid[] IS NULL OR o.channel_id = ANY($5))
        AND ($6::uuid[] IS NULL AND $7::uuid IS NULL OR o.conversation_id IN (SELECT id FROM conv))
    )
    SELECT jsonb_build_object(
      'orders_by_status', COALESCE((
        SELECT jsonb_agg(x) FROM (
          SELECT status, count(*) AS count, COALESCE(sum(total), 0) AS total, min(currency) AS currency
          FROM ord GROUP BY 1) x), '[]'::jsonb),
      'orders_by_source', COALESCE((
        SELECT jsonb_agg(x) FROM (
          SELECT source, count(*) AS count, COALESCE(sum(total) FILTER (WHERE status <> 'cancelled'), 0) AS total
          FROM ord GROUP BY 1) x), '[]'::jsonb),
      'bookings_by_status', COALESCE((
        SELECT jsonb_agg(x) FROM (
          SELECT b.status, count(*) AS count FROM public.bookings b
          WHERE b.workspace_id = $1 AND b.created_at >= $2 AND b.created_at < $3
            AND ($5::uuid[] IS NULL AND $6::uuid[] IS NULL AND $7::uuid IS NULL OR b.conversation_id IN (SELECT id FROM conv))
          GROUP BY 1) x), '[]'::jsonb),
      'conversion', jsonb_build_object(
        'active_conversations', (SELECT count(*) FROM active),
        'with_order', (SELECT count(DISTINCT o.conversation_id) FROM ord o
                        WHERE o.status <> 'cancelled' AND o.conversation_id IN (SELECT conversation_id FROM active))
      ),
      'ai_cost', COALESCE((
        SELECT jsonb_agg(x) FROM (
          SELECT u.ai_agent_id, count(*) AS calls, COALESCE(sum(u.cost_usd), 0) AS cost_usd,
                 COALESCE(sum(u.input_tokens), 0) AS input_tokens, COALESCE(sum(u.output_tokens), 0) AS output_tokens
          FROM public.ai_usage u
          WHERE u.workspace_id = $1 AND u.created_at >= $2 AND u.created_at < $3
            AND ($5::uuid[] IS NULL OR u.channel_id = ANY($5))
            AND ($6::uuid[] IS NULL AND $7::uuid IS NULL OR u.conversation_id IN (SELECT id FROM conv))
          GROUP BY 1) x), '[]'::jsonb),
      'handovers', COALESCE((
        SELECT jsonb_agg(x) FROM (
          SELECT l.ai_agent_id, count(*) AS count, count(DISTINCT l.conversation_id) AS conversations
          FROM public.ai_chat_logs l
          WHERE l.workspace_id = $1 AND l.created_at >= $2 AND l.created_at < $3
            AND l.detected_intent IN ('handover', 'emergency')
            AND ($5::uuid[] IS NULL AND $6::uuid[] IS NULL AND $7::uuid IS NULL OR l.conversation_id IN (SELECT id FROM conv))
          GROUP BY 1) x), '[]'::jsonb),
      'handover_conversations', (
        SELECT count(DISTINCT l.conversation_id) FROM public.ai_chat_logs l
        WHERE l.workspace_id = $1 AND l.created_at >= $2 AND l.created_at < $3
          AND l.detected_intent IN ('handover', 'emergency')
          AND l.conversation_id IN (SELECT conversation_id FROM msg))
    )
  $q$ INTO result USING p_ws, p_from, p_to, 'UTC'::text, p_channels, p_agents, p_team;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.reports_volume(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID[], UUID[], UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reports_stream(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID[], UUID[], UUID, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reports_snapshot(UUID, UUID[], UUID[], UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reports_business(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID[], UUID[], UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reports_base_cte() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reports_guard(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reports_volume(UUID, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID[], UUID[], UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reports_stream(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID[], UUID[], UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reports_snapshot(UUID, UUID[], UUID[], UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reports_business(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID[], UUID[], UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reports_base_cte() TO service_role;
GRANT EXECUTE ON FUNCTION public.reports_guard(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reports_has_column(TEXT, TEXT) TO authenticated, service_role;
