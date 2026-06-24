-- ===== 1. BOOKINGS =====
DROP POLICY IF EXISTS "view bookings" ON public.bookings;
CREATE POLICY "view bookings"
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING (
    (public.can_front_desk(auth.uid()) OR public.can_billing(auth.uid()) OR public.can_food(auth.uid()) OR public.can_housekeeping(auth.uid()))
    AND (is_wiped = false OR is_wiped IS NULL OR public.is_owner_or_super(auth.uid()))
  );

-- ===== 2. GUESTS =====
DROP POLICY IF EXISTS "view guests" ON public.guests;
CREATE POLICY "view guests"
  ON public.guests
  FOR SELECT
  TO authenticated
  USING (
    (public.can_front_desk(auth.uid()) OR public.can_billing(auth.uid()) OR public.can_food(auth.uid()) OR public.can_housekeeping(auth.uid()))
    AND (is_wiped = false OR is_wiped IS NULL OR public.is_owner_or_super(auth.uid()))
  );

-- ===== 3. STAFF =====
DROP POLICY IF EXISTS "view staff" ON public.staff;
CREATE POLICY "view staff"
  ON public.staff
  FOR SELECT
  TO authenticated
  USING (
    public.can_manage_masters(auth.uid())
    OR public.can_front_desk(auth.uid())
    OR public.can_food(auth.uid())
    OR public.can_housekeeping(auth.uid())
  );

-- ===== 4. BOOKING_ROOMS =====
DROP POLICY IF EXISTS "view booking_rooms" ON public.booking_rooms;
CREATE POLICY "view booking_rooms"
  ON public.booking_rooms
  FOR SELECT
  TO authenticated
  USING (
    public.can_front_desk(auth.uid())
    OR public.can_billing(auth.uid())
    OR public.can_housekeeping(auth.uid())
    OR public.can_food(auth.uid())
  );

-- ===== 5. ROOM_SHIFTS =====
DROP POLICY IF EXISTS "view room_shifts" ON public.room_shifts;
CREATE POLICY "view room_shifts"
  ON public.room_shifts
  FOR SELECT
  TO authenticated
  USING (
    public.can_front_desk(auth.uid())
    OR public.can_billing(auth.uid())
    OR public.can_housekeeping(auth.uid())
  );

-- ===== 6. PROPERTIES — hide credentials at column level =====
-- The general SELECT policy (any authenticated) is kept for non-credential columns
-- but column-level GRANTs prevent unprivileged authenticated users from reading
-- the WhatsApp API key, business number, and Wi-Fi password. Managers/owners
-- read them through the new SECURITY DEFINER RPC `get_property_secrets`.
REVOKE SELECT ON public.properties FROM authenticated;
GRANT SELECT (
  id, name, address, city, state, pincode, phone, email,
  gstin, pan, fssai, logo_url, checkin_time, checkout_time,
  early_checkin_charge, late_checkout_charge, currency,
  fiscal_year_start, is_active, created_at, updated_at
) ON public.properties TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.properties TO authenticated;

-- Manager-only RPC to read WhatsApp / Wi-Fi credentials
CREATE OR REPLACE FUNCTION public.get_property_secrets(_property_id uuid)
RETURNS TABLE (
  aisensy_api_key text,
  wa_number text,
  wifi_password text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_masters(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to read property credentials';
  END IF;
  RETURN QUERY
    SELECT p.aisensy_api_key, p.wa_number, p.wifi_password
    FROM public.properties p
    WHERE p.id = _property_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_property_secrets(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_property_secrets(uuid) TO authenticated;

-- Manager-only RPC to update WhatsApp / Wi-Fi credentials
CREATE OR REPLACE FUNCTION public.save_property_secrets(
  _property_id uuid,
  _aisensy_api_key text,
  _wa_number text,
  _wifi_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_manage_masters(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to update property credentials';
  END IF;
  UPDATE public.properties
    SET aisensy_api_key = NULLIF(_aisensy_api_key, ''),
        wa_number       = NULLIF(_wa_number, ''),
        wifi_password   = NULLIF(_wifi_password, ''),
        updated_at      = now()
    WHERE id = _property_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_property_secrets(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_property_secrets(uuid, text, text, text) TO authenticated;

-- ===== 7. SECURITY DEFINER helper functions — revoke anon, keep authenticated only where needed =====

-- Trigger functions: never callable through PostgREST
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_stock_movement()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_assign_banquet_number()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_assign_booking_number()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_assign_invoice_number()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_assign_kot_number()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_kot_create_restaurant_credit() FROM PUBLIC, anon, authenticated;

-- Role helpers used inside RLS (and by app where appropriate):
-- revoke PUBLIC + anon; authenticated keeps EXECUTE so RLS policies can evaluate.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_owner_or_super(uuid)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_front_desk(uuid)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_billing(uuid)          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_food(uuid)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_housekeeping(uuid)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_masters(uuid)   FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner_or_super(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_front_desk(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_billing(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_food(uuid)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_housekeeping(uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_masters(uuid)   TO authenticated;

-- App-facing helpers
REVOKE EXECUTE ON FUNCTION public.has_open_kot(uuid)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_or_create_folio(uuid)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_open_kot(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_folio(uuid)   TO authenticated;
