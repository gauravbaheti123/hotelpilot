
CREATE TABLE IF NOT EXISTS public.banquet_extra_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banquet_booking_id uuid NOT NULL REFERENCES public.banquet_bookings(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  point_name text NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  discount_type text CHECK (discount_type IN ('percent','amount')),
  discount_value numeric(12,2) DEFAULT 0,
  discount_amount numeric(12,2) DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banquet_extra_charges_booking
  ON public.banquet_extra_charges(banquet_booking_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_extra_charges TO authenticated;
GRANT ALL ON public.banquet_extra_charges TO service_role;

ALTER TABLE public.banquet_extra_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "banquet_extra_charges_select" ON public.banquet_extra_charges
  FOR SELECT TO authenticated
  USING (public.user_has_property(auth.uid(), property_id));

CREATE POLICY "banquet_extra_charges_write" ON public.banquet_extra_charges
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id))
  WITH CHECK (public.user_has_property(auth.uid(), property_id));

CREATE TRIGGER trg_banquet_extra_charges_updated
  BEFORE UPDATE ON public.banquet_extra_charges
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
