CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _property_id uuid, _module text, _action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_superadmin(_user_id)
      OR public.has_role(_user_id, 'owner'::app_role)
      OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = _user_id
      AND ur.property_id IS NOT NULL
      AND ur.property_id = _property_id
      AND p.module = _module
      AND p.action = _action
      AND rp.allowed = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.user_has_permission(_user_id uuid, _property_id uuid, _module text, _action text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.is_superadmin(_user_id)
    OR public.has_role(_user_id, 'owner'::app_role)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = _user_id
        AND ur.property_id IS NOT NULL
        AND ur.property_id = _property_id
        AND p.module = _module
        AND p.action = _action
        AND rp.allowed = true
    );
$function$;