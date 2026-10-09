-- ============================================================
-- 043 — Close SECURITY DEFINER functions to API clients
--
-- These run with the owner's rights and do not check workspace
-- membership, but they were executable by `anon`/`authenticated`
-- through PostgREST (/rest/v1/rpc/...): e.g. confirm_order/cancel_order
-- on any workspace's order. The app only calls them from the server
-- (service role) or from SECURITY DEFINER triggers, which run as owner.
-- RLS helpers (is_ws_member, can_access_ws_object, ws_access) and
-- set_my_availability (checks auth.uid()) stay callable.
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.confirm_order(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_order(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.next_workspace_counter(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_broadcast_counts(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._bcast_bump(UUID, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.default_ws_for_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_order(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_order(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.next_workspace_counter(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_broadcast_counts(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public._bcast_bump(UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.default_ws_for_user(UUID) TO service_role;
