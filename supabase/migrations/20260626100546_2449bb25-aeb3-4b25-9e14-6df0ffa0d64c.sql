-- Allow owners and managers of a property to UPDATE that property row.
-- Previously only superadmins could update properties, so the Hotel Settings
-- "Save All Settings" silently failed for owner/manager accounts and values
-- (including invoice_primary_color) appeared to "revert" on reload.

DROP POLICY IF EXISTS "owner_manager_update_property" ON public.properties;

CREATE POLICY "owner_manager_update_property"
ON public.properties
FOR UPDATE
TO authenticated
USING (
  public.is_superadmin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.property_id = properties.id
      AND ur.role IN ('owner'::app_role, 'manager'::app_role)
  )
)
WITH CHECK (
  public.is_superadmin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.property_id = properties.id
      AND ur.role IN ('owner'::app_role, 'manager'::app_role)
  )
);