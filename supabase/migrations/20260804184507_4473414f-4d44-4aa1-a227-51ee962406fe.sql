-- Batch 4 correction: restore superadmin / global-owner clauses in the canonical form
-- event_room_blocks
DROP POLICY IF EXISTS event_room_blocks_view ON public.event_room_blocks;
CREATE POLICY event_room_blocks_view ON public.event_room_blocks FOR SELECT
  USING ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'view')));
DROP POLICY IF EXISTS event_room_blocks_create ON public.event_room_blocks;
CREATE POLICY event_room_blocks_create ON public.event_room_blocks FOR INSERT
  WITH CHECK ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'create')));
DROP POLICY IF EXISTS event_room_blocks_edit ON public.event_room_blocks;
CREATE POLICY event_room_blocks_edit ON public.event_room_blocks FOR UPDATE
  USING ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'edit')))
  WITH CHECK ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'edit')));
DROP POLICY IF EXISTS event_room_blocks_delete ON public.event_room_blocks;
CREATE POLICY event_room_blocks_delete ON public.event_room_blocks FOR DELETE
  USING ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'delete')));

-- banquet_extra_charges
DROP POLICY IF EXISTS banquet_extra_charges_view ON public.banquet_extra_charges;
CREATE POLICY banquet_extra_charges_view ON public.banquet_extra_charges FOR SELECT
  USING ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'view')));
DROP POLICY IF EXISTS banquet_extra_charges_create ON public.banquet_extra_charges;
CREATE POLICY banquet_extra_charges_create ON public.banquet_extra_charges FOR INSERT
  WITH CHECK ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'create')));
DROP POLICY IF EXISTS banquet_extra_charges_edit ON public.banquet_extra_charges;
CREATE POLICY banquet_extra_charges_edit ON public.banquet_extra_charges FOR UPDATE
  USING ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'edit')))
  WITH CHECK ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'edit')));
DROP POLICY IF EXISTS banquet_extra_charges_delete ON public.banquet_extra_charges;
CREATE POLICY banquet_extra_charges_delete ON public.banquet_extra_charges FOR DELETE
  USING ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'delete')));

-- banquet_master_bills
DROP POLICY IF EXISTS "banquet_master_bills view" ON public.banquet_master_bills;
CREATE POLICY "banquet_master_bills view" ON public.banquet_master_bills FOR SELECT
  USING ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'view')));
DROP POLICY IF EXISTS "banquet_master_bills insert" ON public.banquet_master_bills;
CREATE POLICY "banquet_master_bills insert" ON public.banquet_master_bills FOR INSERT
  WITH CHECK ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'create')));
DROP POLICY IF EXISTS "banquet_master_bills update" ON public.banquet_master_bills;
CREATE POLICY "banquet_master_bills update" ON public.banquet_master_bills FOR UPDATE
  USING ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'edit')))
  WITH CHECK ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'edit')));
DROP POLICY IF EXISTS "banquet_master_bills delete" ON public.banquet_master_bills;
CREATE POLICY "banquet_master_bills delete" ON public.banquet_master_bills FOR DELETE
  USING ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'delete')));

-- banquet_master_bill_items (parent-scoped)
DROP POLICY IF EXISTS "banquet_master_bill_items view" ON public.banquet_master_bill_items;
CREATE POLICY "banquet_master_bill_items view" ON public.banquet_master_bill_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.banquet_master_bills mb
     WHERE mb.id = banquet_master_bill_items.master_bill_id
       AND ((SELECT public.is_superadmin(auth.uid())) OR (mb.property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR mb.property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'view')))
  ));
DROP POLICY IF EXISTS "banquet_master_bill_items write" ON public.banquet_master_bill_items;
CREATE POLICY "banquet_master_bill_items write" ON public.banquet_master_bill_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.banquet_master_bills mb
     WHERE mb.id = banquet_master_bill_items.master_bill_id
       AND ((SELECT public.is_superadmin(auth.uid())) OR (mb.property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR mb.property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'edit')))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.banquet_master_bills mb
     WHERE mb.id = banquet_master_bill_items.master_bill_id
       AND ((SELECT public.is_superadmin(auth.uid())) OR (mb.property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR mb.property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'banquet', 'edit')))
  ));

-- halls (master_data)
DROP POLICY IF EXISTS halls_create ON public.halls;
CREATE POLICY halls_create ON public.halls FOR INSERT
  WITH CHECK ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'master_data', 'create')));
DROP POLICY IF EXISTS halls_edit ON public.halls;
CREATE POLICY halls_edit ON public.halls FOR UPDATE
  USING ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'master_data', 'edit')))
  WITH CHECK ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'master_data', 'edit')));
DROP POLICY IF EXISTS halls_delete ON public.halls;
CREATE POLICY halls_delete ON public.halls FOR DELETE
  USING ((SELECT public.is_superadmin(auth.uid())) OR (property_id IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'master_data', 'delete')));