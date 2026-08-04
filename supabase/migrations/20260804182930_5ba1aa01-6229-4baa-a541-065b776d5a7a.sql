-- Helper 1: owner not scoped to a specific property (mirrors the
-- "(property_id = _property_id OR property_id IS NULL)" owner branch of
-- public.has_permission for the IS NULL case).
CREATE OR REPLACE FUNCTION public.is_global_owner(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = _user_id
       AND role = 'owner'::app_role
       AND property_id IS NULL
  );
$function$;

-- Helper 2: the set of property ids the user may act on for (module, action).
-- Term-for-term equivalent of the non-superadmin, non-global-owner branches
-- of public.has_permission, but callable once per query instead of per row.
CREATE OR REPLACE FUNCTION public.permitted_property_ids(_user_id uuid, _module text, _action text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT property_id
    FROM public.user_roles
   WHERE user_id = _user_id
     AND role = 'owner'::app_role
     AND property_id IS NOT NULL
  UNION
  SELECT ur.property_id
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
   WHERE ur.user_id = _user_id
     AND ur.property_id IS NOT NULL
     AND p.module = _module
     AND p.action = _action
     AND rp.allowed = true;
$function$;

REVOKE ALL ON FUNCTION public.is_global_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.permitted_property_ids(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_global_owner(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.permitted_property_ids(uuid, text, text) TO authenticated, service_role;