
-- Hoistable helper: the set of property ids a user is attached to.
CREATE OR REPLACE FUNCTION public.my_property_ids(_uid uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT property_id
    FROM public.user_roles
   WHERE user_id = _uid AND property_id IS NOT NULL
$$;
GRANT EXECUTE ON FUNCTION public.my_property_ids(uuid) TO authenticated, service_role;

-- ---------- permissions ----------
DROP POLICY IF EXISTS "permissions read for property members" ON public.permissions;
CREATE POLICY "permissions read for property members" ON public.permissions
FOR SELECT TO authenticated
USING (
  (SELECT public.is_superadmin(auth.uid()))
  OR EXISTS (SELECT 1 FROM public.my_property_ids(auth.uid()))
);

DROP POLICY IF EXISTS "permissions_manage_superadmin" ON public.permissions;
CREATE POLICY "permissions_manage_superadmin" ON public.permissions
FOR ALL TO authenticated
USING ((SELECT public.is_superadmin(auth.uid())))
WITH CHECK ((SELECT public.is_superadmin(auth.uid())));

-- ---------- role_permissions ----------
DROP POLICY IF EXISTS "role_permissions_read_authenticated" ON public.role_permissions;
CREATE POLICY "role_permissions_read_authenticated" ON public.role_permissions
FOR SELECT TO authenticated
USING (
  (SELECT public.is_superadmin(auth.uid()))
  OR role_id IN (
    SELECT r.id FROM public.roles r
     WHERE r.property_id IS NULL
        OR r.property_id IN (SELECT public.my_property_ids(auth.uid()))
  )
);

DROP POLICY IF EXISTS "role_permissions_manage_admins" ON public.role_permissions;
CREATE POLICY "role_permissions_manage_admins" ON public.role_permissions
FOR ALL
USING (
  (SELECT public.is_superadmin(auth.uid()))
  OR ((SELECT public.is_owner_or_super(auth.uid())) AND role_id IN (
        SELECT r.id FROM public.roles r
         WHERE r.name !~* '^(owner|superadmin)$'
           AND r.property_id IS NOT NULL
           AND r.property_id IN (SELECT public.my_property_ids(auth.uid()))
     ))
)
WITH CHECK (
  (SELECT public.is_superadmin(auth.uid()))
  OR ((SELECT public.is_owner_or_super(auth.uid())) AND role_id IN (
        SELECT r.id FROM public.roles r
         WHERE r.name !~* '^(owner|superadmin)$'
           AND r.property_id IS NOT NULL
           AND r.property_id IN (SELECT public.my_property_ids(auth.uid()))
     ))
);

-- ---------- roles ----------
DROP POLICY IF EXISTS "roles_read_authenticated" ON public.roles;
CREATE POLICY "roles_read_authenticated" ON public.roles
FOR SELECT TO authenticated
USING (
  (SELECT public.is_superadmin(auth.uid()))
  OR (SELECT public.is_owner_or_super(auth.uid()))
  OR (property_id IS NOT NULL AND property_id IN (SELECT public.my_property_ids(auth.uid())))
);

DROP POLICY IF EXISTS "users can read their own assigned role" ON public.roles;
CREATE POLICY "users can read their own assigned role" ON public.roles
FOR SELECT
USING (
  id IN (SELECT ur.role_id FROM public.user_roles ur
          WHERE ur.user_id = auth.uid() AND ur.role_id IS NOT NULL)
);

DROP POLICY IF EXISTS "roles_manage_admins" ON public.roles;
CREATE POLICY "roles_manage_admins" ON public.roles
FOR ALL
USING (
  (SELECT public.is_superadmin(auth.uid()))
  OR ((SELECT public.is_owner_or_super(auth.uid()))
      AND name !~* '^(owner|superadmin)$'
      AND property_id IS NOT NULL
      AND property_id IN (SELECT public.my_property_ids(auth.uid())))
)
WITH CHECK (
  (SELECT public.is_superadmin(auth.uid()))
  OR ((SELECT public.is_owner_or_super(auth.uid()))
      AND name !~* '^(owner|superadmin)$'
      AND property_id IS NOT NULL
      AND property_id IN (SELECT public.my_property_ids(auth.uid())))
);

-- ---------- user_roles ----------
DROP POLICY IF EXISTS "view own roles" ON public.user_roles;
CREATE POLICY "view own roles" ON public.user_roles
FOR SELECT TO authenticated
USING (
  (auth.uid() = user_id) OR (SELECT public.has_role(auth.uid(), 'superadmin'::app_role))
);

DROP POLICY IF EXISTS "view co-property user_roles" ON public.user_roles;
CREATE POLICY "view co-property user_roles" ON public.user_roles
FOR SELECT TO authenticated
USING (
  (SELECT public.is_superadmin(auth.uid()))
  OR ((SELECT public.is_owner_or_super(auth.uid()))
      AND (property_id IS NULL OR property_id IN (SELECT public.my_property_ids(auth.uid()))))
);

DROP POLICY IF EXISTS "user_roles_manage_owner_super" ON public.user_roles;
CREATE POLICY "user_roles_manage_owner_super" ON public.user_roles
FOR ALL TO authenticated
USING (
  (SELECT public.is_superadmin(auth.uid()))
  OR ((SELECT public.is_owner_or_super(auth.uid()))
      AND (property_id IS NULL OR property_id IN (SELECT public.my_property_ids(auth.uid()))))
)
WITH CHECK (
  (SELECT public.is_superadmin(auth.uid()))
  OR ((SELECT public.is_owner_or_super(auth.uid()))
      AND (property_id IS NULL OR property_id IN (SELECT public.my_property_ids(auth.uid())))
      AND (role <> ALL (ARRAY['owner'::app_role, 'superadmin'::app_role])))
);

DROP POLICY IF EXISTS "user_roles update by owner/super" ON public.user_roles;
CREATE POLICY "user_roles update by owner/super" ON public.user_roles
FOR UPDATE TO authenticated
USING (
  (SELECT public.is_superadmin(auth.uid()))
  OR ((SELECT public.is_owner_or_super(auth.uid()))
      AND property_id IS NOT NULL
      AND property_id IN (SELECT public.my_property_ids(auth.uid()))
      AND (role <> ALL (ARRAY['owner'::app_role, 'superadmin'::app_role])))
)
WITH CHECK (
  (SELECT public.is_superadmin(auth.uid()))
  OR ((SELECT public.is_owner_or_super(auth.uid()))
      AND property_id IS NOT NULL
      AND property_id IN (SELECT public.my_property_ids(auth.uid()))
      AND (role <> ALL (ARRAY['owner'::app_role, 'superadmin'::app_role])))
);

DROP POLICY IF EXISTS "block non-superadmin role deletes" ON public.user_roles;
CREATE POLICY "block non-superadmin role deletes" ON public.user_roles
AS RESTRICTIVE FOR DELETE TO authenticated
USING ((SELECT public.is_superadmin(auth.uid())));

DROP POLICY IF EXISTS "block non-superadmin role inserts" ON public.user_roles;
CREATE POLICY "block non-superadmin role inserts" ON public.user_roles
AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK ((SELECT public.is_superadmin(auth.uid())));

DROP POLICY IF EXISTS "user_roles_block_privileged_writes" ON public.user_roles;
CREATE POLICY "user_roles_block_privileged_writes" ON public.user_roles
AS RESTRICTIVE FOR ALL TO authenticated
USING (true)
WITH CHECK (
  (SELECT public.is_superadmin(auth.uid()))
  OR (role <> ALL (ARRAY['owner'::app_role, 'superadmin'::app_role]))
);

-- Realtime: permission changes must reach open sessions instantly.
ALTER TABLE public.role_permissions REPLICA IDENTITY FULL;
ALTER TABLE public.user_roles REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.role_permissions;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
