-- Realtime without Supabase: row changes on the tables the UI watches are
-- announced with NOTIFY on channel 'app_changes'. The server (src/lib/realtime)
-- LISTENs, loads the row and pushes it to the browsers of that workspace over SSE.
-- Payload stays small (NOTIFY limit is 8000 bytes): table, op, workspace, id,
-- and for DELETE only the key columns of the old row.
CREATE OR REPLACE FUNCTION public.realtime_notify() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  r jsonb := to_jsonb(COALESCE(NEW, OLD));
  old_keys jsonb := NULL;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT jsonb_object_agg(key, value) INTO old_keys
    FROM jsonb_each(to_jsonb(OLD))
    WHERE key IN ('id', 'workspace_id', 'conversation_id', 'contact_id', 'tag_id', 'message_id', 'user_id', 'status', 'order_id', 'booking_id');
  END IF;
  PERFORM pg_notify('app_changes', jsonb_build_object(
    't', TG_TABLE_NAME,
    'op', TG_OP,
    'ws', r->>'workspace_id',
    'id', r->>'id',
    'old', old_keys
  )::text);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'realtime_notify(%): %', TG_TABLE_NAME, SQLERRM;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['messages', 'conversations', 'conversation_tags', 'conversation_events', 'message_reactions',
                           'notifications', 'orders', 'tasks', 'bookings', 'lead_profiles']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS realtime_notify ON public.%I', t);
    EXECUTE format('CREATE TRIGGER realtime_notify AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.realtime_notify()', t);
  END LOOP;
END $$;
