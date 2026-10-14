-- Each automatically answered comment costs tokens; with none left the comment is logged as no_tokens.
ALTER TABLE public.comment_replies DROP CONSTRAINT comment_replies_status_check;
ALTER TABLE public.comment_replies ADD CONSTRAINT comment_replies_status_check
  CHECK (status IN ('replied', 'partial', 'failed', 'skipped', 'no_tokens'));
