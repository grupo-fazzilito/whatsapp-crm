-- Prepaid AI credits (migration 042) and closed SECURITY DEFINER RPCs (043).
-- Run: npx supabase test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(19);

INSERT INTO auth.users (id, email, raw_user_meta_data, instance_id, aud, role)
VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'owner-c@test.dev', '{"full_name":"Owner C","business_name":"Biz C","business_type":"restaurant"}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', 'agent-c@test.dev', '{"full_name":"Agent C","invite":true}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');

CREATE TEMP TABLE ids AS
SELECT (SELECT workspace_id FROM public.workspace_members WHERE user_id = '00000000-0000-0000-0000-0000000000c1') AS ws;
GRANT SELECT ON ids TO authenticated;
INSERT INTO public.workspace_members (workspace_id, user_id, role) SELECT ws, '00000000-0000-0000-0000-0000000000c2'::uuid, 'agent' FROM ids;

-- Welcome credits
SELECT is((SELECT public.credit_balance(ws) FROM ids), 100, 'new workspace gets 100 welcome credits');
SELECT is((SELECT count(*)::int FROM public.billing_accounts a JOIN ids ON a.workspace_id = ids.ws), 1, 'and a billing account');

-- Lots: one expiring soon (30), the welcome one (100, 6 months), one already expired (500)
SELECT public.grant_credits(ws, 30, 'grant', NOW() + INTERVAL '1 day', NULL, 'soon', NULL) FROM ids;
INSERT INTO public.credit_lots (workspace_id, source, credits_total, credits_remaining, expires_at)
SELECT ws, 'grant', 500, 500, NOW() - INTERVAL '1 minute' FROM ids;
SELECT is((SELECT public.credit_balance(ws) FROM ids), 130, 'expired lots do not count');

-- FIFO by expiry
SELECT is((SELECT public.spend_credits(ws, 40, 'reply') FROM ids), 90, 'spend returns the balance after');
SELECT is((SELECT credits_remaining FROM public.credit_lots l JOIN ids ON l.workspace_id = ids.ws WHERE note = 'soon'), 0, 'the lot expiring first is used first');
SELECT is((SELECT credits_remaining FROM public.credit_lots l JOIN ids ON l.workspace_id = ids.ws WHERE source = 'welcome'), 90, 'then the next one');
SELECT is((SELECT credits FROM public.credit_ledger g JOIN ids ON g.workspace_id = ids.ws WHERE kind = 'usage'), -40, 'usage is logged once with the total');

-- Insufficient
SELECT is((SELECT public.spend_credits(ws, 1000, 'reply', NULL, FALSE) FROM ids), -1, 'non-partial spend refuses when short');
SELECT is((SELECT public.credit_balance(ws) FROM ids), 90, 'and spends nothing');
SELECT is((SELECT public.spend_credits(ws, 1000, 'reply', NULL, TRUE) FROM ids), 0, 'partial spend takes what is left');

-- Payments
INSERT INTO public.billing_payments (id, workspace_id, amount, credits, unit_price, status, provider_order_id)
SELECT '00000000-0000-0000-0000-00000000f001', ws, 50, 1000, 0.05, 'pending', 'ORD-T1' FROM ids;
SELECT ok((SELECT public.apply_billing_payment('00000000-0000-0000-0000-00000000f001', 6)), 'approved payment grants credits');
SELECT ok(NOT (SELECT public.apply_billing_payment('00000000-0000-0000-0000-00000000f001', 6)), 'only once');
SELECT is((SELECT public.credit_balance(ws) FROM ids), 1000, 'balance = purchased credits');
SELECT ok((SELECT expires_at BETWEEN NOW() + INTERVAL '179 days' AND NOW() + INTERVAL '185 days' FROM public.credit_lots WHERE payment_id = '00000000-0000-0000-0000-00000000f001'), 'purchased credits expire in 6 months');

SELECT public.spend_credits(ws, 100, 'reply') FROM ids;
SELECT is((SELECT public.reverse_billing_payment('00000000-0000-0000-0000-00000000f001')), 900, 'reversal removes what is left of that purchase');

-- Expiry sweep
SELECT is((SELECT public.expire_credit_lots()), 1, 'sweep zeroes the expired lot');
SELECT is((SELECT credits FROM public.credit_ledger g JOIN ids ON g.workspace_id = ids.ws WHERE kind = 'expiry'), -500, 'and logs it');

-- Clients cannot call the money functions nor the order RPCs (043)
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.spend_credits(uuid,integer,text,uuid,boolean,text,uuid)', 'execute')
  AND NOT has_function_privilege('anon', 'public.grant_credits(uuid,integer,text,timestamp with time zone,uuid,text,uuid)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.apply_billing_payment(uuid,integer)', 'execute'),
  'credit functions are server-only');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.confirm_order(uuid,uuid)', 'execute')
  AND NOT has_function_privilege('anon', 'public.cancel_order(uuid,uuid,text)', 'execute')
  AND NOT has_function_privilege('authenticated', 'public.default_ws_for_user(uuid)', 'execute'),
  'order RPCs are server-only');

SELECT * FROM finish();
ROLLBACK;
