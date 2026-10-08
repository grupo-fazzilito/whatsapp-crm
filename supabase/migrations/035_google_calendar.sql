-- ============================================================
-- 035 — Google Calendar integration
--
-- One Google Calendar connection per staff member (asesor). Bookings of
-- that staff member are mirrored as events in their calendar, their
-- Google busy time blocks availability, and moves/cancellations made in
-- Google flow back into the booking.
--
-- Secrets (OAuth tokens, incremental sync token, push-channel token)
-- live in calendar_connection_secrets: RLS on with no policies, so only
-- the service role can read them. Members can read the status fields of
-- calendar_connections; every write goes through the API (service role).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL UNIQUE REFERENCES public.staff(id) ON DELETE CASCADE,
  connected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  google_email TEXT,
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  token_expires_at TIMESTAMPTZ,
  watch_channel_id TEXT,
  watch_resource_id TEXT,
  watch_expires_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  last_error TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calendar_connections_ws ON public.calendar_connections(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_connections_channel
  ON public.calendar_connections(watch_channel_id) WHERE watch_channel_id IS NOT NULL;

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_member_read ON public.calendar_connections;
CREATE POLICY ws_member_read ON public.calendar_connections FOR SELECT USING (public.ws_access(workspace_id));

DROP TRIGGER IF EXISTS set_updated_at ON public.calendar_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.calendar_connection_secrets (
  connection_id UUID PRIMARY KEY REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- AES-256-GCM (src/lib/whatsapp/encryption.ts)
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  sync_token TEXT,
  -- Per-channel secret echoed by Google in X-Goog-Channel-Token.
  watch_token TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.calendar_connection_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_connection_secrets FROM anon, authenticated;

-- ------------------------------------------------------------
-- Bookings ↔ Google events
-- ------------------------------------------------------------
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS google_event_id TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS google_calendar_connection_id UUID
  REFERENCES public.calendar_connections(id) ON DELETE SET NULL;
-- NULL = nothing to sync; pending → synced | error (retried by the cron).
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS google_sync_state TEXT
  CHECK (google_sync_state IN ('pending', 'synced', 'error'));
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS google_sync_error TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS google_sync_attempts INTEGER NOT NULL DEFAULT 0;
-- Bumped on every change that must reach Google; a worker only marks the
-- booking synced when the version it pushed is still the current one.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS google_sync_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS google_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bookings_google_sync
  ON public.bookings(google_sync_state) WHERE google_sync_state IN ('pending', 'error');
CREATE INDEX IF NOT EXISTS idx_bookings_google_event
  ON public.bookings(google_calendar_connection_id, google_event_id) WHERE google_event_id IS NOT NULL;

-- Events whose booking row was deleted: removed from Google by the worker.
CREATE TABLE IF NOT EXISTS public.calendar_event_deletions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  google_event_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.calendar_event_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.calendar_event_deletions FROM anon, authenticated;

-- Marks a booking for sync whenever something Google shows changes, no
-- matter who wrote it (AI, booking UI, API). Writes made by the sync code
-- itself touch google_synced_at and are left alone (no echo loop).
CREATE OR REPLACE FUNCTION public.bookings_mark_google_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  relevant BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.google_synced_at IS DISTINCT FROM OLD.google_synced_at THEN
      RETURN NEW;
    END IF;
    relevant := NEW.booking_date IS DISTINCT FROM OLD.booking_date
      OR NEW.booking_time IS DISTINCT FROM OLD.booking_time
      OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes
      OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.customer_name IS DISTINCT FROM OLD.customer_name
      OR NEW.notes IS DISTINCT FROM OLD.notes
      OR NEW.product_id IS DISTINCT FROM OLD.product_id
      OR NEW.service_id IS DISTINCT FROM OLD.service_id;
    IF NOT relevant THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.google_event_id IS NOT NULL
     OR (NEW.staff_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.calendar_connections c
       WHERE c.staff_id = NEW.staff_id AND c.status <> 'revoked'
     )) THEN
    NEW.google_sync_state := 'pending';
    NEW.google_sync_attempts := 0;
    NEW.google_sync_error := NULL;
    NEW.google_sync_version := COALESCE(NEW.google_sync_version, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_mark_google_sync ON public.bookings;
CREATE TRIGGER bookings_mark_google_sync BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_mark_google_sync();

CREATE OR REPLACE FUNCTION public.bookings_queue_google_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.google_event_id IS NOT NULL AND OLD.google_calendar_connection_id IS NOT NULL THEN
    INSERT INTO public.calendar_event_deletions (workspace_id, connection_id, google_event_id)
    SELECT OLD.workspace_id, OLD.google_calendar_connection_id, OLD.google_event_id
    WHERE EXISTS (SELECT 1 FROM public.calendar_connections c WHERE c.id = OLD.google_calendar_connection_id);
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS bookings_queue_google_delete ON public.bookings;
CREATE TRIGGER bookings_queue_google_delete AFTER DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_queue_google_delete();

REVOKE EXECUTE ON FUNCTION public.bookings_mark_google_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bookings_queue_google_delete() FROM PUBLIC, anon, authenticated;
