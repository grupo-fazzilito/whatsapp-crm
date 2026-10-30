-- Deleting an Instagram / Facebook channel no longer deletes its comment
-- rules: they stay, detached and inactive, remembering which account they
-- were for. Connecting that same account again re-attaches them.
--   detached_channel_type / detached_external_id  the account a detached rule belonged to; null = attached
ALTER TABLE public.comment_rules
  ADD COLUMN detached_channel_type text,
  ADD COLUMN detached_external_id text;

CREATE OR REPLACE FUNCTION public.comment_rules_detach() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  -- The whole workspace is being deleted: its rules go with it.
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id) THEN
    RETURN OLD;
  END IF;
  UPDATE public.comment_rules
     SET channel_id = NULL,
         detached_channel_type = OLD.type, detached_external_id = OLD.external_id, updated_at = now()
   WHERE channel_id = OLD.id;
  RETURN OLD;
END;
$$;
CREATE TRIGGER comment_rules_detach BEFORE DELETE ON public.channels FOR EACH ROW EXECUTE FUNCTION public.comment_rules_detach();

CREATE OR REPLACE FUNCTION public.comment_rules_reattach() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.comment_rules
     SET channel_id = NEW.id, detached_channel_type = NULL, detached_external_id = NULL, updated_at = now()
   WHERE workspace_id = NEW.workspace_id
     AND detached_channel_type = NEW.type
     AND detached_external_id = NEW.external_id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER comment_rules_reattach AFTER INSERT ON public.channels FOR EACH ROW EXECUTE FUNCTION public.comment_rules_reattach();
