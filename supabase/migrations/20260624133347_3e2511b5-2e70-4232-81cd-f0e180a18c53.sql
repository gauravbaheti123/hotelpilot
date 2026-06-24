
-- Ensure authenticated can reach properties via Data API
GRANT SELECT, INSERT, UPDATE, DELETE ON public.properties TO authenticated;
GRANT ALL ON public.properties TO service_role;

-- Replace SELECT policy with explicit, self-contained checks
DROP POLICY IF EXISTS "view linked properties" ON public.properties;
DROP POLICY IF EXISTS "superadmin_all_properties" ON public.properties;
DROP POLICY IF EXISTS "linked_properties_select" ON public.properties;

CREATE POLICY "superadmin_all_properties"
ON public.properties FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'superadmin'
  )
);

CREATE POLICY "linked_properties_select"
ON public.properties FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND property_id = properties.id
  )
);
