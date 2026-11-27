-- Setup wizard after signup: shown to the owner/admin of a business until it
-- is finished or skipped. State in workspaces.settings.onboarding; a business
-- without it is new. Businesses that already exist never see it on their own
-- (they can open it from the dashboard's setup checklist).
UPDATE public.workspaces
   SET settings = COALESCE(settings, '{}'::jsonb) || '{"onboarding": {"status": "done"}}'::jsonb
 WHERE NOT (COALESCE(settings, '{}'::jsonb) ? 'onboarding');
