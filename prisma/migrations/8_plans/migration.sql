-- Plans a workspace (business) can be on. Whasalia starts with one plan,
-- 'free' (Free Forever); AI usage is paid apart with prepaid tokens
-- (credit_lots / credit_ledger). A paid plan later is a new row here.
--   features   i18n keys listed on the pricing page (mktPlans.features.*)
--   limits     future caps per plan, e.g. {"members": 5}; {} = no caps
--   is_public  shown on the pricing page
CREATE TABLE public.plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  price_monthly numeric(10,2) DEFAULT 0 NOT NULL CHECK (price_monthly >= 0),
  currency text DEFAULT 'PEN' NOT NULL,
  features jsonb DEFAULT '[]'::jsonb NOT NULL,
  limits jsonb DEFAULT '{}'::jsonb NOT NULL,
  is_public boolean DEFAULT true NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

INSERT INTO public.plans (id, name, price_monthly, features, sort_order)
VALUES ('free', 'Free Forever', 0, '["channels","crm","automations","commerce","agents","team","api"]'::jsonb, 0);

-- Every workspace is on a plan; existing and new ones start on 'free'.
ALTER TABLE public.workspaces
  ADD COLUMN plan_id text DEFAULT 'free' NOT NULL REFERENCES public.plans (id) ON UPDATE CASCADE,
  ADD COLUMN plan_changed_at timestamptz DEFAULT now() NOT NULL;

CREATE INDEX idx_workspaces_plan_id ON public.workspaces (plan_id);
