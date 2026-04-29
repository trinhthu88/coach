-- handle_new_user is only invoked by trigger; revoke from clients
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- set_updated_at is only invoked by triggers
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- has_role / get_primary_role: keep for authenticated users (used in app code), but block anon
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_primary_role(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_primary_role(UUID) TO authenticated;