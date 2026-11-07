-- Marketing messages on Messenger (Meta's Marketing Message API): promos
-- to people who subscribed in the chat, sent from Difusiones and paid by
-- the business through its Meta ad account.

-- The business's connection: page + ad account + the non-expiring
-- business system user token from Facebook Login for Business (encrypted).
CREATE TABLE public.messenger_marketing (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces (id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels (id) ON DELETE CASCADE,
  page_id text NOT NULL,
  ad_account_id text NOT NULL,
  ad_account_name text,
  ad_account_currency text,
  access_token text NOT NULL,
  status text DEFAULT 'active' NOT NULL CHECK (status IN ('active', 'error')),
  last_error text,
  connected_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- People who accepted (or were asked) to get offers on Messenger.
--   status      invited (opt-in request sent) | subscribed | stopped (they turned it off)
--   token       notification_messages_token (subscription token) from Meta
--   last_sent_at  Meta allows one marketing message every 12 h per token
CREATE TABLE public.messenger_subscribers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels (id) ON DELETE CASCADE,
  psid text NOT NULL,
  contact_id uuid REFERENCES public.contacts (id) ON DELETE SET NULL,
  status text DEFAULT 'invited' NOT NULL CHECK (status IN ('invited', 'subscribed', 'stopped')),
  token text,
  token_expires_at timestamptz,
  source text DEFAULT 'chat' NOT NULL CHECK (source IN ('chat', 'inbox', 'import')),
  invited_at timestamptz,
  subscribed_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX uq_messenger_subscribers ON public.messenger_subscribers (channel_id, psid);
CREATE INDEX idx_messenger_subscribers_ws ON public.messenger_subscribers (workspace_id, status);

-- A broadcast can now go out on Messenger (a card instead of a WhatsApp template).
--   kind          whatsapp_template | messenger_card
--   message       Messenger card { title, subtitle, image_url, button_text, button_url }
--   meta_campaign_id  message campaign created in the ad account
--   budget        lifetime budget in the ad account's currency (null = Meta's estimate)
ALTER TABLE public.broadcasts
  ADD COLUMN kind text DEFAULT 'whatsapp_template' NOT NULL CHECK (kind IN ('whatsapp_template', 'messenger_card')),
  ADD COLUMN message jsonb,
  ADD COLUMN meta_campaign_id text,
  ADD COLUMN budget numeric(12, 2);
ALTER TABLE public.broadcast_recipients
  ADD COLUMN subscriber_id uuid REFERENCES public.messenger_subscribers (id) ON DELETE SET NULL,
  ADD COLUMN tracking_id text;
