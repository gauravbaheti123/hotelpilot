
-- printers_view: require explicit property match (or superadmin)
DROP POLICY IF EXISTS printers_view ON public.printers;
CREATE POLICY printers_view ON public.printers
  FOR SELECT
  USING (
    is_active = true
    AND (
      public.is_superadmin(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.property_id IS NOT NULL
          AND ur.property_id = printers.property_id
      )
    )
  );

-- roles_manage_admins: scope owner management to own properties
DROP POLICY IF EXISTS roles_manage_admins ON public.roles;
CREATE POLICY roles_manage_admins ON public.roles
  FOR ALL
  USING (
    public.is_superadmin(auth.uid())
    OR (
      public.is_owner_or_super(auth.uid())
      AND name !~* '^(owner|superadmin)$'
      AND property_id IS NOT NULL
      AND public.user_has_property(auth.uid(), property_id)
    )
  )
  WITH CHECK (
    public.is_superadmin(auth.uid())
    OR (
      public.is_owner_or_super(auth.uid())
      AND name !~* '^(owner|superadmin)$'
      AND property_id IS NOT NULL
      AND public.user_has_property(auth.uid(), property_id)
    )
  );

-- role_permissions_manage_admins: scope by parent role's property
DROP POLICY IF EXISTS role_permissions_manage_admins ON public.role_permissions;
CREATE POLICY role_permissions_manage_admins ON public.role_permissions
  FOR ALL
  USING (
    public.is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
        AND public.is_owner_or_super(auth.uid())
        AND r.name !~* '^(owner|superadmin)$'
        AND r.property_id IS NOT NULL
        AND public.user_has_property(auth.uid(), r.property_id)
    )
  )
  WITH CHECK (
    public.is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
        AND public.is_owner_or_super(auth.uid())
        AND r.name !~* '^(owner|superadmin)$'
        AND r.property_id IS NOT NULL
        AND public.user_has_property(auth.uid(), r.property_id)
    )
  );
