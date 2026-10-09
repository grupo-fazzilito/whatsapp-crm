-- Guided tour: when the user finished (or skipped) it; NULL = show it on first visit.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tour_completed_at timestamptz;

-- Support tickets from businesses to the platform team (admin panel → Soporte).
CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 3 AND 160),
    category text NOT NULL DEFAULT 'other' CHECK (category IN ('technical', 'billing', 'whatsapp', 'ai', 'account', 'other')),
    priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_customer', 'closed')),
    last_message_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_tickets_ws ON public.support_tickets(workspace_id, last_message_at DESC);
CREATE INDEX idx_support_tickets_status ON public.support_tickets(status, last_message_at DESC);

CREATE TABLE public.support_ticket_messages (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    author_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    -- customer = someone of the business; support = platform admin
    author_role text NOT NULL CHECK (author_role IN ('customer', 'support')),
    body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 10000),
    -- [{ path, name, type }] in the attachments bucket (<workspace_id>/support/…)
    attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_ticket_messages_ticket ON public.support_ticket_messages(ticket_id, created_at);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
