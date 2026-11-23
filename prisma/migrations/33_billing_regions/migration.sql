-- Sales regions: each account pays in its region's currency and gateway
-- (pe = soles / Payment Latam, ve = USD / Mispidi, us = USD / Paddle).
-- Every account so far is Peruvian; new ones take the visitor's region
-- the first time they open billing (null until then).
ALTER TABLE public.workspaces ADD COLUMN billing_region text;
UPDATE public.workspaces SET billing_region = 'pe';
ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_billing_region_check
  CHECK (billing_region IS NULL OR billing_region IN ('pe', 've', 'us'));
