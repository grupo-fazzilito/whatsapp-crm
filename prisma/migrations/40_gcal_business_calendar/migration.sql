-- One Google Calendar for the whole business (no staff member): a
-- connection without staff_id, at most one per workspace. Bookings without
-- a staff calendar go there, and its busy time blocks the business's slots.
ALTER TABLE public.calendar_connections ALTER COLUMN staff_id DROP NOT NULL;

CREATE UNIQUE INDEX idx_calendar_connections_business
  ON public.calendar_connections (workspace_id) WHERE staff_id IS NULL;

-- Queue a booking for Google when its staff member's calendar, or the
-- business calendar, is connected.
CREATE OR REPLACE FUNCTION public.bookings_mark_google_sync() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
     ))
     OR EXISTS (
       SELECT 1 FROM public.calendar_connections c
       WHERE c.workspace_id = NEW.workspace_id AND c.staff_id IS NULL AND c.status <> 'revoked'
     ) THEN
    NEW.google_sync_state := 'pending';
    NEW.google_sync_attempts := 0;
    NEW.google_sync_error := NULL;
    NEW.google_sync_version := COALESCE(NEW.google_sync_version, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$;
