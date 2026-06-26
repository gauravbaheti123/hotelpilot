-- 1. event_payments: replace permissive policies with property + role scope
DROP POLICY IF EXISTS "manage event_payments" ON public.event_payments;
DROP POLICY IF EXISTS "view event_payments" ON public.event_payments;

CREATE POLICY "view event_payments"
ON public.event_payments
FOR SELECT
TO authenticated
USING (
  public.user_has_property(auth.uid(), property_id)
  AND public.can_billing(auth.uid())
);

CREATE POLICY "manage event_payments"
ON public.event_payments
FOR ALL
TO authenticated
USING (
  public.user_has_property(auth.uid(), property_id)
  AND public.can_billing(auth.uid())
)
WITH CHECK (
  public.user_has_property(auth.uid(), property_id)
  AND public.can_billing(auth.uid())
);

-- 2. gst_slabs: scope SELECT to user's property
DROP POLICY IF EXISTS "view gst_slabs" ON public.gst_slabs;

CREATE POLICY "view gst_slabs"
ON public.gst_slabs
FOR SELECT
TO authenticated
USING (public.user_has_property(auth.uid(), property_id));

-- 3. properties: revoke column-level SELECT on secret columns from clients.
-- These are accessed only via SECURITY DEFINER functions
-- (get_property_secrets / save_property_secrets) which gate by role.
REVOKE SELECT (aisensy_api_key, wa_number, wifi_password)
  ON public.properties FROM authenticated;
REVOKE SELECT (aisensy_api_key, wa_number, wifi_password)
  ON public.properties FROM anon;