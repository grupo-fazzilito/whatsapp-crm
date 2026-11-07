-- Publicaciones: posts to the business's Facebook page, Instagram account
-- and WhatsApp status, published now or at a scheduled time (cron).
-- They connect through a second Meta app, only for publishing, so its
-- App Review is separate from messaging's.

-- Facebook pages / Instagram accounts the business can publish to.
--   external_id   page id (facebook) or Instagram user id (instagram)
--   page_id       Facebook page that owns it (an Instagram account publishes with its page's token)
--   access_token  page token, encrypted (long-lived: it doesn't expire)
CREATE TABLE public.social_accounts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  network text NOT NULL CHECK (network IN ('facebook', 'instagram')),
  external_id text NOT NULL,
  page_id text NOT NULL,
  name text NOT NULL,
  username text,
  picture_url text,
  access_token text NOT NULL,
  status text DEFAULT 'active' NOT NULL CHECK (status IN ('active', 'error')),
  last_error text,
  connected_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX uq_social_accounts ON public.social_accounts (workspace_id, network, external_id);

-- One post, to one or more destinations.
--   status       draft | pending_approval (made automatically, waits for the business)
--                | scheduled | publishing | published | partial (some destinations failed)
--                | failed | cancelled
--   format       post (photo / carousel / video) | story | reel
--   media        [{ url, type: image|video }] in order
--   targets      facebook | instagram | whatsapp_status
--   origin       manual | new_product | restock | calendar
--   slot_key     calendar slot it fills ("2026-11-09T19:00"), so it's made once
--   results      per destination: { status, id, url, error, at }
--   share_token  public page with the media and text to post on WhatsApp status
CREATE TABLE public.social_posts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  status text DEFAULT 'draft' NOT NULL CHECK (status IN ('draft', 'pending_approval', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'cancelled')),
  format text DEFAULT 'post' NOT NULL CHECK (format IN ('post', 'story', 'reel')),
  caption text DEFAULT '' NOT NULL,
  media jsonb DEFAULT '[]' NOT NULL,
  product_id uuid REFERENCES public.products (id) ON DELETE SET NULL,
  link_url text,
  targets text[] DEFAULT '{}' NOT NULL,
  scheduled_at timestamptz,
  published_at timestamptz,
  origin text DEFAULT 'manual' NOT NULL CHECK (origin IN ('manual', 'new_product', 'restock', 'calendar')),
  slot_key text,
  results jsonb DEFAULT '{}' NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  last_error text,
  share_token text NOT NULL UNIQUE,
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX idx_social_posts_workspace ON public.social_posts (workspace_id, scheduled_at DESC);
CREATE INDEX idx_social_posts_due ON public.social_posts (scheduled_at) WHERE status = 'scheduled';
CREATE UNIQUE INDEX uq_social_posts_slot ON public.social_posts (workspace_id, slot_key) WHERE slot_key IS NOT NULL;
