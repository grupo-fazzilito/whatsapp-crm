-- Calendly: one connected Calendly account per workspace.
--   can_book            null = not tried yet; false = the plan can't book through the API (send links instead)
--   webhook_uri         subscription for invitee.created/canceled; null = none (poll instead)
--   webhooks_available  false = the plan has no webhooks
CREATE TABLE public.calendly_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces (id) ON DELETE CASCADE,
  user_uri text NOT NULL,
  organization_uri text,
  email text,
  name text,
  scheduling_url text,
  status text DEFAULT 'active' NOT NULL CHECK (status IN ('active', 'error', 'revoked')),
  last_error text,
  can_book boolean,
  webhook_uri text,
  webhooks_available boolean,
  last_synced_at timestamptz,
  connected_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- OAuth tokens, encrypted with ENCRYPTION_KEY. Refresh tokens are single-use.
CREATE TABLE public.calendly_connection_secrets (
  connection_id uuid PRIMARY KEY REFERENCES public.calendly_connections (id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Calendly event types of the connected account and the service / staff
-- member each one books in Whasalia (null service = not used by Whasalia).
--   locations  Calendly location kinds of the event type, e.g. ["google_conference"]
CREATE TABLE public.calendly_event_types (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.calendly_connections (id) ON DELETE CASCADE,
  uri text NOT NULL,
  name text NOT NULL,
  duration_minutes integer,
  scheduling_url text,
  active boolean DEFAULT true NOT NULL,
  locations jsonb DEFAULT '[]'::jsonb NOT NULL,
  service_id uuid REFERENCES public.services (id) ON DELETE SET NULL,
  staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (connection_id, uri)
);
CREATE INDEX idx_calendly_event_types_service ON public.calendly_event_types (workspace_id, service_id) WHERE service_id IS NOT NULL;

-- Bookings that live in Calendly.
--   calendly_cancel_synced_at  when a cancellation made in Whasalia was sent to Calendly
ALTER TABLE public.bookings
  ADD COLUMN calendly_event_uri text,
  ADD COLUMN calendly_invitee_uri text,
  ADD COLUMN calendly_cancel_url text,
  ADD COLUMN calendly_reschedule_url text,
  ADD COLUMN calendly_cancel_synced_at timestamptz;
CREATE UNIQUE INDEX idx_bookings_calendly_invitee ON public.bookings (workspace_id, calendly_invitee_uri) WHERE calendly_invitee_uri IS NOT NULL;
