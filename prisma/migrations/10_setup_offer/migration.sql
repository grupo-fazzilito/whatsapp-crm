-- Assisted setup offer (S/ 250 over Google Meet): when the user answered the
-- one-time "Need help setting up your account?" dialog. NULL = not shown yet.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS setup_offer_seen_at timestamptz;
