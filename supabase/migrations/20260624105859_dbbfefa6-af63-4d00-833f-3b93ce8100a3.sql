
-- Helper: who can perform front desk actions
CREATE OR REPLACE FUNCTION public.can_front_desk(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'superadmin'::app_role)
      OR public.has_role(_user_id, 'owner'::app_role)
      OR public.has_role(_user_id, 'manager'::app_role)
      OR public.has_role(_user_id, 'receptionist'::app_role)
$$;
GRANT EXECUTE ON FUNCTION public.can_front_desk(uuid) TO authenticated;

-- =========================================================
-- GUESTS
-- =========================================================
CREATE TABLE public.guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  mobile text,
  email text,
  gender text,
  dob date,
  nationality text DEFAULT 'Indian',
  address text,
  city text,
  state text,
  country text DEFAULT 'India',
  pincode text,
  company text,
  gst_number text,
  id_proof_type text,
  id_proof_number text,
  photo_url text,
  notes text,
  is_blacklisted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guests TO authenticated;
GRANT ALL ON public.guests TO service_role;
ALTER TABLE public.guests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view guests" ON public.guests FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage guests" ON public.guests FOR ALL TO authenticated
  USING (public.can_front_desk(auth.uid())) WITH CHECK (public.can_front_desk(auth.uid()));
CREATE TRIGGER trg_guests_updated BEFORE UPDATE ON public.guests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_guests_property ON public.guests(property_id);
CREATE INDEX idx_guests_mobile ON public.guests(property_id, mobile);

-- =========================================================
-- BOOKINGS
-- =========================================================
CREATE TYPE public.booking_status AS ENUM
  ('reserved','checked_in','checked_out','cancelled','no_show');

CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  booking_number text NOT NULL,
  guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  source text DEFAULT 'walk_in',
  status public.booking_status NOT NULL DEFAULT 'reserved',
  check_in date NOT NULL,
  check_out date NOT NULL,
  adults int NOT NULL DEFAULT 1,
  children int NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  advance_amount numeric NOT NULL DEFAULT 0,
  balance_amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  checked_in_at timestamptz,
  checked_in_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  checked_out_at timestamptz,
  checked_out_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, booking_number),
  CHECK (check_out > check_in)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view bookings" ON public.bookings FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage bookings" ON public.bookings FOR ALL TO authenticated
  USING (public.can_front_desk(auth.uid())) WITH CHECK (public.can_front_desk(auth.uid()));
CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_bookings_property_status ON public.bookings(property_id, status);
CREATE INDEX idx_bookings_dates ON public.bookings(property_id, check_in, check_out);

-- Auto booking number: BK-YYYYMMDD-NNNN per property/day
CREATE OR REPLACE FUNCTION public.tg_assign_booking_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seq int;
  v_prefix text;
BEGIN
  IF NEW.booking_number IS NOT NULL AND NEW.booking_number <> '' THEN
    RETURN NEW;
  END IF;
  v_prefix := 'BK-' || to_char(now(), 'YYYYMMDD') || '-';
  SELECT COALESCE(MAX(NULLIF(regexp_replace(booking_number, '^' || v_prefix, ''), '')::int), 0) + 1
    INTO v_seq
    FROM public.bookings
    WHERE property_id = NEW.property_id AND booking_number LIKE v_prefix || '%';
  NEW.booking_number := v_prefix || lpad(v_seq::text, 4, '0');
  RETURN NEW;
END $$;
CREATE TRIGGER trg_bookings_assign_number BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_assign_booking_number();

-- =========================================================
-- BOOKING ROOMS
-- =========================================================
CREATE TABLE public.booking_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  category_id uuid REFERENCES public.room_categories(id) ON DELETE SET NULL,
  tariff_id uuid REFERENCES public.tariff_plans(id) ON DELETE SET NULL,
  meal_plan public.meal_plan NOT NULL DEFAULT 'EP',
  rate numeric NOT NULL DEFAULT 0,
  adults int NOT NULL DEFAULT 1,
  children int NOT NULL DEFAULT 0,
  extra_beds int NOT NULL DEFAULT 0,
  check_in date NOT NULL,
  check_out date NOT NULL,
  actual_check_in timestamptz,
  actual_check_out timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (check_out > check_in)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_rooms TO authenticated;
GRANT ALL ON public.booking_rooms TO service_role;
ALTER TABLE public.booking_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view booking_rooms" ON public.booking_rooms FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage booking_rooms" ON public.booking_rooms FOR ALL TO authenticated
  USING (public.can_front_desk(auth.uid())) WITH CHECK (public.can_front_desk(auth.uid()));
CREATE TRIGGER trg_booking_rooms_updated BEFORE UPDATE ON public.booking_rooms
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX idx_booking_rooms_booking ON public.booking_rooms(booking_id);
CREATE INDEX idx_booking_rooms_room ON public.booking_rooms(room_id);

-- =========================================================
-- ROOM SHIFT AUDIT
-- =========================================================
CREATE TABLE public.room_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  booking_room_id uuid NOT NULL REFERENCES public.booking_rooms(id) ON DELETE CASCADE,
  from_room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  to_room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  reason text,
  shifted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  shifted_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.room_shifts TO authenticated;
GRANT ALL ON public.room_shifts TO service_role;
ALTER TABLE public.room_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view room_shifts" ON public.room_shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "log room_shifts" ON public.room_shifts FOR INSERT TO authenticated
  WITH CHECK (public.can_front_desk(auth.uid()));
