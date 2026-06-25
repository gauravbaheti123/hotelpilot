-- Tighten booking_guests RLS to require front-desk role
DROP POLICY IF EXISTS "tenant access" ON public.booking_guests;
CREATE POLICY "tenant access" ON public.booking_guests
  FOR ALL
  USING (is_superadmin(auth.uid()) OR (user_has_property(auth.uid(), property_id) AND can_front_desk(auth.uid())))
  WITH CHECK (is_superadmin(auth.uid()) OR (user_has_property(auth.uid(), property_id) AND can_front_desk(auth.uid())));

-- Tighten roles management to property scope
DROP POLICY IF EXISTS roles_manage_admins ON public.roles;
CREATE POLICY roles_manage_admins ON public.roles
  FOR ALL
  USING (
    is_superadmin(auth.uid())
    OR (property_id IS NOT NULL AND can_manage_masters(auth.uid()) AND user_has_property(auth.uid(), property_id))
  )
  WITH CHECK (
    is_superadmin(auth.uid())
    OR (property_id IS NOT NULL AND can_manage_masters(auth.uid()) AND user_has_property(auth.uid(), property_id))
  );

-- Tighten role_permissions management to property scope of parent role
DROP POLICY IF EXISTS role_permissions_manage_admins ON public.role_permissions;
CREATE POLICY role_permissions_manage_admins ON public.role_permissions
  FOR ALL
  USING (
    is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
        AND r.property_id IS NOT NULL
        AND can_manage_masters(auth.uid())
        AND user_has_property(auth.uid(), r.property_id)
    )
  )
  WITH CHECK (
    is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.roles r
      WHERE r.id = role_permissions.role_id
        AND r.property_id IS NOT NULL
        AND can_manage_masters(auth.uid())
        AND user_has_property(auth.uid(), r.property_id)
    )
  );