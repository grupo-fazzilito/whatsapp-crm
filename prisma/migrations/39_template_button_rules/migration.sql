-- What the AI agent does when a customer presses a quick-reply button of a
-- WhatsApp template: { "<button text>": "<rule>" }. Kept apart from the
-- buttons sent to Meta, so it can change without a new review.
ALTER TABLE public.message_templates
  ADD COLUMN button_rules jsonb NOT NULL DEFAULT '{}'::jsonb;
