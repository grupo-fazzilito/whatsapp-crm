-- Free Forever also lists comment replies, the free FAQ bot and the calendar integrations.
UPDATE public.plans
SET features = '["channels","crm","automations","comments","faqBot","commerce","calendars","agents","team","api"]'::jsonb,
    updated_at = now()
WHERE id = 'free';
