
REVOKE EXECUTE ON FUNCTION public.is_superadmin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_has_property(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_property_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_superadmin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_property(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_property_ids(uuid) TO authenticated, service_role;
