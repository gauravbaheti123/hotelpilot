
-- ============================================================
-- Multi-tenant property scoping
-- ============================================================

-- Helper: is current user a superadmin
CREATE OR REPLACE FUNCTION public.is_superadmin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'superadmin'::app_role)
$$;

-- Helper: does this user have access to this property
CREATE OR REPLACE FUNCTION public.user_has_property(_uid uuid, _prop uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_superadmin(_uid)
      OR (_prop IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.user_roles
             WHERE user_id = _uid AND property_id = _prop))
$$;

-- Helper: convenience for IN (...) checks
CREATE OR REPLACE FUNCTION public.user_property_ids(_uid uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT property_id FROM public.user_roles
   WHERE user_id = _uid AND property_id IS NOT NULL
$$;

-- ============================================================
-- Drop ALL existing policies on tenant tables, recreate as
-- a single tenant-scoped ALL policy per table.
-- ============================================================
DO $do$
DECLARE
  t text;
  pol record;
  direct_tables text[] := ARRAY[
    'bookings','booking_rooms','guests','rooms','room_categories',
    'folios','payments','kot_orders','restaurant_credits',
    'restaurant_settlements','banquet_bookings','halls','housekeeping_tasks',
    'room_shifts','expenses','expense_categories','inventory_items',
    'stock_movements','vendors','staff','attendance','payroll_runs',
    'guest_feedback','communications','whatsapp_messages','day_closures',
    'checkout_overrides','tariff_plans','rate_seasons','menu_categories',
    'menu_items','message_templates','printers','sundry_items',
    'ota_channels','ota_channel_mappings','ota_sync_logs','wipe_logs',
    'kot_audit_log'
  ];
BEGIN
  FOREACH t IN ARRAY direct_tables LOOP
    -- drop every existing policy on the table
    FOR pol IN
      SELECT policyname FROM pg_policies
       WHERE schemaname='public' AND tablename=t
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;

    -- ensure RLS on
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    -- one tenant-scoped policy covering all commands
    EXECUTE format($f$
      CREATE POLICY "tenant access" ON public.%I
        FOR ALL TO authenticated
        USING (public.user_has_property(auth.uid(), property_id))
        WITH CHECK (public.user_has_property(auth.uid(), property_id))
    $f$, t);
  END LOOP;
END
$do$;

-- ============================================================
-- Child tables: scope via parent
-- ============================================================

-- kot_items via kot_orders
DO $do$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='kot_items' LOOP
    EXECUTE format('DROP POLICY %I ON public.kot_items', pol.policyname);
  END LOOP;
END $do$;
ALTER TABLE public.kot_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access via kot_orders" ON public.kot_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.kot_orders k
                 WHERE k.id = kot_items.kot_id
                 AND public.user_has_property(auth.uid(), k.property_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.kot_orders k
                 WHERE k.id = kot_items.kot_id
                 AND public.user_has_property(auth.uid(), k.property_id)));

-- folio_charges via folios
DO $do$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='folio_charges' LOOP
    EXECUTE format('DROP POLICY %I ON public.folio_charges', pol.policyname);
  END LOOP;
END $do$;
ALTER TABLE public.folio_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access via folios" ON public.folio_charges
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.folios f
                 WHERE f.id = folio_charges.folio_id
                 AND public.user_has_property(auth.uid(), f.property_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.folios f
                 WHERE f.id = folio_charges.folio_id
                 AND public.user_has_property(auth.uid(), f.property_id)));

-- banquet_bulk_rooms via banquet_bookings
DO $do$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='banquet_bulk_rooms' LOOP
    EXECUTE format('DROP POLICY %I ON public.banquet_bulk_rooms', pol.policyname);
  END LOOP;
END $do$;
ALTER TABLE public.banquet_bulk_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access via banquet" ON public.banquet_bulk_rooms
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.banquet_bookings b
                 WHERE b.id = banquet_bulk_rooms.banquet_id
                 AND public.user_has_property(auth.uid(), b.property_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.banquet_bookings b
                 WHERE b.id = banquet_bulk_rooms.banquet_id
                 AND public.user_has_property(auth.uid(), b.property_id)));

-- wiped_data_archive via wipe_logs
DO $do$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='wiped_data_archive' LOOP
    EXECUTE format('DROP POLICY %I ON public.wiped_data_archive', pol.policyname);
  END LOOP;
END $do$;
ALTER TABLE public.wiped_data_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access via wipe_logs" ON public.wiped_data_archive
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.wipe_logs w
                 WHERE w.id = wiped_data_archive.wipe_log_id
                 AND public.user_has_property(auth.uid(), w.property_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.wipe_logs w
                 WHERE w.id = wiped_data_archive.wipe_log_id
                 AND public.user_has_property(auth.uid(), w.property_id)));

-- ============================================================
-- Folios needs special-case: get_or_create_folio sets created_by
-- but writes happen via SECURITY DEFINER so RLS bypass is fine.
-- No extra action.
-- ============================================================

-- ============================================================
-- Properties table: superadmin all, others linked-only read
-- ============================================================
DO $do$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='properties' LOOP
    EXECUTE format('DROP POLICY %I ON public.properties', pol.policyname);
  END LOOP;
END $do$;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view linked properties" ON public.properties
  FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid())
      OR id IN (SELECT public.user_property_ids(auth.uid())));

CREATE POLICY "superadmin manage properties" ON public.properties
  FOR ALL TO authenticated
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));
