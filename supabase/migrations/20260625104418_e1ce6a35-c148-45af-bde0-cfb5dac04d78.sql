
DROP POLICY IF EXISTS "tenant access" ON public.booking_guests;
CREATE POLICY "tenant access" ON public.booking_guests
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_superadmin(auth.uid()) OR (user_has_property(auth.uid(), property_id) AND can_front_desk(auth.uid())))
  WITH CHECK (is_superadmin(auth.uid()) OR (user_has_property(auth.uid(), property_id) AND can_front_desk(auth.uid())));

DROP POLICY IF EXISTS roles_manage_admins ON public.roles;
CREATE POLICY roles_manage_admins ON public.roles
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_superadmin(auth.uid()) OR (property_id IS NOT NULL AND can_manage_masters(auth.uid()) AND user_has_property(auth.uid(), property_id)))
  WITH CHECK (is_superadmin(auth.uid()) OR (property_id IS NOT NULL AND can_manage_masters(auth.uid()) AND user_has_property(auth.uid(), property_id)));

DROP POLICY IF EXISTS role_permissions_manage_admins ON public.role_permissions;
CREATE POLICY role_permissions_manage_admins ON public.role_permissions
  AS PERMISSIVE FOR ALL TO authenticated
  USING (is_superadmin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.id = role_permissions.role_id
      AND r.property_id IS NOT NULL
      AND can_manage_masters(auth.uid())
      AND user_has_property(auth.uid(), r.property_id)
  ))
  WITH CHECK (is_superadmin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.id = role_permissions.role_id
      AND r.property_id IS NOT NULL
      AND can_manage_masters(auth.uid())
      AND user_has_property(auth.uid(), r.property_id)
  ));
