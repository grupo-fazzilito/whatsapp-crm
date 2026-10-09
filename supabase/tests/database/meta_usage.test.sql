-- WhatsApp messages Meta bills (migration 044).
-- Run: npx supabase test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

INSERT INTO auth.users (id, email, raw_user_meta_data, instance_id, aud, role)
VALUES ('00000000-0000-0000-0000-0000000000d1', 'owner-d@test.dev', '{"full_name":"Owner D","business_name":"Biz D","business_type":"store"}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

CREATE TEMP TABLE ids AS
SELECT (SELECT workspace_id FROM public.workspace_members WHERE user_id = '00000000-0000-0000-0000-0000000000d1') AS ws,
       '00000000-0000-0000-0000-00000000aa01'::uuid AS wa1,
       '00000000-0000-0000-0000-00000000aa02'::uuid AS web;

INSERT INTO public.channels (id, workspace_id, type, name, external_id)
SELECT wa1, ws, 'whatsapp', 'Ventas', 'pn-test-d1' FROM ids
UNION ALL SELECT web, ws, 'webchat', 'Web', 'pk_test_d1' FROM ids;
INSERT INTO public.contacts (id, workspace_id, name, phone) SELECT '00000000-0000-0000-0000-00000000cc01'::uuid, ws, 'Cliente', '+51999000001' FROM ids;
INSERT INTO public.conversations (id, workspace_id, contact_id, channel_id)
SELECT '00000000-0000-0000-0000-00000000c001'::uuid, ws, '00000000-0000-0000-0000-00000000cc01'::uuid, wa1 FROM ids
UNION ALL SELECT '00000000-0000-0000-0000-00000000c002'::uuid, ws, '00000000-0000-0000-0000-00000000cc01'::uuid, web FROM ids;
INSERT INTO public.message_templates (workspace_id, channel_id, name, category, language, body_text, status)
SELECT ws, wa1, 'promo_octubre', 'Marketing', 'es', 'Promo', 'Approved' FROM ids
UNION ALL SELECT ws, NULL, 'recordatorio', 'Utility', 'es', 'Recordatorio', 'Approved' FROM ids;

-- WhatsApp conversation
INSERT INTO public.messages (workspace_id, conversation_id, sender_type, content_type, content_text, template_name, status, is_internal, metadata, created_at)
SELECT ws, '00000000-0000-0000-0000-00000000c001'::uuid, s, ct, 'x', tn, st, internal, md::jsonb, NOW()
FROM ids, (VALUES
  ('bot',      'text',     NULL,            'delivered', false, '{}'),                                   -- service
  ('agent',    'image',    NULL,            'read',      false, '{}'),                                   -- service
  ('bot',      'interactive', NULL,         'sent',      false, '{}'),                                   -- service
  ('agent',    'text',     NULL,            'failed',    false, '{}'),                                   -- failed: no
  ('agent',    'text',     NULL,            'sent',      true,  '{}'),                                   -- internal note: no
  ('agent',    'text',     NULL,            'sent',      false, '{"source":"whatsapp_business_app"}'),   -- typed in the app: no
  ('bot',      'system',   NULL,            'delivered', false, '{}'),                                   -- system: no
  ('customer', 'text',     NULL,            'delivered', false, '{}'),                                   -- inbound: free
  ('agent',    'template', 'promo_octubre', 'delivered', false, '{}'),                                   -- marketing
  ('agent',    'template', 'recordatorio',  'delivered', false, '{}'),                                   -- utility (workspace-wide template)
  ('agent',    'template', 'desconocida',   'delivered', false, '{}')                                    -- other
) AS v(s, ct, tn, st, internal, md);
-- Web chat and last month: not counted
INSERT INTO public.messages (workspace_id, conversation_id, sender_type, content_type, content_text, status, created_at)
SELECT ws, '00000000-0000-0000-0000-00000000c002'::uuid, 'bot', 'text', 'web', 'delivered', NOW() FROM ids
UNION ALL SELECT ws, '00000000-0000-0000-0000-00000000c001'::uuid, 'bot', 'text', 'old', 'delivered', NOW() - INTERVAL '40 days' FROM ids;

CREATE TEMP TABLE u AS SELECT * FROM public.meta_message_usage((SELECT ws FROM ids), NOW() - INTERVAL '1 day', NOW() + INTERVAL '1 day');

SELECT is((SELECT count(*)::int FROM u), 1, 'only WhatsApp channels are counted');
SELECT is((SELECT service::int FROM u), 3, 'service = agent/bot replies, excluding failed, notes, system and app echoes');
SELECT is((SELECT marketing::int FROM u), 1, 'marketing template by its channel template');
SELECT is((SELECT utility::int FROM u), 1, 'utility template from a workspace-wide template');
SELECT is((SELECT other_template::int FROM u), 1, 'unknown template → other');
SELECT is((SELECT authentication::int FROM u), 0, 'no authentication templates');
SELECT is((SELECT service::int FROM public.meta_message_usage((SELECT ws FROM ids), NOW() - INTERVAL '60 days', NOW() - INTERVAL '30 days')), 1, 'the period bounds apply');
SELECT ok(NOT has_function_privilege('authenticated', 'public.meta_message_usage(uuid,timestamptz,timestamptz)', 'execute'), 'server-only');

SELECT * FROM finish();
ROLLBACK;
