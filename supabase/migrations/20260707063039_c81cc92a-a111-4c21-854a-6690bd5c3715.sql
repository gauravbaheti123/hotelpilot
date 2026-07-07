
-- =========================================================================
-- STEP 1: Universal permission-check function
-- =========================================================================
CREATE OR REPLACE FUNCTION public.has_permission(
  _user_id uuid, _property_id uuid, _module text, _action text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_superadmin(_user_id) OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role_id = ur.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE ur.user_id = _user_id
      AND (ur.property_id = _property_id OR ur.property_id IS NULL)
      AND p.module = _module
      AND p.action = _action
      AND rp.allowed = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_permission(uuid, uuid, text, text) TO authenticated, anon, service_role;

-- =========================================================================
-- STEP 2: Owner backfill — safety net (Owner already has 110/110, this is a no-op)
-- =========================================================================
INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE lower(r.name) = 'owner'
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = true;

-- =========================================================================
-- STEP 4: Replace policies (Bucket B + approved Bucket C)
-- =========================================================================

-- ========== BOOKINGS module ==========
DROP POLICY IF EXISTS "front desk manage bookings" ON public.bookings;
CREATE POLICY "bookings_view" ON public.bookings FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'view'));
CREATE POLICY "bookings_create" ON public.bookings FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'bookings', 'create'));
CREATE POLICY "bookings_edit" ON public.bookings FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'bookings', 'edit'));
CREATE POLICY "bookings_delete" ON public.bookings FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'delete'));

DROP POLICY IF EXISTS "front desk manage booking_rooms" ON public.booking_rooms;
CREATE POLICY "booking_rooms_view" ON public.booking_rooms FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'view'));
CREATE POLICY "booking_rooms_create" ON public.booking_rooms FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'bookings', 'create'));
CREATE POLICY "booking_rooms_edit" ON public.booking_rooms FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'bookings', 'edit'));
CREATE POLICY "booking_rooms_delete" ON public.booking_rooms FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'delete'));

DROP POLICY IF EXISTS "tenant access" ON public.booking_guests;
CREATE POLICY "booking_guests_view" ON public.booking_guests FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'view'));
CREATE POLICY "booking_guests_create" ON public.booking_guests FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'bookings', 'create'));
CREATE POLICY "booking_guests_edit" ON public.booking_guests FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'bookings', 'edit'));
CREATE POLICY "booking_guests_delete" ON public.booking_guests FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'delete'));

DROP POLICY IF EXISTS "front desk manage room_shifts" ON public.room_shifts;
CREATE POLICY "room_shifts_view" ON public.room_shifts FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'view'));
CREATE POLICY "room_shifts_create" ON public.room_shifts FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'bookings', 'create'));
CREATE POLICY "room_shifts_edit" ON public.room_shifts FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'bookings', 'edit'));
CREATE POLICY "room_shifts_delete" ON public.room_shifts FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'delete'));

-- ========== GUEST_CRM module ==========
DROP POLICY IF EXISTS "front desk read guests" ON public.guests;
DROP POLICY IF EXISTS "front desk insert guests" ON public.guests;
DROP POLICY IF EXISTS "front desk update guests" ON public.guests;
DROP POLICY IF EXISTS "managers delete guests" ON public.guests;
CREATE POLICY "guests_view" ON public.guests FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'guest_crm', 'view'));
CREATE POLICY "guests_create" ON public.guests FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'guest_crm', 'create'));
CREATE POLICY "guests_edit" ON public.guests FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'guest_crm', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'guest_crm', 'edit'));
CREATE POLICY "guests_delete" ON public.guests FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'guest_crm', 'delete'));

DROP POLICY IF EXISTS "tenant access" ON public.guest_documents;
CREATE POLICY "guest_documents_view" ON public.guest_documents FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'guest_crm', 'view'));
CREATE POLICY "guest_documents_create" ON public.guest_documents FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'guest_crm', 'create'));
CREATE POLICY "guest_documents_edit" ON public.guest_documents FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'guest_crm', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'guest_crm', 'edit'));
CREATE POLICY "guest_documents_delete" ON public.guest_documents FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'guest_crm', 'delete'));

DROP POLICY IF EXISTS "front desk manage guest_feedback" ON public.guest_feedback;
CREATE POLICY "guest_feedback_view" ON public.guest_feedback FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'guest_crm', 'view'));
CREATE POLICY "guest_feedback_create" ON public.guest_feedback FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'guest_crm', 'create'));
CREATE POLICY "guest_feedback_edit" ON public.guest_feedback FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'guest_crm', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'guest_crm', 'edit'));
CREATE POLICY "guest_feedback_delete" ON public.guest_feedback FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'guest_crm', 'delete'));

DROP POLICY IF EXISTS "front desk manage communications" ON public.communications;
CREATE POLICY "communications_view" ON public.communications FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'guest_crm', 'view'));
CREATE POLICY "communications_create" ON public.communications FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'guest_crm', 'create'));
CREATE POLICY "communications_edit" ON public.communications FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'guest_crm', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'guest_crm', 'edit'));
CREATE POLICY "communications_delete" ON public.communications FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'guest_crm', 'delete'));

DROP POLICY IF EXISTS "front desk manage whatsapp" ON public.whatsapp_messages;
CREATE POLICY "whatsapp_messages_view" ON public.whatsapp_messages FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'guest_crm', 'view'));
CREATE POLICY "whatsapp_messages_create" ON public.whatsapp_messages FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'guest_crm', 'create'));
CREATE POLICY "whatsapp_messages_edit" ON public.whatsapp_messages FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'guest_crm', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'guest_crm', 'edit'));
CREATE POLICY "whatsapp_messages_delete" ON public.whatsapp_messages FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'guest_crm', 'delete'));

-- ========== BANQUET module ==========
DROP POLICY IF EXISTS "front desk manage banquet_bookings" ON public.banquet_bookings;
CREATE POLICY "banquet_bookings_view" ON public.banquet_bookings FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'banquet', 'view'));
CREATE POLICY "banquet_bookings_create" ON public.banquet_bookings FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'banquet', 'create'));
CREATE POLICY "banquet_bookings_edit" ON public.banquet_bookings FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'banquet', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'banquet', 'edit'));
CREATE POLICY "banquet_bookings_delete" ON public.banquet_bookings FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'banquet', 'delete'));

DROP POLICY IF EXISTS "front desk manage banquet_bulk_rooms" ON public.banquet_bulk_rooms;
CREATE POLICY "banquet_bulk_rooms_view" ON public.banquet_bulk_rooms FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.banquet_bookings b
    WHERE b.id = banquet_bulk_rooms.banquet_id
      AND public.has_permission(auth.uid(), b.property_id, 'banquet', 'view')));
CREATE POLICY "banquet_bulk_rooms_create" ON public.banquet_bulk_rooms FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.banquet_bookings b
    WHERE b.id = banquet_bulk_rooms.banquet_id
      AND public.has_permission(auth.uid(), b.property_id, 'banquet', 'create')));
CREATE POLICY "banquet_bulk_rooms_edit" ON public.banquet_bulk_rooms FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.banquet_bookings b
    WHERE b.id = banquet_bulk_rooms.banquet_id
      AND public.has_permission(auth.uid(), b.property_id, 'banquet', 'edit')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.banquet_bookings b
    WHERE b.id = banquet_bulk_rooms.banquet_id
      AND public.has_permission(auth.uid(), b.property_id, 'banquet', 'edit')));
CREATE POLICY "banquet_bulk_rooms_delete" ON public.banquet_bulk_rooms FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.banquet_bookings b
    WHERE b.id = banquet_bulk_rooms.banquet_id
      AND public.has_permission(auth.uid(), b.property_id, 'banquet', 'delete')));

DROP POLICY IF EXISTS "tenant access event_room_blocks" ON public.event_room_blocks;
CREATE POLICY "event_room_blocks_view" ON public.event_room_blocks FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'banquet', 'view'));
CREATE POLICY "event_room_blocks_create" ON public.event_room_blocks FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'banquet', 'create'));
CREATE POLICY "event_room_blocks_edit" ON public.event_room_blocks FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'banquet', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'banquet', 'edit'));
CREATE POLICY "event_room_blocks_delete" ON public.event_room_blocks FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'banquet', 'delete'));

DROP POLICY IF EXISTS "manage event_payments" ON public.event_payments;
DROP POLICY IF EXISTS "view event_payments" ON public.event_payments;
CREATE POLICY "event_payments_view" ON public.event_payments FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'banquet', 'view'));
CREATE POLICY "event_payments_create" ON public.event_payments FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'banquet', 'create'));
CREATE POLICY "event_payments_edit" ON public.event_payments FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'banquet', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'banquet', 'edit'));
CREATE POLICY "event_payments_delete" ON public.event_payments FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'banquet', 'delete'));

DROP POLICY IF EXISTS "banquet_extra_charges_write" ON public.banquet_extra_charges;
DROP POLICY IF EXISTS "banquet_extra_charges_select" ON public.banquet_extra_charges;
CREATE POLICY "banquet_extra_charges_view" ON public.banquet_extra_charges FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'banquet', 'view'));
CREATE POLICY "banquet_extra_charges_create" ON public.banquet_extra_charges FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'banquet', 'create'));
CREATE POLICY "banquet_extra_charges_edit" ON public.banquet_extra_charges FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'banquet', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'banquet', 'edit'));
CREATE POLICY "banquet_extra_charges_delete" ON public.banquet_extra_charges FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'banquet', 'delete'));

-- ========== INVOICES module (folios/payments/checkout) ==========
DROP POLICY IF EXISTS "billing manage folios" ON public.folios;
CREATE POLICY "folios_view" ON public.folios FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'invoices', 'view'));
CREATE POLICY "folios_create" ON public.folios FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'invoices', 'create'));
CREATE POLICY "folios_edit" ON public.folios FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'invoices', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'invoices', 'edit'));
CREATE POLICY "folios_delete" ON public.folios FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'invoices', 'delete'));

DROP POLICY IF EXISTS "billing manage folio_charges" ON public.folio_charges;
CREATE POLICY "folio_charges_view" ON public.folio_charges FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.folios f WHERE f.id = folio_charges.folio_id
    AND public.has_permission(auth.uid(), f.property_id, 'invoices', 'view')));
CREATE POLICY "folio_charges_create" ON public.folio_charges FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.folios f WHERE f.id = folio_charges.folio_id
    AND public.has_permission(auth.uid(), f.property_id, 'invoices', 'create')));
CREATE POLICY "folio_charges_edit" ON public.folio_charges FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.folios f WHERE f.id = folio_charges.folio_id
    AND public.has_permission(auth.uid(), f.property_id, 'invoices', 'edit')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.folios f WHERE f.id = folio_charges.folio_id
    AND public.has_permission(auth.uid(), f.property_id, 'invoices', 'edit')));
CREATE POLICY "folio_charges_delete" ON public.folio_charges FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.folios f WHERE f.id = folio_charges.folio_id
    AND public.has_permission(auth.uid(), f.property_id, 'invoices', 'delete')));

DROP POLICY IF EXISTS "billing manage payments" ON public.payments;
CREATE POLICY "payments_view" ON public.payments FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'invoices', 'view'));
CREATE POLICY "payments_create" ON public.payments FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'invoices', 'create'));
CREATE POLICY "payments_edit" ON public.payments FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'invoices', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'invoices', 'edit'));
CREATE POLICY "payments_delete" ON public.payments FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'invoices', 'delete'));

DROP POLICY IF EXISTS "billing manage checkout_overrides" ON public.checkout_overrides;
CREATE POLICY "checkout_overrides_view" ON public.checkout_overrides FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'invoices', 'view'));
CREATE POLICY "checkout_overrides_create" ON public.checkout_overrides FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'invoices', 'create'));
CREATE POLICY "checkout_overrides_edit" ON public.checkout_overrides FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'invoices', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'invoices', 'edit'));
CREATE POLICY "checkout_overrides_delete" ON public.checkout_overrides FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'invoices', 'delete'));

-- ========== DAY_CLOSE module ==========
DROP POLICY IF EXISTS "billing manage day_closures" ON public.day_closures;
CREATE POLICY "day_closures_view" ON public.day_closures FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'day_close', 'view'));
CREATE POLICY "day_closures_create" ON public.day_closures FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'day_close', 'create'));
CREATE POLICY "day_closures_edit" ON public.day_closures FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'day_close', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'day_close', 'edit'));
CREATE POLICY "day_closures_delete" ON public.day_closures FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'day_close', 'delete'));

-- ========== EXPENSES module ==========
DROP POLICY IF EXISTS "billing manage expenses" ON public.expenses;
CREATE POLICY "expenses_view" ON public.expenses FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'expenses', 'view'));
CREATE POLICY "expenses_create" ON public.expenses FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'expenses', 'create'));
CREATE POLICY "expenses_edit" ON public.expenses FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'expenses', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'expenses', 'edit'));
CREATE POLICY "expenses_delete" ON public.expenses FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'expenses', 'delete'));

-- ========== RESTAURANT_BILLING module ==========
DROP POLICY IF EXISTS "billing manage restaurant_credits" ON public.restaurant_credits;
CREATE POLICY "restaurant_credits_view" ON public.restaurant_credits FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'view'));
CREATE POLICY "restaurant_credits_create" ON public.restaurant_credits FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'create'));
CREATE POLICY "restaurant_credits_edit" ON public.restaurant_credits FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'edit'));
CREATE POLICY "restaurant_credits_delete" ON public.restaurant_credits FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'delete'));

DROP POLICY IF EXISTS "tenant access" ON public.restaurant_payables;
CREATE POLICY "restaurant_payables_view" ON public.restaurant_payables FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'view'));
CREATE POLICY "restaurant_payables_create" ON public.restaurant_payables FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'create'));
CREATE POLICY "restaurant_payables_edit" ON public.restaurant_payables FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'edit'));
CREATE POLICY "restaurant_payables_delete" ON public.restaurant_payables FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'delete'));

DROP POLICY IF EXISTS "billing manage restaurant_settlements" ON public.restaurant_settlements;
CREATE POLICY "restaurant_settlements_view" ON public.restaurant_settlements FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'view'));
CREATE POLICY "restaurant_settlements_create" ON public.restaurant_settlements FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'create'));
CREATE POLICY "restaurant_settlements_edit" ON public.restaurant_settlements FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'edit'));
CREATE POLICY "restaurant_settlements_delete" ON public.restaurant_settlements FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'delete'));

DROP POLICY IF EXISTS "tenant access" ON public.restaurant_direct_charges;
CREATE POLICY "restaurant_direct_charges_view" ON public.restaurant_direct_charges FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'view')
      OR public.has_permission(auth.uid(), property_id, 'new_kot', 'view'));
CREATE POLICY "restaurant_direct_charges_create" ON public.restaurant_direct_charges FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'create')
      OR public.has_permission(auth.uid(), property_id, 'new_kot', 'create'));
CREATE POLICY "restaurant_direct_charges_edit" ON public.restaurant_direct_charges FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'edit')
      OR public.has_permission(auth.uid(), property_id, 'new_kot', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'edit')
      OR public.has_permission(auth.uid(), property_id, 'new_kot', 'edit'));
CREATE POLICY "restaurant_direct_charges_delete" ON public.restaurant_direct_charges FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'restaurant_billing', 'delete')
      OR public.has_permission(auth.uid(), property_id, 'new_kot', 'delete'));

-- ========== KOT (new_kot OR all_kots) ==========
DROP POLICY IF EXISTS "food manage kot_orders" ON public.kot_orders;
CREATE POLICY "kot_orders_view" ON public.kot_orders FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'new_kot', 'view')
      OR public.has_permission(auth.uid(), property_id, 'all_kots', 'view'));
CREATE POLICY "kot_orders_create" ON public.kot_orders FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'new_kot', 'create'));
CREATE POLICY "kot_orders_edit" ON public.kot_orders FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'new_kot', 'edit')
      OR public.has_permission(auth.uid(), property_id, 'all_kots', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'new_kot', 'edit')
      OR public.has_permission(auth.uid(), property_id, 'all_kots', 'edit'));
CREATE POLICY "kot_orders_delete" ON public.kot_orders FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'new_kot', 'delete')
      OR public.has_permission(auth.uid(), property_id, 'all_kots', 'delete'));

DROP POLICY IF EXISTS "food manage kot_items" ON public.kot_items;
CREATE POLICY "kot_items_view" ON public.kot_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.kot_orders k WHERE k.id = kot_items.kot_id
    AND (public.has_permission(auth.uid(), k.property_id, 'new_kot', 'view')
      OR public.has_permission(auth.uid(), k.property_id, 'all_kots', 'view'))));
CREATE POLICY "kot_items_create" ON public.kot_items FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.kot_orders k WHERE k.id = kot_items.kot_id
    AND public.has_permission(auth.uid(), k.property_id, 'new_kot', 'create')));
CREATE POLICY "kot_items_edit" ON public.kot_items FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.kot_orders k WHERE k.id = kot_items.kot_id
    AND (public.has_permission(auth.uid(), k.property_id, 'new_kot', 'edit')
      OR public.has_permission(auth.uid(), k.property_id, 'all_kots', 'edit'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.kot_orders k WHERE k.id = kot_items.kot_id
    AND (public.has_permission(auth.uid(), k.property_id, 'new_kot', 'edit')
      OR public.has_permission(auth.uid(), k.property_id, 'all_kots', 'edit'))));
CREATE POLICY "kot_items_delete" ON public.kot_items FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.kot_orders k WHERE k.id = kot_items.kot_id
    AND (public.has_permission(auth.uid(), k.property_id, 'new_kot', 'delete')
      OR public.has_permission(auth.uid(), k.property_id, 'all_kots', 'delete'))));

DROP POLICY IF EXISTS "food manage kot_audit_log" ON public.kot_audit_log;
CREATE POLICY "kot_audit_log_view" ON public.kot_audit_log FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'new_kot', 'view')
      OR public.has_permission(auth.uid(), property_id, 'all_kots', 'view'));
CREATE POLICY "kot_audit_log_create" ON public.kot_audit_log FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'new_kot', 'create')
      OR public.has_permission(auth.uid(), property_id, 'all_kots', 'create'));
CREATE POLICY "kot_audit_log_edit" ON public.kot_audit_log FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'new_kot', 'edit')
      OR public.has_permission(auth.uid(), property_id, 'all_kots', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'new_kot', 'edit')
      OR public.has_permission(auth.uid(), property_id, 'all_kots', 'edit'));
CREATE POLICY "kot_audit_log_delete" ON public.kot_audit_log FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'all_kots', 'delete'));

-- ========== MASTER_DATA dual-read tables ==========
DROP POLICY IF EXISTS "managers manage menu_items" ON public.menu_items;
DROP POLICY IF EXISTS "food role read menu_items" ON public.menu_items;
CREATE POLICY "menu_items_view" ON public.menu_items FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'view')
      OR public.has_permission(auth.uid(), property_id, 'food_dashboard', 'view')
      OR public.has_permission(auth.uid(), property_id, 'new_kot', 'view'));
CREATE POLICY "menu_items_create" ON public.menu_items FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "menu_items_edit" ON public.menu_items FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "menu_items_delete" ON public.menu_items FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));

DROP POLICY IF EXISTS "managers manage menu_categories" ON public.menu_categories;
DROP POLICY IF EXISTS "food role read menu_categories" ON public.menu_categories;
CREATE POLICY "menu_categories_view" ON public.menu_categories FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'view')
      OR public.has_permission(auth.uid(), property_id, 'food_dashboard', 'view')
      OR public.has_permission(auth.uid(), property_id, 'new_kot', 'view'));
CREATE POLICY "menu_categories_create" ON public.menu_categories FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "menu_categories_edit" ON public.menu_categories FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "menu_categories_delete" ON public.menu_categories FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));

DROP POLICY IF EXISTS "managers manage pos_categories" ON public.pos_categories;
DROP POLICY IF EXISTS "property members read pos_categories" ON public.pos_categories;
CREATE POLICY "pos_categories_view" ON public.pos_categories FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'view')
      OR public.has_permission(auth.uid(), property_id, 'pos', 'view'));
CREATE POLICY "pos_categories_create" ON public.pos_categories FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "pos_categories_edit" ON public.pos_categories FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "pos_categories_delete" ON public.pos_categories FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));

DROP POLICY IF EXISTS "managers manage room_categories" ON public.room_categories;
DROP POLICY IF EXISTS "front desk read room_categories" ON public.room_categories;
CREATE POLICY "room_categories_view" ON public.room_categories FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'view')
      OR public.has_permission(auth.uid(), property_id, 'room_board', 'view')
      OR public.has_permission(auth.uid(), property_id, 'bookings', 'view'));
CREATE POLICY "room_categories_create" ON public.room_categories FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "room_categories_edit" ON public.room_categories FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "room_categories_delete" ON public.room_categories FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));

DROP POLICY IF EXISTS "managers manage tariff_plans" ON public.tariff_plans;
DROP POLICY IF EXISTS "front desk read tariff_plans" ON public.tariff_plans;
CREATE POLICY "tariff_plans_view" ON public.tariff_plans FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'view')
      OR public.has_permission(auth.uid(), property_id, 'bookings', 'view'));
CREATE POLICY "tariff_plans_create" ON public.tariff_plans FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "tariff_plans_edit" ON public.tariff_plans FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "tariff_plans_delete" ON public.tariff_plans FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));

DROP POLICY IF EXISTS "managers manage rooms" ON public.rooms;
DROP POLICY IF EXISTS "front desk read rooms" ON public.rooms;
DROP POLICY IF EXISTS "front desk update room status" ON public.rooms;
CREATE POLICY "rooms_view" ON public.rooms FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'view')
      OR public.has_permission(auth.uid(), property_id, 'room_board', 'view')
      OR public.has_permission(auth.uid(), property_id, 'bookings', 'view'));
CREATE POLICY "rooms_create" ON public.rooms FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "rooms_edit" ON public.rooms FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit')
      OR public.has_permission(auth.uid(), property_id, 'room_board', 'edit')
      OR public.has_permission(auth.uid(), property_id, 'bookings', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit')
      OR public.has_permission(auth.uid(), property_id, 'room_board', 'edit')
      OR public.has_permission(auth.uid(), property_id, 'bookings', 'edit'));
CREATE POLICY "rooms_delete" ON public.rooms FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));

-- ========== MASTER_DATA — write-only, keep any-member SELECT for widely-read tables ==========
DROP POLICY IF EXISTS "managers manage halls" ON public.halls;
CREATE POLICY "halls_create" ON public.halls FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "halls_edit" ON public.halls FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "halls_delete" ON public.halls FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));
-- SELECT policy "authenticated can read halls in their property" retained as-is.

DROP POLICY IF EXISTS "manage gst_slabs" ON public.gst_slabs;
CREATE POLICY "gst_slabs_create" ON public.gst_slabs FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "gst_slabs_edit" ON public.gst_slabs FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "gst_slabs_delete" ON public.gst_slabs FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));
-- SELECT "view gst_slabs" retained as-is.

DROP POLICY IF EXISTS "printer_roles_write" ON public.printer_roles;
CREATE POLICY "printer_roles_create" ON public.printer_roles FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "printer_roles_edit" ON public.printer_roles FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "printer_roles_delete" ON public.printer_roles FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));
-- SELECT "printer_roles_select" retained as-is.

-- ========== MASTER_DATA — plain ==========
DROP POLICY IF EXISTS "managers manage printers" ON public.printers;
CREATE POLICY "printers_view" ON public.printers FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'view'));
CREATE POLICY "printers_create" ON public.printers FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "printers_edit" ON public.printers FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "printers_delete" ON public.printers FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));

DROP POLICY IF EXISTS "managers manage sundry_items" ON public.sundry_items;
CREATE POLICY "sundry_items_view" ON public.sundry_items FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'view')
      OR public.has_permission(auth.uid(), property_id, 'invoices', 'view')
      OR public.has_permission(auth.uid(), property_id, 'pos', 'view'));
CREATE POLICY "sundry_items_create" ON public.sundry_items FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "sundry_items_edit" ON public.sundry_items FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "sundry_items_delete" ON public.sundry_items FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));

DROP POLICY IF EXISTS "managers manage rate_seasons" ON public.rate_seasons;
CREATE POLICY "rate_seasons_view" ON public.rate_seasons FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'view')
      OR public.has_permission(auth.uid(), property_id, 'bookings', 'view'));
CREATE POLICY "rate_seasons_create" ON public.rate_seasons FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "rate_seasons_edit" ON public.rate_seasons FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "rate_seasons_delete" ON public.rate_seasons FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));

DROP POLICY IF EXISTS "managers manage message_templates" ON public.message_templates;
CREATE POLICY "message_templates_view" ON public.message_templates FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'view')
      OR public.has_permission(auth.uid(), property_id, 'guest_crm', 'view'));
CREATE POLICY "message_templates_create" ON public.message_templates FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "message_templates_edit" ON public.message_templates FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "message_templates_delete" ON public.message_templates FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));

DROP POLICY IF EXISTS "managers manage expense_categories" ON public.expense_categories;
CREATE POLICY "expense_categories_view" ON public.expense_categories FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'view')
      OR public.has_permission(auth.uid(), property_id, 'expenses', 'view'));
CREATE POLICY "expense_categories_create" ON public.expense_categories FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "expense_categories_edit" ON public.expense_categories FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "expense_categories_delete" ON public.expense_categories FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));

DROP POLICY IF EXISTS "managers manage ota_channels" ON public.ota_channels;
CREATE POLICY "ota_channels_view" ON public.ota_channels FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'view'));
CREATE POLICY "ota_channels_create" ON public.ota_channels FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "ota_channels_edit" ON public.ota_channels FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "ota_channels_delete" ON public.ota_channels FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));

DROP POLICY IF EXISTS "managers manage ota_channel_mappings" ON public.ota_channel_mappings;
CREATE POLICY "ota_channel_mappings_view" ON public.ota_channel_mappings FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'view'));
CREATE POLICY "ota_channel_mappings_create" ON public.ota_channel_mappings FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "ota_channel_mappings_edit" ON public.ota_channel_mappings FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "ota_channel_mappings_delete" ON public.ota_channel_mappings FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));

DROP POLICY IF EXISTS "managers manage ota_sync_logs" ON public.ota_sync_logs;
CREATE POLICY "ota_sync_logs_view" ON public.ota_sync_logs FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'view'));
CREATE POLICY "ota_sync_logs_create" ON public.ota_sync_logs FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY "ota_sync_logs_edit" ON public.ota_sync_logs FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY "ota_sync_logs_delete" ON public.ota_sync_logs FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));

-- ========== INVENTORY module ==========
DROP POLICY IF EXISTS "managers manage inventory_items" ON public.inventory_items;
CREATE POLICY "inventory_items_view" ON public.inventory_items FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'inventory', 'view'));
CREATE POLICY "inventory_items_create" ON public.inventory_items FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'inventory', 'create'));
CREATE POLICY "inventory_items_edit" ON public.inventory_items FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'inventory', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'inventory', 'edit'));
CREATE POLICY "inventory_items_delete" ON public.inventory_items FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'inventory', 'delete'));

DROP POLICY IF EXISTS "managers manage stock_movements" ON public.stock_movements;
CREATE POLICY "stock_movements_view" ON public.stock_movements FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'inventory', 'view'));
CREATE POLICY "stock_movements_create" ON public.stock_movements FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'inventory', 'create'));
CREATE POLICY "stock_movements_edit" ON public.stock_movements FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'inventory', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'inventory', 'edit'));
CREATE POLICY "stock_movements_delete" ON public.stock_movements FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'inventory', 'delete'));

DROP POLICY IF EXISTS "managers manage vendors" ON public.vendors;
CREATE POLICY "vendors_view" ON public.vendors FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'inventory', 'view'));
CREATE POLICY "vendors_create" ON public.vendors FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'inventory', 'create'));
CREATE POLICY "vendors_edit" ON public.vendors FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'inventory', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'inventory', 'edit'));
CREATE POLICY "vendors_delete" ON public.vendors FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'inventory', 'delete'));

-- ========== POS module ==========
DROP POLICY IF EXISTS "property members manage pos_charges" ON public.pos_charges;
CREATE POLICY "pos_charges_view" ON public.pos_charges FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'pos', 'view'));
CREATE POLICY "pos_charges_create" ON public.pos_charges FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'pos', 'create'));
CREATE POLICY "pos_charges_edit" ON public.pos_charges FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'pos', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'pos', 'edit'));
CREATE POLICY "pos_charges_delete" ON public.pos_charges FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'pos', 'delete'));

-- ========== TASKS module (housekeeping) ==========
DROP POLICY IF EXISTS "housekeeping manage tasks" ON public.housekeeping_tasks;
CREATE POLICY "housekeeping_tasks_view" ON public.housekeeping_tasks FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'tasks', 'view'));
CREATE POLICY "housekeeping_tasks_create" ON public.housekeeping_tasks FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'tasks', 'create'));
CREATE POLICY "housekeeping_tasks_edit" ON public.housekeeping_tasks FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'tasks', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'tasks', 'edit'));
CREATE POLICY "housekeeping_tasks_delete" ON public.housekeeping_tasks FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'tasks', 'delete'));

-- ========== STAFF_HR module ==========
DROP POLICY IF EXISTS "managers manage staff" ON public.staff;
CREATE POLICY "staff_view" ON public.staff FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'staff_hr', 'view'));
CREATE POLICY "staff_create" ON public.staff FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'staff_hr', 'create'));
CREATE POLICY "staff_edit" ON public.staff FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'staff_hr', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'staff_hr', 'edit'));
CREATE POLICY "staff_delete" ON public.staff FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'staff_hr', 'delete'));

DROP POLICY IF EXISTS "managers manage attendance" ON public.attendance;
CREATE POLICY "attendance_view" ON public.attendance FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'staff_hr', 'view'));
CREATE POLICY "attendance_create" ON public.attendance FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'staff_hr', 'create'));
CREATE POLICY "attendance_edit" ON public.attendance FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'staff_hr', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'staff_hr', 'edit'));
CREATE POLICY "attendance_delete" ON public.attendance FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'staff_hr', 'delete'));

DROP POLICY IF EXISTS "managers manage payroll" ON public.payroll_runs;
CREATE POLICY "payroll_runs_view" ON public.payroll_runs FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'staff_hr', 'view'));
CREATE POLICY "payroll_runs_create" ON public.payroll_runs FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'staff_hr', 'create'));
CREATE POLICY "payroll_runs_edit" ON public.payroll_runs FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'staff_hr', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'staff_hr', 'edit'));
CREATE POLICY "payroll_runs_delete" ON public.payroll_runs FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'staff_hr', 'delete'));

-- ========== BUCKET C — activity_log, reminders, property_settings ==========
DROP POLICY IF EXISTS "activity_log tenant select" ON public.activity_log;
DROP POLICY IF EXISTS "activity_log tenant insert" ON public.activity_log;
CREATE POLICY "activity_log_view" ON public.activity_log FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'reports', 'view'));
CREATE POLICY "activity_log_create" ON public.activity_log FOR INSERT
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND user_id = auth.uid());

DROP POLICY IF EXISTS "reminders_tenant_access" ON public.reminders;
CREATE POLICY "reminders_view" ON public.reminders FOR SELECT
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'view')
      OR public.has_permission(auth.uid(), property_id, 'tasks', 'view')
      OR public.has_permission(auth.uid(), property_id, 'new_kot', 'view'));
CREATE POLICY "reminders_create" ON public.reminders FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'bookings', 'create')
      OR public.has_permission(auth.uid(), property_id, 'tasks', 'create')
      OR public.has_permission(auth.uid(), property_id, 'new_kot', 'create'));
CREATE POLICY "reminders_edit" ON public.reminders FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'edit')
      OR public.has_permission(auth.uid(), property_id, 'tasks', 'edit')
      OR public.has_permission(auth.uid(), property_id, 'new_kot', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'bookings', 'edit')
      OR public.has_permission(auth.uid(), property_id, 'tasks', 'edit')
      OR public.has_permission(auth.uid(), property_id, 'new_kot', 'edit'));
CREATE POLICY "reminders_delete" ON public.reminders FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'delete')
      OR public.has_permission(auth.uid(), property_id, 'tasks', 'delete')
      OR public.has_permission(auth.uid(), property_id, 'new_kot', 'delete'));

DROP POLICY IF EXISTS "property_settings_upsert" ON public.property_settings;
DROP POLICY IF EXISTS "property_settings_update" ON public.property_settings;
-- SELECT "property_settings_select" retained (any property member, unchanged).
CREATE POLICY "property_settings_create" ON public.property_settings FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'settings_business', 'edit'));
CREATE POLICY "property_settings_edit" ON public.property_settings FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'settings_business', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'settings_business', 'edit'));
