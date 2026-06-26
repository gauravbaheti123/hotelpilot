
-- Allow owners/managers to view profiles of users sharing one of their properties
CREATE POLICY "view co-property profiles" ON public.profiles
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = profiles.id
      AND ur.property_id IS NOT NULL
      AND public.is_owner_or_super(auth.uid())
      AND public.user_has_property(auth.uid(), ur.property_id)
  )
);

-- Allow owners/managers to view user_roles for users in their property
CREATE POLICY "view co-property user_roles" ON public.user_roles
FOR SELECT TO authenticated
USING (
  public.is_owner_or_super(auth.uid())
  AND (property_id IS NULL OR public.user_has_property(auth.uid(), property_id))
);

-- Replace blanket block on UPDATE so owners can change role_id (template) for staff in their property
DROP POLICY IF EXISTS "block non-superadmin role updates" ON public.user_roles;
CREATE POLICY "user_roles update by owner/super" ON public.user_roles
FOR UPDATE TO authenticated
USING (
  is_superadmin(auth.uid())
  OR (
    is_owner_or_super(auth.uid())
    AND property_id IS NOT NULL
    AND user_has_property(auth.uid(), property_id)
    AND role NOT IN ('owner'::app_role, 'superadmin'::app_role)
  )
)
WITH CHECK (
  is_superadmin(auth.uid())
  OR (
    is_owner_or_super(auth.uid())
    AND property_id IS NOT NULL
    AND user_has_property(auth.uid(), property_id)
    AND role NOT IN ('owner'::app_role, 'superadmin'::app_role)
  )
);

-- Allow profiles update by owner/super for is_active toggle, on co-property profiles
DROP POLICY IF EXISTS "update own profile" ON public.profiles;
CREATE POLICY "update profile" ON public.profiles
FOR UPDATE TO authenticated
USING (
  auth.uid() = id
  OR is_superadmin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = profiles.id
      AND ur.property_id IS NOT NULL
      AND is_owner_or_super(auth.uid())
      AND user_has_property(auth.uid(), ur.property_id)
      AND ur.role NOT IN ('owner'::app_role, 'superadmin'::app_role)
  )
)
WITH CHECK (
  auth.uid() = id
  OR is_superadmin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = profiles.id
      AND ur.property_id IS NOT NULL
      AND is_owner_or_super(auth.uid())
      AND user_has_property(auth.uid(), ur.property_id)
      AND ur.role NOT IN ('owner'::app_role, 'superadmin'::app_role)
  )
);
