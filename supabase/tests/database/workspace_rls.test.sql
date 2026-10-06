-- Tenant isolation for migration 021 (workspaces).
-- Run: npx supabase test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(14);

-- Fixtures: two workspaces. A has an owner and an agent; B has its own owner.
INSERT INTO auth.users (id, email, raw_user_meta_data, instance_id, aud, role)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'owner-a@test.dev', '{"full_name":"Owner A","business_name":"Biz A","business_type":"barbershop"}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'agent-a@test.dev', '{"full_name":"Agent A","invite":true}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner-b@test.dev', '{"full_name":"Owner B","business_name":"Biz B","business_type":"store"}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

SELECT is(
  (SELECT count(*)::int FROM public.workspace_members WHERE user_id = '00000000-0000-0000-0000-0000000000a1' AND role = 'owner'),
  1, 'signup trigger creates a workspace with the user as owner');
SELECT is(
  (SELECT industry FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id = w.id
    WHERE m.user_id = '00000000-0000-0000-0000-0000000000a1'),
  'barbershop', 'business_type maps to the industry preset');
SELECT is(
  (SELECT count(*)::int FROM public.workspace_members WHERE user_id = '00000000-0000-0000-0000-0000000000a2'),
  0, 'invited signups get no workspace of their own');

CREATE TEMP TABLE ids AS
SELECT
  (SELECT workspace_id FROM public.workspace_members WHERE user_id = '00000000-0000-0000-0000-0000000000a1') AS ws_a,
  (SELECT workspace_id FROM public.workspace_members WHERE user_id = '00000000-0000-0000-0000-0000000000b1') AS ws_b;
GRANT SELECT ON ids TO authenticated;

INSERT INTO public.workspace_members (workspace_id, user_id, role)
SELECT ws_a, '00000000-0000-0000-0000-0000000000a2'::uuid, 'agent' FROM ids;

INSERT INTO public.contacts (workspace_id, user_id, name, phone)
SELECT ws_a, '00000000-0000-0000-0000-0000000000a1'::uuid, 'Cliente A', '+5215500000001' FROM ids
UNION ALL
SELECT ws_b, '00000000-0000-0000-0000-0000000000b1'::uuid, 'Cliente B', '+5215500000002' FROM ids;

-- ---- as the agent of A ----
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.contacts), 1, 'agent sees only contacts of its workspace');
SELECT is((SELECT name FROM public.contacts), 'Cliente A', 'and it is the right one');
SELECT is((SELECT count(*)::int FROM public.workspaces), 1, 'agent sees only its workspace');

SELECT lives_ok(
  $$INSERT INTO public.contacts (workspace_id, name, phone) SELECT ws_a, 'Nuevo', '+5215500000003' FROM ids$$,
  'agent can create contacts in its workspace');
SELECT throws_ok(
  $$INSERT INTO public.contacts (workspace_id, name, phone) SELECT ws_b, 'Intruso', '+5215500000004' FROM ids$$,
  '42501', NULL, 'agent cannot write into another workspace');
SELECT throws_ok(
  $$INSERT INTO public.tags (workspace_id, name, color) SELECT ws_a, 'vip', '#000' FROM ids$$,
  '42501', NULL, 'agent cannot write admin-only settings (tags)');
SELECT is(
  (SELECT count(*)::int FROM public.workspace_members WHERE role = 'owner'),
  1, 'agent sees teammates but not other workspaces members');

-- Active-workspace header: a member of A that asks for B sees nothing.
SELECT set_config('request.headers', (SELECT json_build_object('x-workspace-id', ws_b)::text FROM ids), true);
SELECT is((SELECT count(*)::int FROM public.contacts), 0, 'header pointing at a foreign workspace yields nothing');
SELECT set_config('request.headers', (SELECT json_build_object('x-workspace-id', ws_a)::text FROM ids), true);

SELECT is(
  (SELECT workspace_id FROM public.contacts WHERE name = 'Nuevo') = (SELECT ws_a FROM ids),
  true, 'workspace_id was stored on insert');

-- Users cannot grant themselves platform admin.
UPDATE public.profiles SET is_platform_admin = true WHERE user_id = '00000000-0000-0000-0000-0000000000a2';
SELECT is(
  (SELECT is_platform_admin FROM public.profiles WHERE user_id = '00000000-0000-0000-0000-0000000000a2'),
  false, 'is_platform_admin cannot be self-assigned');

-- ---- as the owner of B ----
SELECT set_config('request.headers', '', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.contacts), 1, 'owner B sees only its own contacts');

SELECT * FROM finish();
ROLLBACK;
