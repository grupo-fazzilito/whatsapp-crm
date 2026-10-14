-- Automatic replies to comments on the business's Instagram and Facebook posts.
--   channel_id      null = every Instagram / Facebook account of the workspace
--   post_id         provider id of one post; null = every post
--   keywords        any of them in the comment triggers the rule (accents and case ignored); empty = every comment
--   public_replies  one is picked at random and posted under the comment; empty = no public reply
--   private_message sent once as a direct message to the person who commented ("private reply")
CREATE TABLE public.comment_rules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  name text NOT NULL,
  channel_id uuid REFERENCES public.channels (id) ON DELETE CASCADE,
  post_id text,
  post_label text,
  keywords text[] DEFAULT '{}' NOT NULL,
  public_replies text[] DEFAULT '{}' NOT NULL,
  private_message text,
  enabled boolean DEFAULT true NOT NULL,
  position integer DEFAULT 0 NOT NULL,
  replies_count integer DEFAULT 0 NOT NULL,
  last_triggered_at timestamptz,
  created_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX idx_comment_rules_workspace ON public.comment_rules (workspace_id, position);

-- One row per comment a rule answered (or tried to): the log, and what
-- keeps a comment from being answered twice when Meta retries a webhook.
--   status  replied | partial (one of the two replies failed) | failed | skipped (person already answered on this post)
CREATE TABLE public.comment_replies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.channels (id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.comment_rules (id) ON DELETE SET NULL,
  comment_id text NOT NULL,
  post_id text,
  author_id text,
  author_name text,
  comment_text text,
  status text NOT NULL CHECK (status IN ('replied', 'partial', 'failed', 'skipped')),
  public_reply_id text,
  private_message_id text,
  conversation_id uuid REFERENCES public.conversations (id) ON DELETE SET NULL,
  error text,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (channel_id, comment_id)
);
CREATE INDEX idx_comment_replies_workspace ON public.comment_replies (workspace_id, created_at DESC);
CREATE INDEX idx_comment_replies_author ON public.comment_replies (channel_id, post_id, author_id);
