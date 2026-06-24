
CREATE TABLE IF NOT EXISTS public.halls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  capacity int NOT NULL DEFAULT 0,
  hourly_rate numeric(12,2) NOT NULL DEFAULT 0,
  day_rate numeric(12,2) NOT NULL DEFAULT 0,
  location text,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.halls TO authenticated;
GRANT ALL ON public.halls TO service_role;
ALTER TABLE public.halls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Masters read halls" ON public.halls FOR SELECT TO authenticated USING (public.can_front_desk(auth.uid()));
CREATE POLICY "Masters write halls" ON public.halls FOR ALL TO authenticated USING (public.can_manage_masters(auth.uid())) WITH CHECK (public.can_manage_masters(auth.uid()));

DROP TRIGGER IF EXISTS tg_halls_updated ON public.halls;
CREATE TRIGGER tg_halls_updated BEFORE UPDATE ON public.halls FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.banquet_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  banquet_number text NOT NULL DEFAULT '',
  hall_id uuid NOT NULL REFERENCES public.halls(id) ON DELETE RESTRICT,
  guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  function_type text NOT NULL DEFAULT 'event',
  event_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  pax int NOT NULL DEFAULT 0,
  package_rate numeric(12,2) NOT NULL DEFAULT 0,
  hall_charge numeric(12,2) NOT NULL DEFAULT 0,
  fb_charge numeric(12,2) NOT NULL DEFAULT 0,
  extra_charge numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  advance_amount numeric(12,2) NOT NULL DEFAULT 0,
  balance_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','confirmed','completed','cancelled')),
  notes text,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_bookings TO authenticated;
GRANT ALL ON public.banquet_bookings TO service_role;
ALTER TABLE public.banquet_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Front desk read banquets" ON public.banquet_bookings FOR SELECT TO authenticated USING (public.can_front_desk(auth.uid()));
CREATE POLICY "Front desk write banquets" ON public.banquet_bookings FOR ALL TO authenticated USING (public.can_front_desk(auth.uid())) WITH CHECK (public.can_front_desk(auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_assign_banquet_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_seq int; v_prefix text;
BEGIN
  IF NEW.banquet_number IS NOT NULL AND NEW.banquet_number <> '' THEN RETURN NEW; END IF;
  v_prefix := 'BQ-' || to_char(now(),'YYYYMMDD') || '-';
  SELECT COALESCE(MAX(NULLIF(regexp_replace(banquet_number,'^'||v_prefix,''),'')::int),0)+1
    INTO v_seq FROM public.banquet_bookings
    WHERE property_id = NEW.property_id AND banquet_number LIKE v_prefix||'%';
  NEW.banquet_number := v_prefix || lpad(v_seq::text,4,'0');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_banquet_number ON public.banquet_bookings;
CREATE TRIGGER tg_banquet_number BEFORE INSERT ON public.banquet_bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_assign_banquet_number();

DROP TRIGGER IF EXISTS tg_banquets_updated ON public.banquet_bookings;
CREATE TRIGGER tg_banquets_updated BEFORE UPDATE ON public.banquet_bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.banquet_bulk_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banquet_id uuid NOT NULL REFERENCES public.banquet_bookings(id) ON DELETE CASCADE,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  category_id uuid REFERENCES public.room_categories(id) ON DELETE SET NULL,
  rate numeric(12,2) NOT NULL DEFAULT 0,
  nights int NOT NULL DEFAULT 1,
  check_in date NOT NULL,
  check_out date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_bulk_rooms TO authenticated;
GRANT ALL ON public.banquet_bulk_rooms TO service_role;
ALTER TABLE public.banquet_bulk_rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Front desk read bulk rooms" ON public.banquet_bulk_rooms FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.banquet_bookings bb WHERE bb.id = banquet_bulk_rooms.banquet_id AND public.can_front_desk(auth.uid())));
CREATE POLICY "Front desk write bulk rooms" ON public.banquet_bulk_rooms FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.banquet_bookings bb WHERE bb.id = banquet_bulk_rooms.banquet_id AND public.can_front_desk(auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.banquet_bookings bb WHERE bb.id = banquet_bulk_rooms.banquet_id AND public.can_front_desk(auth.uid())));

CREATE INDEX IF NOT EXISTS idx_halls_property ON public.halls(property_id);
CREATE INDEX IF NOT EXISTS idx_banquets_property_date ON public.banquet_bookings(property_id, event_date);
CREATE INDEX IF NOT EXISTS idx_banquets_hall_date ON public.banquet_bookings(hall_id, event_date);
CREATE INDEX IF NOT EXISTS idx_bulk_rooms_banquet ON public.banquet_bulk_rooms(banquet_id);
