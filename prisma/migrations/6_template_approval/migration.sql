-- Templates created in Whasalia and submitted to Meta for approval.
--   variables          named variables of the editor ({{nombre_cliente}}): key, label, example, source, index (Meta position)
--   header_media_url   sample image/video/document of the header (our storage)
--   meta_template_id   id returned by Meta when submitted / found on sync
--   rejection_reason   Meta's reason when rejected, paused or disabled
-- body_text keeps the named form; the positional form is built on submit.
ALTER TABLE public.message_templates
  ADD COLUMN variables jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN header_media_url text,
  ADD COLUMN meta_template_id text,
  ADD COLUMN rejection_reason text,
  ADD COLUMN submitted_at timestamptz;

CREATE INDEX idx_message_templates_meta_id ON public.message_templates (meta_template_id) WHERE meta_template_id IS NOT NULL;
