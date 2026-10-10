-- Better Auth writes JSON fields as a JSON string ("{\"invite\":true}"):
-- keep users.meta an object so handle_new_user() and the app can read it.
CREATE OR REPLACE FUNCTION public.users_meta_object() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF jsonb_typeof(NEW.meta) = 'string' THEN
    BEGIN
      NEW.meta := (NEW.meta #>> '{}')::jsonb;
    EXCEPTION WHEN others THEN
      NEW.meta := '{}'::jsonb;
    END;
  END IF;
  IF NEW.meta IS NULL OR jsonb_typeof(NEW.meta) <> 'object' THEN
    NEW.meta := '{}'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_meta_object BEFORE INSERT OR UPDATE OF meta ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.users_meta_object();
