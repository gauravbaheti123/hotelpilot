CREATE OR REPLACE FUNCTION public.list_property_staff(_property_id uuid)
RETURNS TABLE(user_id uuid, display_name text, email text, role app_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ur.user_id,
         COALESCE(NULLIF(btrim(p.name), ''), p.email, left(ur.user_id::text, 8)) AS display_name,
         p.email,
         ur.role
  FROM public.user_roles ur
  LEFT JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.property_id = _property_id
    AND COALESCE(p.is_active, true) = true
    AND public.user_has_property(auth.uid(), _property_id)
$$;

REVOKE ALL ON FUNCTION public.list_property_staff(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.list_property_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_property_staff(uuid) TO service_role;