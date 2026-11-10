-- Every conversation remembers, for good, the network and the account it
-- came from, so deleting a channel no longer turns its chats into
-- "WhatsApp" (the inbox fell back to WhatsApp when channel_id was null).
--   channel_type        whatsapp | instagram | messenger | tiktok | telegram | webchat
--   channel_account_id  the channel's external_id (phone number id, page id, IG account id…)
--   channel_name        the channel's name when it was last attached (label of removed accounts)
-- Connecting that same account again re-attaches its conversations.
ALTER TABLE public.conversations
  ADD COLUMN channel_type text,
  ADD COLUMN channel_account_id text,
  ADD COLUMN channel_name text;

-- Copy the channel's origin whenever a conversation gets (or changes) its channel.
-- When channel_id goes null (channel deleted) the origin stays.
CREATE OR REPLACE FUNCTION public.conversations_channel_origin() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.channel_id IS NOT NULL THEN
    SELECT c.type, c.external_id, c.name INTO NEW.channel_type, NEW.channel_account_id, NEW.channel_name
      FROM public.channels c WHERE c.id = NEW.channel_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conversations_channel_origin BEFORE INSERT OR UPDATE OF channel_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_channel_origin();

-- Renaming a channel keeps the label of its conversations current.
CREATE OR REPLACE FUNCTION public.channels_rename_conversations() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.conversations SET channel_name = NEW.name WHERE channel_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER channels_rename_conversations AFTER UPDATE OF name ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.channels_rename_conversations();

-- The same account connected again: its conversations come back to it.
CREATE OR REPLACE FUNCTION public.conversations_reattach() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.conversations
     SET channel_id = NEW.id
   WHERE workspace_id = NEW.workspace_id
     AND channel_id IS NULL
     AND channel_type = NEW.type
     AND channel_account_id = NEW.external_id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER conversations_reattach AFTER INSERT ON public.channels
  FOR EACH ROW EXECUTE FUNCTION public.conversations_reattach();

-- ------------------------------------------------------------------
-- Existing conversations
-- ------------------------------------------------------------------
-- 1) Attached ones: from their channel.
UPDATE public.conversations v
   SET channel_type = c.type, channel_account_id = c.external_id, channel_name = c.name
  FROM public.channels c
 WHERE v.channel_id = c.id;

-- 2) Chats of Instagram / Messenger / TikTok customers that a WhatsApp send
--    adopted after their channel was deleted: the customer wrote to us
--    (inbound messages) but has no WhatsApp identity, so those messages
--    can't have come through WhatsApp. Their network is the only one the
--    contact has; the account is unknown.
WITH wrong AS (
  SELECT v.id, min(i.channel_type) AS real_type
    FROM public.conversations v
    JOIN public.contact_identities i ON i.contact_id = v.contact_id
   WHERE v.channel_type = 'whatsapp'
     AND NOT EXISTS (SELECT 1 FROM public.contact_identities w WHERE w.contact_id = v.contact_id AND w.channel_type = 'whatsapp')
     AND EXISTS (SELECT 1 FROM public.messages m WHERE m.conversation_id = v.id AND m.sender_type = 'customer')
   GROUP BY v.id
  HAVING count(DISTINCT i.channel_type) = 1
)
UPDATE public.conversations v
   SET channel_id = NULL, channel_type = wrong.real_type, channel_account_id = NULL, channel_name = NULL
  FROM wrong
 WHERE v.id = wrong.id AND wrong.real_type <> 'whatsapp';

-- 3) Chats whose channel was deleted: the contact's only network.
UPDATE public.conversations v
   SET channel_type = x.t
  FROM (SELECT contact_id, min(channel_type) AS t
          FROM public.contact_identities
         GROUP BY contact_id
        HAVING count(DISTINCT channel_type) = 1) x
 WHERE v.channel_id IS NULL AND v.channel_type IS NULL AND x.contact_id = v.contact_id;
