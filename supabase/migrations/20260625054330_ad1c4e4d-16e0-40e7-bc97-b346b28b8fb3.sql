
-- Helper macro pattern: replace "tenant access" with a policy that requires
-- the matching can_* helper in addition to user_has_property.

-- FRONT DESK
DROP POLICY IF EXISTS "tenant access" ON public.bookings;
CREATE POLICY "front desk manage bookings" ON public.bookings
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.booking_rooms;
CREATE POLICY "front desk manage booking_rooms" ON public.booking_rooms
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.room_shifts;
CREATE POLICY "front desk manage room_shifts" ON public.room_shifts
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.communications;
CREATE POLICY "front desk manage communications" ON public.communications
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.guest_feedback;
CREATE POLICY "front desk manage guest_feedback" ON public.guest_feedback
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.banquet_bookings;
CREATE POLICY "front desk manage banquet_bookings" ON public.banquet_bookings
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_front_desk(auth.uid()));

DROP POLICY IF EXISTS "tenant access via banquet" ON public.banquet_bulk_rooms;
CREATE POLICY "front desk manage banquet_bulk_rooms" ON public.banquet_bulk_rooms
  FOR ALL TO authenticated
  USING (
    public.can_front_desk(auth.uid())
    AND EXISTS (SELECT 1 FROM public.banquet_bookings b WHERE b.id = banquet_bulk_rooms.banquet_id AND public.user_has_property(auth.uid(), b.property_id))
  )
  WITH CHECK (
    public.can_front_desk(auth.uid())
    AND EXISTS (SELECT 1 FROM public.banquet_bookings b WHERE b.id = banquet_bulk_rooms.banquet_id AND public.user_has_property(auth.uid(), b.property_id))
  );

-- HOUSEKEEPING
DROP POLICY IF EXISTS "tenant access" ON public.housekeeping_tasks;
CREATE POLICY "housekeeping manage tasks" ON public.housekeeping_tasks
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_housekeeping(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_housekeeping(auth.uid()));

-- FOOD / KOT
DROP POLICY IF EXISTS "tenant access" ON public.kot_orders;
CREATE POLICY "food manage kot_orders" ON public.kot_orders
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_food(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_food(auth.uid()));

DROP POLICY IF EXISTS "tenant access via kot_orders" ON public.kot_items;
CREATE POLICY "food manage kot_items" ON public.kot_items
  FOR ALL TO authenticated
  USING (
    public.can_food(auth.uid())
    AND EXISTS (SELECT 1 FROM public.kot_orders k WHERE k.id = kot_items.kot_id AND public.user_has_property(auth.uid(), k.property_id))
  )
  WITH CHECK (
    public.can_food(auth.uid())
    AND EXISTS (SELECT 1 FROM public.kot_orders k WHERE k.id = kot_items.kot_id AND public.user_has_property(auth.uid(), k.property_id))
  );

DROP POLICY IF EXISTS "tenant access" ON public.kot_audit_log;
CREATE POLICY "food manage kot_audit_log" ON public.kot_audit_log
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_food(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_food(auth.uid()));

-- BILLING / FINANCE
DROP POLICY IF EXISTS "tenant access" ON public.restaurant_credits;
CREATE POLICY "billing manage restaurant_credits" ON public.restaurant_credits
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_billing(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_billing(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.restaurant_settlements;
CREATE POLICY "billing manage restaurant_settlements" ON public.restaurant_settlements
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_billing(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_billing(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.day_closures;
CREATE POLICY "billing manage day_closures" ON public.day_closures
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_billing(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_billing(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.expenses;
CREATE POLICY "billing manage expenses" ON public.expenses
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_billing(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_billing(auth.uid()));

-- MASTERS / CONFIG / HR
DROP POLICY IF EXISTS "tenant access" ON public.attendance;
CREATE POLICY "managers manage attendance" ON public.attendance
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.vendors;
CREATE POLICY "managers manage vendors" ON public.vendors
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.ota_channels;
CREATE POLICY "managers manage ota_channels" ON public.ota_channels
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.ota_channel_mappings;
CREATE POLICY "managers manage ota_channel_mappings" ON public.ota_channel_mappings
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.ota_sync_logs;
CREATE POLICY "managers manage ota_sync_logs" ON public.ota_sync_logs
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.stock_movements;
CREATE POLICY "managers manage stock_movements" ON public.stock_movements
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.rate_seasons;
CREATE POLICY "managers manage rate_seasons" ON public.rate_seasons
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.tariff_plans;
CREATE POLICY "managers manage tariff_plans" ON public.tariff_plans
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.room_categories;
CREATE POLICY "managers manage room_categories" ON public.room_categories
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.rooms;
CREATE POLICY "managers manage rooms" ON public.rooms
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.halls;
CREATE POLICY "managers manage halls" ON public.halls
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.expense_categories;
CREATE POLICY "managers manage expense_categories" ON public.expense_categories
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.printers;
CREATE POLICY "managers manage printers" ON public.printers
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.inventory_items;
CREATE POLICY "managers manage inventory_items" ON public.inventory_items
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.menu_items;
CREATE POLICY "managers manage menu_items" ON public.menu_items
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.menu_categories;
CREATE POLICY "managers manage menu_categories" ON public.menu_categories
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.sundry_items;
CREATE POLICY "managers manage sundry_items" ON public.sundry_items
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));

DROP POLICY IF EXISTS "tenant access" ON public.message_templates;
CREATE POLICY "managers manage message_templates" ON public.message_templates
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.can_manage_masters(auth.uid()));
