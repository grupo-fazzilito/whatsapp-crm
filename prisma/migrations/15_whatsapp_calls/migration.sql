-- WhatsApp calls (Calling API) answered by a person from the inbox.
--   status  ringing → answering (someone took it, WebRTC connecting) → in_progress
--           → completed | missed (nobody answered / Meta timed out) | rejected | failed
--   sdp_offer  WhatsApp's WebRTC offer; the browser of whoever answers needs it.
--              Never pushed over realtime (see src/lib/realtime/hub.ts).
CREATE TABLE public.whatsapp_calls (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels (id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations (id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts (id) ON DELETE SET NULL,
  call_id text NOT NULL,
  direction text DEFAULT 'inbound' NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status text DEFAULT 'ringing' NOT NULL CHECK (status IN ('ringing', 'answering', 'in_progress', 'completed', 'missed', 'rejected', 'failed')),
  sdp_offer text,
  answered_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  error text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (channel_id, call_id)
);
CREATE INDEX idx_whatsapp_calls_workspace ON public.whatsapp_calls (workspace_id, created_at DESC);

CREATE TRIGGER realtime_notify AFTER INSERT OR UPDATE OR DELETE ON public.whatsapp_calls
  FOR EACH ROW EXECUTE FUNCTION public.realtime_notify();

-- The call shows up in the conversation timeline.
ALTER TABLE public.conversation_events DROP CONSTRAINT conversation_events_type_check;
ALTER TABLE public.conversation_events ADD CONSTRAINT conversation_events_type_check
  CHECK (type = ANY (ARRAY['assigned', 'unassigned', 'transferred', 'resolved', 'reopened', 'priority', 'tag_added', 'tag_removed', 'call']));
