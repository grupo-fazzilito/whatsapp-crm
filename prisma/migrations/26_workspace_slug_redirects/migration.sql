-- Old addresses of a workspace (its store /tienda/<slug> and property pages
-- /p/<slug>/<id>) after the business changes its slug: they keep working and
-- redirect to the current one. A slug is either a workspace's current slug or
-- a redirect, never both (checked by the app when the slug changes).
CREATE TABLE public.workspace_slug_redirects (
  slug text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX idx_workspace_slug_redirects_ws ON public.workspace_slug_redirects (workspace_id);
