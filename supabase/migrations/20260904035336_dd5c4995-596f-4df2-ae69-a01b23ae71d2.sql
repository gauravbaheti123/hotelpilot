GRANT EXECUTE ON FUNCTION public.is_superadmin(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.is_owner_or_super(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO anon;