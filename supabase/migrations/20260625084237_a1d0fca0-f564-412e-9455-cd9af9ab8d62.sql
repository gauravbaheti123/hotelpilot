
-- Booking-to-guest join (Issue #6): supports primary + additional guests for compliance reports
CREATE TABLE IF NOT EXISTS public.booking_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  age integer,
  relation_to_primary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, guest_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_guests_booking ON public.booking_guests(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_guests_property ON public.booking_guests(property_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_guests TO authenticated;
GRANT ALL ON public.booking_guests TO service_role;

ALTER TABLE public.booking_guests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant access" ON public.booking_guests
  FOR ALL TO authenticated
  USING (public.is_superadmin(auth.uid()) OR public.user_has_property(auth.uid(), property_id))
  WITH CHECK (public.is_superadmin(auth.uid()) OR public.user_has_property(auth.uid(), property_id));

CREATE TRIGGER trg_booking_guests_updated_at
  BEFORE UPDATE ON public.booking_guests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
