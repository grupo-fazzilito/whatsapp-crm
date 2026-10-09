-- Customizable dashboard: the widgets each user chose for each business, in order.
CREATE TABLE public.dashboard_layouts (
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- ["tokens", "new_leads", …] in display order
    widgets jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(widgets) = 'array'),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);
