-- ============================================================
-- 032 — Bandeja Pro (inbox): tags, priority, internal notes,
-- quick replies, teams, transfers, resolved state, notifications.
--
-- conversations      + priority, resolved_at/by, team_id,
--                      last_customer_message_at
-- messages           + is_internal (team-only notes; never sent to a
--                      provider, never shown to the web widget, never
--                      fed to the AI)
-- workspace_members  + available (agent toggles it), last_assigned_at
--                      (round-robin: least recently assigned first)
-- conversation_tags  tags (the workspace `tags` table) on conversations
-- conversation_events assigned / transferred / resolved / reopened /
--                      priority / tag_added / tag_removed timeline
-- notifications      per-user inbox (mentions, assignments, transfers)
-- quick_replies      "/atajo" canned answers with optional attachments
-- teams/team_members groups of members for transfers and auto-assign
--
-- Auto-assignment settings live in workspaces.settings.inbox:
--   { auto_assign: 'off' | 'round_robin', default_team_id?: uuid }
-- ============================================================

-- ------------------------------------------------------------
-- Teams
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE DEFAULT public.active_ws(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_teams_name ON public.teams(workspace_id, lower(name));
DROP TRIGGER IF EXISTS set_updated_at ON public.teams;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_ws ON public.team_members(workspace_id, user_id);
DROP TRIGGER IF EXISTS set_ws_from_parent ON public.team_members;
CREATE TRIGGER set_ws_from_parent BEFORE INSERT ON public.team_members
  FOR EACH ROW EXECUTE FUNCTION public.set_ws_from_parent('teams', 'team_id');

-- ------------------------------------------------------------
-- Conversations / messages / members
-- ------------------------------------------------------------
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_priority_check') THEN
    ALTER TABLE public.conversations ADD CONSTRAINT conversations_priority_check
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  END IF;
END $$;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ;

UPDATE public.conversations c
SET last_customer_message_at = m.last_at
FROM (
  SELECT conversation_id, MAX(created_at) AS last_at
  FROM public.messages WHERE sender_type = 'customer'
  GROUP BY conversation_id
) m
WHERE m.conversation_id = c.id AND c.last_customer_message_at IS NULL;

UPDATE public.conversations SET resolved_at = updated_at
WHERE status = 'closed' AND resolved_at IS NULL;

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;
-- Files tab: media of a conversation, newest first.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_media ON public.messages(conversation_id, created_at DESC)
  WHERE media_url IS NOT NULL;

ALTER TABLE public.workspace_members ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.workspace_members ADD COLUMN IF NOT EXISTS last_assigned_at TIMESTAMPTZ;

-- Members may flip their own availability (workspace_members is
-- admin-write under RLS).
CREATE OR REPLACE FUNCTION public.set_my_availability(ws UUID, is_available BOOLEAN)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.workspace_members
  SET available = is_available, updated_at = NOW()
  WHERE workspace_id = ws AND user_id = auth.uid() AND status = 'active'
  RETURNING available
$$;
REVOKE ALL ON FUNCTION public.set_my_availability(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_availability(UUID, BOOLEAN) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Conversation tags
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (conversation_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_conversation_tags_ws ON public.conversation_tags(workspace_id, tag_id);
DROP TRIGGER IF EXISTS set_ws_from_parent ON public.conversation_tags;
CREATE TRIGGER set_ws_from_parent BEFORE INSERT ON public.conversation_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_ws_from_parent('conversations', 'conversation_id');

-- A tag of another workspace can never be attached.
CREATE OR REPLACE FUNCTION public.check_conversation_tag_ws()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tags t WHERE t.id = NEW.tag_id AND t.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'tag does not belong to this workspace' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS zz_check_tag_ws ON public.conversation_tags;
-- "zz_" so it runs after set_ws_from_parent filled workspace_id.
CREATE TRIGGER zz_check_tag_ws BEFORE INSERT OR UPDATE ON public.conversation_tags
  FOR EACH ROW EXECUTE FUNCTION public.check_conversation_tag_ws();

-- ------------------------------------------------------------
-- Conversation events (timeline)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversation_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('assigned', 'unassigned', 'transferred', 'resolved', 'reopened', 'priority', 'tag_added', 'tag_removed')),
  from_user UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  to_user UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  note TEXT,
  -- Extra details: {priority}, {tag_id, tag_name}, {auto: true, trigger}, {by: 'customer'}...
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conversation_events_conv ON public.conversation_events(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversation_events_ws ON public.conversation_events(workspace_id);
DROP TRIGGER IF EXISTS set_ws_from_parent ON public.conversation_events;
CREATE TRIGGER set_ws_from_parent BEFORE INSERT ON public.conversation_events
  FOR EACH ROW EXECUTE FUNCTION public.set_ws_from_parent('conversations', 'conversation_id');

-- ------------------------------------------------------------
-- Notifications
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('mention', 'assigned', 'transferred', 'system')),
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications(user_id, workspace_id) WHERE read_at IS NULL;

-- ------------------------------------------------------------
-- Quick replies
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quick_replies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE DEFAULT public.active_ws(),
  shortcut TEXT NOT NULL CHECK (shortcut ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 4096),
  -- [{path?, url?, type: image|video|audio|document, name}] — path = object in the private `attachments` bucket
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments) = 'array'),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  is_shared BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (workspace_id, shortcut)
);
DROP TRIGGER IF EXISTS set_updated_at ON public.quick_replies;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.quick_replies FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
  pol RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['teams','team_members','conversation_tags','conversation_events','notifications','quick_replies'] LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- Teams: members read, admins write.
CREATE POLICY ws_member_read ON public.teams FOR SELECT USING (public.ws_access(workspace_id));
CREATE POLICY ws_admin_write ON public.teams FOR ALL
  USING (public.ws_access(workspace_id, 'admin')) WITH CHECK (public.ws_access(workspace_id, 'admin'));
CREATE POLICY ws_member_read ON public.team_members FOR SELECT USING (public.ws_access(workspace_id));
CREATE POLICY ws_admin_write ON public.team_members FOR ALL
  USING (public.ws_access(workspace_id, 'admin')) WITH CHECK (public.ws_access(workspace_id, 'admin'));

-- Conversation tags: any member applies existing tags (creating tags
-- stays admin-only on `tags`).
CREATE POLICY ws_member_all ON public.conversation_tags FOR ALL
  USING (public.ws_access(workspace_id)) WITH CHECK (public.ws_access(workspace_id));

-- Events: members read; written by server routes (service role).
CREATE POLICY ws_member_read ON public.conversation_events FOR SELECT USING (public.ws_access(workspace_id));

-- Notifications: each user sees and marks read only their own; created
-- by server routes (service role).
CREATE POLICY own_read ON public.notifications FOR SELECT
  USING (user_id = auth.uid() AND public.ws_access(workspace_id));
CREATE POLICY own_update ON public.notifications FOR UPDATE
  USING (user_id = auth.uid() AND public.ws_access(workspace_id))
  WITH CHECK (user_id = auth.uid() AND public.ws_access(workspace_id));
CREATE POLICY own_delete ON public.notifications FOR DELETE
  USING (user_id = auth.uid() AND public.ws_access(workspace_id));

-- Quick replies: shared ones visible to every member and managed by
-- admins; personal ones only by their author.
CREATE POLICY qr_read ON public.quick_replies FOR SELECT
  USING (public.ws_access(workspace_id) AND (is_shared OR created_by = auth.uid()));
CREATE POLICY qr_insert ON public.quick_replies FOR INSERT
  WITH CHECK (
    public.ws_access(workspace_id) AND created_by = auth.uid()
    AND (NOT is_shared OR public.ws_access(workspace_id, 'admin'))
  );
CREATE POLICY qr_update ON public.quick_replies FOR UPDATE
  USING (
    public.ws_access(workspace_id)
    AND ((NOT is_shared AND created_by = auth.uid()) OR public.ws_access(workspace_id, 'admin'))
  )
  WITH CHECK (
    public.ws_access(workspace_id)
    AND ((NOT is_shared AND created_by = auth.uid()) OR public.ws_access(workspace_id, 'admin'))
  );
CREATE POLICY qr_delete ON public.quick_replies FOR DELETE
  USING (
    public.ws_access(workspace_id)
    AND ((NOT is_shared AND created_by = auth.uid()) OR public.ws_access(workspace_id, 'admin'))
  );

-- ------------------------------------------------------------
-- Realtime
-- ------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['conversation_tags','conversation_events','notifications'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
