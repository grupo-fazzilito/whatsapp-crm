-- ============================================================
-- 042 — Billing: prepaid AI credits (Payment Latam)
--
-- No subscriptions. Workspaces buy credits (minimum S/50) through a
-- Payment Latam Payin checkout link; every AI reply/action spends credits
-- at the prices set in the admin panel (platform_settings 'billing').
-- Credits expire 6 months after purchase (configurable); spending takes
-- the lots that expire first.
--
-- billing_accounts   1:1 with workspaces: payer data Payment Latam asks
--                    for (document, name, email) and notification marks.
-- credit_lots        One row per grant (purchase / welcome / admin grant)
--                    with its own expiry and remaining credits.
-- credit_ledger      Append-only history: +purchase, +welcome, +grant,
--                    -usage, -expiry, -reversal, ±adjustment.
-- billing_payments   Payin orders: pending → paid | expired | reversed.
--
-- Writes only through the SECURITY DEFINER functions below, called by the
-- server with the service role (EXECUTE revoked from clients). Workspace
-- admins can read their own rows (RLS).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.billing_accounts (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Payment Latam catalogue: 1 DNI, 2 RUC, 3 CE, 4 PA
  doc_type SMALLINT CHECK (doc_type IS NULL OR doc_type BETWEEN 1 AND 4),
  doc_number TEXT CHECK (doc_number IS NULL OR doc_number ~ '^[A-Za-z0-9]{5,20}$'),
  legal_name TEXT CHECK (legal_name IS NULL OR char_length(legal_name) BETWEEN 2 AND 200),
  email TEXT CHECK (email IS NULL OR char_length(email) BETWEEN 5 AND 60),
  low_notified_at TIMESTAMPTZ,
  depleted_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS set_updated_at ON public.billing_accounts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.billing_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.billing_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'payment_latam',
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'PEN',
  credits INTEGER NOT NULL CHECK (credits > 0),
  unit_price NUMERIC(10,4) NOT NULL CHECK (unit_price > 0),
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN ('creating', 'pending', 'paid', 'expired', 'reversed', 'failed')),
  provider_order_id TEXT UNIQUE,
  reference TEXT,
  checkout_url TEXT,
  expires_on DATE,
  paid_at TIMESTAMPTZ,
  error TEXT,
  payer JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_payments_ws ON public.billing_payments(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_payments_pending ON public.billing_payments(created_at) WHERE status = 'pending';
DROP TRIGGER IF EXISTS set_updated_at ON public.billing_payments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.billing_payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.credit_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('purchase', 'welcome', 'grant')),
  credits_total INTEGER NOT NULL CHECK (credits_total > 0),
  credits_remaining INTEGER NOT NULL CHECK (credits_remaining >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  payment_id UUID UNIQUE REFERENCES public.billing_payments(id) ON DELETE SET NULL,
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (credits_remaining <= credits_total)
);
CREATE INDEX IF NOT EXISTS idx_credit_lots_live ON public.credit_lots(workspace_id, expires_at) WHERE credits_remaining > 0;

CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('purchase', 'welcome', 'grant', 'usage', 'expiry', 'reversal', 'adjustment')),
  credits INTEGER NOT NULL,
  -- usage: reply | followup | summary | suggest | transcription | vision
  action TEXT,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  lot_id UUID REFERENCES public.credit_lots(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES public.billing_payments(id) ON DELETE SET NULL,
  note TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_ws ON public.credit_ledger(workspace_id, created_at DESC);

ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_admin_read ON public.billing_accounts;
CREATE POLICY ws_admin_read ON public.billing_accounts FOR SELECT USING (public.ws_access(workspace_id, 'admin'));
DROP POLICY IF EXISTS ws_admin_read ON public.billing_payments;
CREATE POLICY ws_admin_read ON public.billing_payments FOR SELECT USING (public.ws_access(workspace_id, 'admin'));
DROP POLICY IF EXISTS ws_admin_read ON public.credit_lots;
CREATE POLICY ws_admin_read ON public.credit_lots FOR SELECT USING (public.ws_access(workspace_id, 'admin'));
DROP POLICY IF EXISTS ws_admin_read ON public.credit_ledger;
CREATE POLICY ws_admin_read ON public.credit_ledger FOR SELECT USING (public.ws_access(workspace_id, 'admin'));

-- ------------------------------------------------------------
-- Balance: credits left in lots that have not expired.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_balance(ws UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(credits_remaining), 0)::INTEGER
  FROM public.credit_lots
  WHERE workspace_id = ws AND credits_remaining > 0 AND expires_at > NOW();
$$;

-- ------------------------------------------------------------
-- Grant: new lot + ledger row. Returns the lot id.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_credits(
  ws UUID, amount INTEGER, src TEXT, expires TIMESTAMPTZ,
  pay UUID DEFAULT NULL, why TEXT DEFAULT NULL, actor UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lot UUID;
BEGIN
  IF amount IS NULL OR amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;
  INSERT INTO public.credit_lots (workspace_id, source, credits_total, credits_remaining, expires_at, payment_id, note, created_by)
  VALUES (ws, src, amount, amount, expires, pay, why, actor)
  RETURNING id INTO lot;
  INSERT INTO public.credit_ledger (workspace_id, kind, credits, lot_id, payment_id, note, created_by)
  VALUES (ws, src, amount, lot, pay, why, actor);
  -- New credits re-arm the low/depleted notifications.
  UPDATE public.billing_accounts SET low_notified_at = NULL, depleted_notified_at = NULL WHERE workspace_id = ws;
  RETURN lot;
END;
$$;

-- ------------------------------------------------------------
-- Spend: takes `amount` credits from the lots that expire first.
-- partial = TRUE spends whatever is left when short (the action already
-- happened); FALSE spends nothing when short. Returns the balance after,
-- or -1 when nothing was spent because the balance was insufficient.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.spend_credits(
  ws UUID, amount INTEGER, act TEXT, conv UUID DEFAULT NULL,
  partial BOOLEAN DEFAULT TRUE, why TEXT DEFAULT NULL, actor UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  available INTEGER;
  todo INTEGER;
  spent INTEGER := 0;
  take INTEGER;
  r RECORD;
BEGIN
  IF amount IS NULL OR amount <= 0 THEN
    RETURN public.credit_balance(ws);
  END IF;
  -- Lock the live lots so concurrent replies can't spend the same credits.
  SELECT COALESCE(SUM(credits_remaining), 0) INTO available FROM (
    SELECT credits_remaining FROM public.credit_lots
    WHERE workspace_id = ws AND credits_remaining > 0 AND expires_at > NOW()
    FOR UPDATE
  ) l;
  IF available < amount AND NOT partial THEN
    RETURN -1;
  END IF;
  todo := LEAST(amount, available);
  FOR r IN
    SELECT id, credits_remaining FROM public.credit_lots
    WHERE workspace_id = ws AND credits_remaining > 0 AND expires_at > NOW()
    ORDER BY expires_at, created_at
  LOOP
    EXIT WHEN todo <= 0;
    take := LEAST(todo, r.credits_remaining);
    UPDATE public.credit_lots SET credits_remaining = credits_remaining - take WHERE id = r.id;
    todo := todo - take;
    spent := spent + take;
  END LOOP;
  IF spent > 0 THEN
    INSERT INTO public.credit_ledger (workspace_id, kind, credits, action, conversation_id, note, created_by)
    VALUES (ws, CASE WHEN act = 'adjustment' THEN 'adjustment' ELSE 'usage' END, -spent, NULLIF(act, 'adjustment'), conv, why, actor);
  END IF;
  RETURN available - spent;
END;
$$;

-- ------------------------------------------------------------
-- Payment confirmed (verified with Payment Latam by the server).
-- Idempotent: only a pending/expired payment becomes paid, once.
-- Returns TRUE when credits were granted by this call.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_billing_payment(pay UUID, months INTEGER DEFAULT 6)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.billing_payments;
BEGIN
  SELECT * INTO p FROM public.billing_payments WHERE id = pay FOR UPDATE;
  IF NOT FOUND OR p.status NOT IN ('pending', 'expired') THEN
    RETURN FALSE;
  END IF;
  UPDATE public.billing_payments SET status = 'paid', paid_at = NOW(), error = NULL WHERE id = pay;
  PERFORM public.grant_credits(p.workspace_id, p.credits, 'purchase', NOW() + make_interval(months => GREATEST(months, 1)), pay, NULL, p.created_by);
  RETURN TRUE;
END;
$$;

-- ------------------------------------------------------------
-- Reversal (EXTORNO): removes what is left of that purchase.
-- Credits already spent are not clawed back. Returns credits removed.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_billing_payment(pay UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.billing_payments;
  l public.credit_lots;
  removed INTEGER := 0;
BEGIN
  SELECT * INTO p FROM public.billing_payments WHERE id = pay FOR UPDATE;
  IF NOT FOUND OR p.status <> 'paid' THEN
    RETURN 0;
  END IF;
  UPDATE public.billing_payments SET status = 'reversed' WHERE id = pay;
  SELECT * INTO l FROM public.credit_lots WHERE payment_id = pay FOR UPDATE;
  IF FOUND AND l.credits_remaining > 0 THEN
    removed := l.credits_remaining;
    UPDATE public.credit_lots SET credits_remaining = 0 WHERE id = l.id;
    INSERT INTO public.credit_ledger (workspace_id, kind, credits, lot_id, payment_id)
    VALUES (p.workspace_id, 'reversal', -removed, l.id, pay);
  END IF;
  RETURN removed;
END;
$$;

-- ------------------------------------------------------------
-- Expiry sweep (cron): zero out expired lots and log it.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_credit_lots()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  n INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id, workspace_id, credits_remaining FROM public.credit_lots
    WHERE credits_remaining > 0 AND expires_at <= NOW()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.credit_lots SET credits_remaining = 0 WHERE id = r.id;
    INSERT INTO public.credit_ledger (workspace_id, kind, credits, lot_id)
    VALUES (r.workspace_id, 'expiry', -r.credits_remaining, r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- ------------------------------------------------------------
-- Welcome credits for every new workspace (platform_settings 'billing'
-- → welcome_credits, default 100; expiry_months, default 6).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_on_workspace_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg JSONB;
  credits INTEGER;
  months INTEGER;
BEGIN
  INSERT INTO public.billing_accounts (workspace_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  SELECT value INTO cfg FROM public.platform_settings WHERE key = 'billing';
  credits := COALESCE((cfg->>'welcome_credits')::INTEGER, 100);
  months := COALESCE((cfg->>'expiry_months')::INTEGER, 6);
  IF credits > 0 THEN
    PERFORM public.grant_credits(NEW.id, credits, 'welcome', NOW() + make_interval(months => GREATEST(months, 1)), NULL, NULL, NULL);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block a signup because of billing.
  RAISE WARNING 'billing_on_workspace_created: %', SQLERRM;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS billing_on_workspace_created ON public.workspaces;
CREATE TRIGGER billing_on_workspace_created AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.billing_on_workspace_created();

-- Existing workspaces: an account and the same welcome credits, once.
INSERT INTO public.billing_accounts (workspace_id) SELECT id FROM public.workspaces ON CONFLICT DO NOTHING;
DO $$
DECLARE
  w RECORD;
BEGIN
  FOR w IN SELECT id FROM public.workspaces ws WHERE NOT EXISTS (SELECT 1 FROM public.credit_lots l WHERE l.workspace_id = ws.id) LOOP
    PERFORM public.grant_credits(w.id, 100, 'welcome', NOW() + INTERVAL '6 months', NULL, NULL, NULL);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.credit_balance(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_credits(UUID, INTEGER, TEXT, TIMESTAMPTZ, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.spend_credits(UUID, INTEGER, TEXT, UUID, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_billing_payment(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reverse_billing_payment(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_credit_lots() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.billing_on_workspace_created() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_balance(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_credits(UUID, INTEGER, TEXT, TIMESTAMPTZ, UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.spend_credits(UUID, INTEGER, TEXT, UUID, BOOLEAN, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_billing_payment(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.reverse_billing_payment(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_credit_lots() TO service_role;

-- Notifications: billing alerts for workspace admins.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('mention', 'assigned', 'transferred', 'system', 'billing'));
