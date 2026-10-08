-- ============================================================
-- 033 — CRM inside the chat: tasks + won/lost deals
--
-- tasks   follow-up work for the team ("llamar mañana", "enviar
--         cotización"), optionally linked to a contact, conversation
--         and/or deal. Any member reads/writes (RLS). Completion
--         bookkeeping (completed_at / completed_by) and created_by are
--         set by a trigger from auth.uid(), so clients can't spoof them.
--         reminded_at marks the one due reminder sent by the cron.
-- deals   status open|won|lost already exists (002). Adds won_at,
--         lost_at, lost_reason and close_note, kept consistent by a
--         trigger whenever status changes.
-- Lost reasons are configured in workspaces.settings.crm.lost_reasons.
-- ============================================================

-- ------------------------------------------------------------
-- Tasks
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE DEFAULT public.active_ws(),
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 5000),
  due_at TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  result TEXT CHECK (result IS NULL OR char_length(result) <= 5000),
  assignee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reminded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_ws_status_due ON public.tasks(workspace_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON public.tasks(assignee_user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON public.tasks(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON public.tasks(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_deal ON public.tasks(deal_id) WHERE deal_id IS NOT NULL;
-- Cron: open tasks with a due date that weren't reminded yet.
CREATE INDEX IF NOT EXISTS idx_tasks_reminder ON public.tasks(due_at) WHERE status = 'open' AND reminded_at IS NULL AND due_at IS NOT NULL;

DROP TRIGGER IF EXISTS set_updated_at ON public.tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Server-side bookkeeping + same-workspace checks for linked rows.
CREATE OR REPLACE FUNCTION public.tasks_bookkeeping()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF uid IS NOT NULL THEN
      NEW.created_by := uid;
    END IF;
  ELSE
    NEW.workspace_id := OLD.workspace_id;
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;

  -- Linked rows must live in the same workspace.
  IF NEW.assignee_user_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id)
     AND NOT EXISTS (SELECT 1 FROM public.workspace_members m
                     WHERE m.workspace_id = NEW.workspace_id AND m.user_id = NEW.assignee_user_id AND m.status = 'active') THEN
    RAISE EXCEPTION 'assignee_not_member' USING ERRCODE = '23514';
  END IF;
  IF NEW.contact_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = NEW.contact_id AND c.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'contact_other_workspace' USING ERRCODE = '23514';
  END IF;
  IF NEW.conversation_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = NEW.conversation_id AND c.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'conversation_other_workspace' USING ERRCODE = '23514';
  END IF;
  IF NEW.deal_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.id = NEW.deal_id AND d.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'deal_other_workspace' USING ERRCODE = '23514';
  END IF;

  -- Completion: who/when come from the session, never from the client.
  IF NEW.status = 'done' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'done') THEN
    NEW.completed_at := NOW();
    NEW.completed_by := COALESCE(uid, NEW.completed_by);
  ELSIF NEW.status <> 'done' THEN
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
  ELSIF uid IS NOT NULL THEN
    NEW.completed_at := OLD.completed_at;
    NEW.completed_by := OLD.completed_by;
  END IF;

  -- A new due date (or reopening) re-arms the reminder.
  IF TG_OP = 'UPDATE' AND (NEW.due_at IS DISTINCT FROM OLD.due_at OR (NEW.status = 'open' AND OLD.status <> 'open')) THEN
    NEW.reminded_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tasks_bookkeeping ON public.tasks;
CREATE TRIGGER tasks_bookkeeping BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_bookkeeping();

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_member_all ON public.tasks;
CREATE POLICY ws_member_all ON public.tasks FOR ALL
  USING (public.ws_access(workspace_id)) WITH CHECK (public.ws_access(workspace_id));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'tasks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
  END IF;
END $$;

-- ------------------------------------------------------------
-- Deals: won / lost
-- ------------------------------------------------------------
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS won_at TIMESTAMPTZ;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS lost_reason TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS close_note TEXT;
UPDATE public.deals SET status = 'open' WHERE status IS NULL;
ALTER TABLE public.deals ALTER COLUMN status SET NOT NULL;

-- Backfill timestamps for deals closed before this migration.
UPDATE public.deals SET won_at = COALESCE(updated_at, created_at) WHERE status = 'won' AND won_at IS NULL;
UPDATE public.deals SET lost_at = COALESCE(updated_at, created_at) WHERE status = 'lost' AND lost_at IS NULL;

CREATE OR REPLACE FUNCTION public.deals_close_bookkeeping()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'won' THEN
    NEW.won_at := COALESCE(CASE WHEN TG_OP = 'INSERT' THEN NEW.won_at END, NOW());
    NEW.lost_at := NULL;
    NEW.lost_reason := NULL;
  ELSIF NEW.status = 'lost' THEN
    NEW.lost_at := COALESCE(CASE WHEN TG_OP = 'INSERT' THEN NEW.lost_at END, NOW());
    NEW.won_at := NULL;
  ELSE
    NEW.won_at := NULL;
    NEW.lost_at := NULL;
    NEW.lost_reason := NULL;
    NEW.close_note := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS deals_close_bookkeeping ON public.deals;
CREATE TRIGGER deals_close_bookkeeping BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.deals_close_bookkeeping();

CREATE INDEX IF NOT EXISTS idx_deals_contact_status ON public.deals(contact_id, status);
CREATE INDEX IF NOT EXISTS idx_deals_ws_status ON public.deals(workspace_id, status);

NOTIFY pgrst, 'reload schema';
