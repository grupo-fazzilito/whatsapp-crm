-- ============================================================
-- 023_inbox_attachments.sql
--
-- Private `attachments` bucket for files agents send from the inbox.
-- Path convention: attachments/{workspace_id}/{conversation_id}/{file}
-- Members of the workspace (first path segment) can read and write;
-- nothing is public. Providers receive short-lived signed URLs.
--
-- Idempotent — safe to re-run.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attachments',
  'attachments',
  FALSE,
  16777216, -- 16 MB
  ARRAY['image/*', 'video/*', 'audio/*', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- True when the caller is an active member of the workspace named by the
-- object's first path segment. Compares as text so a malformed folder
-- name simply fails the check instead of raising a cast error.
CREATE OR REPLACE FUNCTION public.can_access_ws_object(object_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id::text = (storage.foldername(object_name))[1]
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  )
$$;

GRANT EXECUTE ON FUNCTION public.can_access_ws_object(TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS "Workspace members read attachments" ON storage.objects;
CREATE POLICY "Workspace members read attachments"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'attachments' AND public.can_access_ws_object(name));

DROP POLICY IF EXISTS "Workspace members upload attachments" ON storage.objects;
CREATE POLICY "Workspace members upload attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'attachments' AND public.can_access_ws_object(name));

DROP POLICY IF EXISTS "Workspace members update attachments" ON storage.objects;
CREATE POLICY "Workspace members update attachments"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'attachments' AND public.can_access_ws_object(name))
  WITH CHECK (bucket_id = 'attachments' AND public.can_access_ws_object(name));

DROP POLICY IF EXISTS "Workspace members delete attachments" ON storage.objects;
CREATE POLICY "Workspace members delete attachments"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'attachments' AND public.can_access_ws_object(name));
