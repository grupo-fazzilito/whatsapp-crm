-- Telegram bots as a channel type (Bot API, official).
ALTER TABLE public.channels DROP CONSTRAINT channels_type_check;
ALTER TABLE public.channels ADD CONSTRAINT channels_type_check
  CHECK ((type = ANY (ARRAY['whatsapp'::text, 'messenger'::text, 'instagram'::text, 'tiktok'::text, 'telegram'::text, 'webchat'::text])));

ALTER TABLE public.contact_identities DROP CONSTRAINT contact_identities_channel_type_check;
ALTER TABLE public.contact_identities ADD CONSTRAINT contact_identities_channel_type_check
  CHECK ((channel_type = ANY (ARRAY['whatsapp'::text, 'messenger'::text, 'instagram'::text, 'tiktok'::text, 'telegram'::text, 'webchat'::text])));
