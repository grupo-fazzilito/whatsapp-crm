-- Platform admin opening a customer's account ("Entrar como cliente").
-- The session belongs to the customer; impersonated_by marks who opened it,
-- so it never counts as the customer's own sign-in.
ALTER TABLE public.auth_sessions ADD COLUMN impersonated_by uuid REFERENCES public.users (id) ON DELETE CASCADE;

-- Internal record, only shown in the admin panel.
CREATE TABLE public.admin_impersonations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  admin_email text NOT NULL,
  target_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  target_email text NOT NULL,
  workspace_id uuid REFERENCES public.workspaces (id) ON DELETE SET NULL,
  workspace_name text,
  session_token text,
  ip_address text,
  user_agent text,
  started_at timestamptz DEFAULT now() NOT NULL,
  ended_at timestamptz
);
CREATE INDEX idx_admin_impersonations_started ON public.admin_impersonations (started_at DESC);
