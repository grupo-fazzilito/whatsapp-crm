-- PDF reports built in the background: who asked, with which filters, and
-- the file once ready (private storage). The requester gets an in-app
-- notification (type 'report') when it is ready or failed.
CREATE TABLE public.report_exports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  file_path     text,
  file_name     text,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
CREATE INDEX report_exports_user ON public.report_exports (workspace_id, user_id, created_at DESC);

ALTER TABLE public.notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY['mention', 'assigned', 'transferred', 'system', 'billing', 'handover', 'order', 'report']));
