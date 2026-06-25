
-- 1. Remove overly permissive MIS policies (leave the owner-only ones)
DROP POLICY IF EXISTS property_mis_accounts ON public.mis_accounts;
DROP POLICY IF EXISTS property_mis_ledger ON public.mis_ledger;

-- 2. Tighten policies that relied on user_has_property alone (add role check)

-- activity_log
DROP POLICY IF EXISTS "activity_log tenant select" ON public.activity_log;
DROP POLICY IF EXISTS "activity_log tenant insert" ON public.activity_log;
CREATE POLICY "activity_log tenant select" ON public.activity_log
  FOR SELECT TO authenticated
  USING (user_has_property(auth.uid(), property_id) AND can_front_desk(auth.uid()));
CREATE POLICY "activity_log tenant insert" ON public.activity_log
  FOR INSERT TO authenticated
  WITH CHECK (user_has_property(auth.uid(), property_id) AND user_id = auth.uid() AND can_front_desk(auth.uid()));

-- bill_sequences
DROP POLICY IF EXISTS "tenant read bill_sequences" ON public.bill_sequences;
CREATE POLICY "tenant read bill_sequences" ON public.bill_sequences
  FOR SELECT TO authenticated
  USING (user_has_property(auth.uid(), property_id) AND can_billing(auth.uid()));

-- event_room_blocks
DROP POLICY IF EXISTS "tenant access event_room_blocks" ON public.event_room_blocks;
CREATE POLICY "tenant access event_room_blocks" ON public.event_room_blocks
  FOR ALL TO authenticated
  USING (user_has_property(auth.uid(), property_id) AND can_front_desk(auth.uid()))
  WITH CHECK (user_has_property(auth.uid(), property_id) AND can_front_desk(auth.uid()));

-- guest_documents
DROP POLICY IF EXISTS "tenant access" ON public.guest_documents;
CREATE POLICY "tenant access" ON public.guest_documents
  FOR ALL TO authenticated
  USING (user_has_property(auth.uid(), property_id) AND can_front_desk(auth.uid()))
  WITH CHECK (user_has_property(auth.uid(), property_id) AND can_front_desk(auth.uid()));

-- reminders
DROP POLICY IF EXISTS reminders_tenant_access ON public.reminders;
CREATE POLICY reminders_tenant_access ON public.reminders
  FOR ALL TO authenticated
  USING (user_has_property(auth.uid(), property_id) AND (can_front_desk(auth.uid()) OR can_housekeeping(auth.uid()) OR can_food(auth.uid())))
  WITH CHECK (user_has_property(auth.uid(), property_id) AND (can_front_desk(auth.uid()) OR can_housekeeping(auth.uid()) OR can_food(auth.uid())));

-- restaurant_direct_charges
DROP POLICY IF EXISTS "tenant access" ON public.restaurant_direct_charges;
CREATE POLICY "tenant access" ON public.restaurant_direct_charges
  FOR ALL TO authenticated
  USING (user_has_property(auth.uid(), property_id) AND (can_billing(auth.uid()) OR can_food(auth.uid())))
  WITH CHECK (user_has_property(auth.uid(), property_id) AND (can_billing(auth.uid()) OR can_food(auth.uid())));

-- restaurant_payables
DROP POLICY IF EXISTS "tenant access" ON public.restaurant_payables;
CREATE POLICY "tenant access" ON public.restaurant_payables
  FOR ALL TO authenticated
  USING (user_has_property(auth.uid(), property_id) AND can_billing(auth.uid()))
  WITH CHECK (user_has_property(auth.uid(), property_id) AND can_billing(auth.uid()));

-- 3. Revoke public EXECUTE on SECURITY DEFINER trigger function
REVOKE EXECUTE ON FUNCTION public.create_bill_sequences_for_property() FROM PUBLIC, anon, authenticated;
