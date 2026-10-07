-- ============================================================
-- 029_followups.sql — "Seguimientos": follow-ups when the customer
-- stops replying (automation trigger `no_reply`).
--
-- followup_schedules holds ONE row per (automation, conversation):
--   * every successful outbound message (agent or bot) re-arms it:
--     status='pending', due_at = now + trigger_config.after;
--   * every inbound customer message cancels the pending rows of the
--     conversation;
--   * the automations cron claims due rows (pending → fired) and runs
--     the automation for that conversation.
--
-- A dedicated table (instead of automation_pending_executions) because
-- these rows are re-armed in place (upsert on the pair), are cancelled
-- by conversation, and are not a parked run: there is no log or step
-- position until the follow-up actually fires.
--
-- Writes are service-role only (messaging layer + cron); members read.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.followup_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  -- Outbound message that (re)armed the schedule.
  anchor_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  anchored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'fired', 'cancelled')),
  fired_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT followup_schedules_automation_conversation_key UNIQUE (automation_id, conversation_id)
);

-- Cron hot path: due pending rows.
CREATE INDEX IF NOT EXISTS idx_followup_schedules_due
  ON public.followup_schedules (due_at) WHERE status = 'pending';
-- Inbound hot path: cancel by conversation.
CREATE INDEX IF NOT EXISTS idx_followup_schedules_conversation_pending
  ON public.followup_schedules (conversation_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_followup_schedules_workspace
  ON public.followup_schedules (workspace_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.followup_schedules;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.followup_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.followup_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_member_read ON public.followup_schedules;
CREATE POLICY ws_member_read ON public.followup_schedules FOR SELECT
  USING (public.ws_access(workspace_id));
-- No INSERT/UPDATE/DELETE policy: writes go through the service role.

-- ------------------------------------------------------------
-- Parked runs of a follow-up automation (waits inside it) are cancelled
-- when the customer replies: allow the 'cancelled' status and index the
-- conversation stored in the run context.
-- ------------------------------------------------------------
ALTER TABLE public.automation_pending_executions
  DROP CONSTRAINT IF EXISTS automation_pending_executions_status_check;
ALTER TABLE public.automation_pending_executions
  ADD CONSTRAINT automation_pending_executions_status_check
  CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_automation_pending_followup_conversation
  ON public.automation_pending_executions ((context->>'conversation_id'))
  WHERE status = 'pending' AND (context->>'followup') = 'true';
