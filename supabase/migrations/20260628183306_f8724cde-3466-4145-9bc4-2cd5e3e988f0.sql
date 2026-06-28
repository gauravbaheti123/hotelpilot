
-- =====================================================================
-- 1) Property-aware role helpers (2-arg overloads)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.can_manage_masters(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_superadmin(_user_id) OR (
    _property_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id
         AND (property_id = _property_id OR property_id IS NULL)
         AND role IN ('owner','manager')
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_front_desk(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_superadmin(_user_id) OR (
    _property_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id
         AND (property_id = _property_id OR property_id IS NULL)
         AND role IN ('owner','manager','receptionist')
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_billing(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_superadmin(_user_id) OR (
    _property_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id
         AND (property_id = _property_id OR property_id IS NULL)
         AND role IN ('owner','manager','receptionist')
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_food(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_superadmin(_user_id) OR (
    _property_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id
         AND (property_id = _property_id OR property_id IS NULL)
         AND role IN ('owner','manager','receptionist','kitchen')
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_housekeeping(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_superadmin(_user_id) OR (
    _property_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id
         AND (property_id = _property_id OR property_id IS NULL)
         AND role IN ('owner','manager','receptionist','housekeeping')
    )
  )
$$;

-- =====================================================================
-- 2) Drop & recreate EXISTS-style and OR-grouped policies manually
-- =====================================================================
-- banquet_bulk_rooms
DROP POLICY IF EXISTS "front desk manage banquet_bulk_rooms" ON public.banquet_bulk_rooms;
CREATE POLICY "front desk manage banquet_bulk_rooms" ON public.banquet_bulk_rooms
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.banquet_bookings b
                  WHERE b.id = banquet_bulk_rooms.banquet_id
                    AND public.can_front_desk(auth.uid(), b.property_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.banquet_bookings b
                       WHERE b.id = banquet_bulk_rooms.banquet_id
                         AND public.can_front_desk(auth.uid(), b.property_id)));

-- folio_charges
DROP POLICY IF EXISTS "billing manage folio_charges" ON public.folio_charges;
CREATE POLICY "billing manage folio_charges" ON public.folio_charges
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.folios f
                  WHERE f.id = folio_charges.folio_id
                    AND public.can_billing(auth.uid(), f.property_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.folios f
                       WHERE f.id = folio_charges.folio_id
                         AND public.can_billing(auth.uid(), f.property_id)));

-- kot_items
DROP POLICY IF EXISTS "food manage kot_items" ON public.kot_items;
CREATE POLICY "food manage kot_items" ON public.kot_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.kot_orders k
                  WHERE k.id = kot_items.kot_id
                    AND public.can_food(auth.uid(), k.property_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.kot_orders k
                       WHERE k.id = kot_items.kot_id
                         AND public.can_food(auth.uid(), k.property_id)));

-- reminders (OR group)
DROP POLICY IF EXISTS reminders_tenant_access ON public.reminders;
CREATE POLICY reminders_tenant_access ON public.reminders
  FOR ALL TO authenticated
  USING (public.can_front_desk(auth.uid(), property_id)
      OR public.can_housekeeping(auth.uid(), property_id)
      OR public.can_food(auth.uid(), property_id))
  WITH CHECK (public.can_front_desk(auth.uid(), property_id)
      OR public.can_housekeeping(auth.uid(), property_id)
      OR public.can_food(auth.uid(), property_id));

-- restaurant_direct_charges (OR group)
DROP POLICY IF EXISTS "tenant access" ON public.restaurant_direct_charges;
CREATE POLICY "tenant access" ON public.restaurant_direct_charges
  FOR ALL TO authenticated
  USING (public.can_billing(auth.uid(), property_id) OR public.can_food(auth.uid(), property_id))
  WITH CHECK (public.can_billing(auth.uid(), property_id) OR public.can_food(auth.uid(), property_id));

-- mis_ledger insert (kept structure, but use property-aware helper)
DROP POLICY IF EXISTS "mis_ledger manager insert" ON public.mis_ledger;
CREATE POLICY "mis_ledger manager insert" ON public.mis_ledger
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_masters(auth.uid(), property_id)
    AND ((mis_account_id IS NULL) OR (EXISTS (
      SELECT 1 FROM public.mis_accounts a
       WHERE a.id = mis_ledger.mis_account_id
         AND a.property_id = mis_ledger.property_id
    )))
  );

-- gst_slabs — was globally scoped via can_manage_masters(auth.uid()) alone. Make it property-aware.
DROP POLICY IF EXISTS "manage gst_slabs" ON public.gst_slabs;
CREATE POLICY "manage gst_slabs" ON public.gst_slabs
  FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid(), property_id))
  WITH CHECK (public.can_manage_masters(auth.uid(), property_id));

-- =====================================================================
-- 3) DO loop: rewrite remaining simple policies via regex
--    Pattern: `user_has_property(auth.uid(), X) AND can_Y(auth.uid())`
--    -> `can_Y(auth.uid(), X)`  (and reverse order)
-- =====================================================================
DO $do$
DECLARE
  r record;
  q text;
  w text;
  cmd_kw text;
  re1 text := 'user_has_property\(auth\.uid\(\), ([a-zA-Z_][a-zA-Z0-9_.]*(?:\([^)]*\))?(?:::[a-zA-Z_][a-zA-Z0-9_]*)?)\) AND can_(manage_masters|front_desk|billing|food|housekeeping)\(auth\.uid\(\)\)';
  re2 text := 'can_(manage_masters|front_desk|billing|food|housekeeping)\(auth\.uid\(\)\) AND user_has_property\(auth\.uid\(\), ([a-zA-Z_][a-zA-Z0-9_.]*(?:\([^)]*\))?(?:::[a-zA-Z_][a-zA-Z0-9_]*)?)\)';
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname AS tbl, pol.polname, pol.polcmd,
      pg_get_expr(pol.polqual, pol.polrelid) AS qual,
      pg_get_expr(pol.polwithcheck, pol.polrelid) AS wc
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public','storage')
      AND COALESCE(pg_get_expr(pol.polqual, pol.polrelid),'') || ' ' || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid),'')
          ~ 'can_(manage_masters|front_desk|billing|food|housekeeping)\(auth\.uid\(\)\)'
  LOOP
    q := r.qual;
    w := r.wc;
    -- Apply 2 passes (handles policies with multiple occurrences)
    FOR i IN 1..3 LOOP
      IF q IS NOT NULL THEN
        q := regexp_replace(q, re1, 'can_\2(auth.uid(), \1)', 'g');
        q := regexp_replace(q, re2, 'can_\1(auth.uid(), \2)', 'g');
      END IF;
      IF w IS NOT NULL THEN
        w := regexp_replace(w, re1, 'can_\2(auth.uid(), \1)', 'g');
        w := regexp_replace(w, re2, 'can_\1(auth.uid(), \2)', 'g');
      END IF;
    END LOOP;

    -- Skip if no change made (avoids breaking already-fixed policies)
    IF q IS NOT DISTINCT FROM r.qual AND w IS NOT DISTINCT FROM r.wc THEN
      CONTINUE;
    END IF;

    cmd_kw := CASE r.polcmd
                WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                WHEN '*' THEN 'ALL' END;

    EXECUTE format('DROP POLICY %I ON %I.%I', r.polname, r.nspname, r.tbl);

    IF cmd_kw = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I FOR INSERT TO authenticated WITH CHECK (%s)',
                     r.polname, r.nspname, r.tbl, w);
    ELSIF cmd_kw = 'SELECT' THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I FOR SELECT TO authenticated USING (%s)',
                     r.polname, r.nspname, r.tbl, q);
    ELSIF cmd_kw = 'UPDATE' THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
                     r.polname, r.nspname, r.tbl, q, w);
    ELSIF cmd_kw = 'DELETE' THEN
      EXECUTE format('CREATE POLICY %I ON %I.%I FOR DELETE TO authenticated USING (%s)',
                     r.polname, r.nspname, r.tbl, q);
    ELSE
      EXECUTE format('CREATE POLICY %I ON %I.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
                     r.polname, r.nspname, r.tbl, q, w);
    END IF;
  END LOOP;
END $do$;

-- =====================================================================
-- 4) role_permissions: scope read to users who share the property
-- =====================================================================
DROP POLICY IF EXISTS role_permissions_read_authenticated ON public.role_permissions;
CREATE POLICY role_permissions_read_authenticated ON public.role_permissions
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.roles r
       WHERE r.id = role_permissions.role_id
         AND (r.property_id IS NULL OR public.user_has_property(auth.uid(), r.property_id))
    )
  );

-- =====================================================================
-- 5) properties: revoke direct column access to sensitive secrets
--    (only SECURITY DEFINER RPCs get_/save_property_secrets may read/write them)
-- =====================================================================
REVOKE SELECT (aisensy_api_key, wa_number, wifi_password)
  ON public.properties FROM authenticated, anon, PUBLIC;
REVOKE UPDATE (aisensy_api_key, wa_number, wifi_password)
  ON public.properties FROM authenticated, anon, PUBLIC;

-- =====================================================================
-- 6) Revoke EXECUTE on SECURITY DEFINER functions from anon
--    (keep pre-login helpers callable: check_login_allowed, record_login_attempt)
-- =====================================================================
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef = true
       AND p.proname NOT IN ('check_login_allowed','record_login_attempt')
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, PUBLIC',
                   r.proname, r.args);
  END LOOP;
END $do$;
