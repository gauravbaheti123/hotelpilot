
-- 1) Revoke EXECUTE on user_has_permission from anon/PUBLIC (was granted to PUBLIC)
REVOKE EXECUTE ON FUNCTION public.user_has_permission(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_has_permission(uuid, uuid, text, text) FROM anon;

-- 2) staff & payroll_runs → require can_manage_masters (owner/manager/superadmin)
DROP POLICY IF EXISTS "tenant access" ON public.staff;
CREATE POLICY "managers manage staff" ON public.staff
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.payroll_runs;
CREATE POLICY "managers manage payroll" ON public.payroll_runs
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

-- 3) Billing/finance tables → require can_billing
DROP POLICY IF EXISTS "tenant access" ON public.payments;
CREATE POLICY "billing manage payments" ON public.payments
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_billing(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_billing(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.folios;
CREATE POLICY "billing manage folios" ON public.folios
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_billing(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_billing(auth.uid()));

DROP POLICY IF EXISTS "tenant access via folios" ON public.folio_charges;
CREATE POLICY "billing manage folio_charges" ON public.folio_charges
  FOR ALL TO authenticated
  USING (
    public.can_billing(auth.uid())
    AND EXISTS (SELECT 1 FROM public.folios f WHERE f.id = folio_charges.folio_id AND public.user_has_property(auth.uid(), f.property_id))
  )
  WITH CHECK (
    public.can_billing(auth.uid())
    AND EXISTS (SELECT 1 FROM public.folios f WHERE f.id = folio_charges.folio_id AND public.user_has_property(auth.uid(), f.property_id))
  );

-- 4) Guest PII & comms → require front desk role
DROP POLICY IF EXISTS "tenant access" ON public.guests;
CREATE POLICY "front desk manage guests" ON public.guests
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.whatsapp_messages;
CREATE POLICY "front desk manage whatsapp" ON public.whatsapp_messages
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.checkout_overrides;
CREATE POLICY "billing manage checkout_overrides" ON public.checkout_overrides
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_billing(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_billing(auth.uid()));

-- 5) Wipe logs → owner/superadmin only
DROP POLICY IF EXISTS "tenant access" ON public.wipe_logs;
CREATE POLICY "owners manage wipe_logs" ON public.wipe_logs
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.is_owner_or_super(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.is_owner_or_super(auth.uid()));

DROP POLICY IF EXISTS "tenant access via wipe_logs" ON public.wiped_data_archive;
CREATE POLICY "owners manage wiped_data_archive" ON public.wiped_data_archive
  FOR ALL TO authenticated
  USING (
    public.is_owner_or_super(auth.uid())
    AND EXISTS (SELECT 1 FROM public.wipe_logs w WHERE w.id = wiped_data_archive.wipe_log_id AND public.user_has_property(auth.uid(), w.property_id))
  )
  WITH CHECK (
    public.is_owner_or_super(auth.uid())
    AND EXISTS (SELECT 1 FROM public.wipe_logs w WHERE w.id = wiped_data_archive.wipe_log_id AND public.user_has_property(auth.uid(), w.property_id))
  );

-- 6) user_roles: add explicit RESTRICTIVE policy blocking non-superadmin writes
CREATE POLICY "block non-superadmin role writes" ON public.user_roles
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));

-- Re-add SELECT permissive policy so users can still view own roles (restrictive AND-applies)
-- The existing 'view own roles' permissive SELECT plus new restrictive would block own-row reads.
-- So scope restrictive to writes only:
DROP POLICY "block non-superadmin role writes" ON public.user_roles;
CREATE POLICY "block non-superadmin role inserts" ON public.user_roles
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.is_superadmin(auth.uid()));
CREATE POLICY "block non-superadmin role updates" ON public.user_roles
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));
CREATE POLICY "block non-superadmin role deletes" ON public.user_roles
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.is_superadmin(auth.uid()));
