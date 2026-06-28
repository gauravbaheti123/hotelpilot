
-- =====================================================================
-- 1) Tighten SELECT on public.properties
--    Only owners/managers/receptionists (or superadmin) may read hotel rows.
--    Kitchen / housekeeping staff no longer hit the properties table directly.
-- =====================================================================
DROP POLICY IF EXISTS linked_properties_select ON public.properties;
CREATE POLICY linked_properties_select ON public.properties
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin(auth.uid())
    OR public.can_front_desk(auth.uid(), id)
  );

-- =====================================================================
-- 2) Close owner-role self-promotion path on public.user_roles.
--    The broad permissive ALL policy let owners INSERT/UPDATE rows with
--    role='owner'. Tighten the WITH CHECK so only superadmins can mint
--    or change a row to 'owner' or 'superadmin'.
-- =====================================================================
DROP POLICY IF EXISTS user_roles_manage_owner_super ON public.user_roles;
CREATE POLICY user_roles_manage_owner_super ON public.user_roles
  FOR ALL TO authenticated
  USING (
    public.is_superadmin(auth.uid())
    OR (public.is_owner_or_super(auth.uid())
        AND ((property_id IS NULL) OR public.user_has_property(auth.uid(), property_id)))
  )
  WITH CHECK (
    public.is_superadmin(auth.uid())
    OR (public.is_owner_or_super(auth.uid())
        AND ((property_id IS NULL) OR public.user_has_property(auth.uid(), property_id))
        AND role <> ALL (ARRAY['owner'::app_role, 'superadmin'::app_role]))
  );

-- Add a RESTRICTIVE policy so no permissive policy can ever allow a write
-- that mints/changes a row to role='owner' or 'superadmin' unless caller is superadmin.
DROP POLICY IF EXISTS user_roles_block_privileged_writes ON public.user_roles;
CREATE POLICY user_roles_block_privileged_writes ON public.user_roles
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (
    public.is_superadmin(auth.uid())
    OR role <> ALL (ARRAY['owner'::app_role, 'superadmin'::app_role])
  );
