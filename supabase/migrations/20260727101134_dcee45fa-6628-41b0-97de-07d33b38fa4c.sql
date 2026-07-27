-- 1. segment_bills (per-punch bills; supports walk-ins)
CREATE TABLE public.segment_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  segment text NOT NULL CHECK (segment IN ('food','laundry')),
  bill_number text NOT NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  folio_id uuid REFERENCES public.folios(id) ON DELETE SET NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  is_walkin boolean NOT NULL DEFAULT false,
  guest_name text,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  gst_amount numeric(12,2) NOT NULL DEFAULT 0,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_mode text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled','void')),
  settled_at timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, bill_number)
);
CREATE INDEX idx_segment_bills_prop_segment ON public.segment_bills (property_id, segment, created_at DESC);
CREATE INDEX idx_segment_bills_booking ON public.segment_bills (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX idx_segment_bills_folio ON public.segment_bills (folio_id) WHERE folio_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.segment_bills TO authenticated;
GRANT ALL ON public.segment_bills TO service_role;
ALTER TABLE public.segment_bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "segment_bills_select" ON public.segment_bills FOR SELECT TO authenticated
  USING (public.user_has_property(auth.uid(), property_id));
CREATE POLICY "segment_bills_insert" ON public.segment_bills FOR INSERT TO authenticated
  WITH CHECK (public.user_has_property(auth.uid(), property_id));
CREATE POLICY "segment_bills_update" ON public.segment_bills FOR UPDATE TO authenticated
  USING (public.can_billing(auth.uid(), property_id))
  WITH CHECK (public.can_billing(auth.uid(), property_id));
CREATE POLICY "segment_bills_delete" ON public.segment_bills FOR DELETE TO authenticated
  USING (public.is_owner_or_super(auth.uid()));

CREATE TRIGGER trg_segment_bills_updated_at
  BEFORE UPDATE ON public.segment_bills
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 2. Auto-assign segment bill number via existing generator
CREATE OR REPLACE FUNCTION public.tg_assign_segment_bill_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.bill_number IS NOT NULL AND NEW.bill_number <> '' THEN
    RETURN NEW;
  END IF;
  NEW.bill_number := public.generate_bill_number(NEW.property_id, NEW.segment);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_assign_segment_bill_number
  BEFORE INSERT ON public.segment_bills
  FOR EACH ROW EXECUTE FUNCTION public.tg_assign_segment_bill_number();

-- 3. segment_bill_items
CREATE TABLE public.segment_bill_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_bill_id uuid NOT NULL REFERENCES public.segment_bills(id) ON DELETE CASCADE,
  description text NOT NULL,
  qty numeric(10,2) NOT NULL DEFAULT 1,
  rate numeric(12,2) NOT NULL DEFAULT 0,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  gst_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_segment_bill_items_bill ON public.segment_bill_items (segment_bill_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.segment_bill_items TO authenticated;
GRANT ALL ON public.segment_bill_items TO service_role;
ALTER TABLE public.segment_bill_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "segment_bill_items_select" ON public.segment_bill_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.segment_bills sb
     WHERE sb.id = segment_bill_items.segment_bill_id
       AND public.user_has_property(auth.uid(), sb.property_id)
  ));
CREATE POLICY "segment_bill_items_insert" ON public.segment_bill_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.segment_bills sb
     WHERE sb.id = segment_bill_items.segment_bill_id
       AND public.user_has_property(auth.uid(), sb.property_id)
  ));
CREATE POLICY "segment_bill_items_update" ON public.segment_bill_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.segment_bills sb
     WHERE sb.id = segment_bill_items.segment_bill_id
       AND public.can_billing(auth.uid(), sb.property_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.segment_bills sb
     WHERE sb.id = segment_bill_items.segment_bill_id
       AND public.can_billing(auth.uid(), sb.property_id)
  ));
CREATE POLICY "segment_bill_items_delete" ON public.segment_bill_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.segment_bills sb
     WHERE sb.id = segment_bill_items.segment_bill_id
       AND public.is_owner_or_super(auth.uid())
  ));

-- 4. folio_charges: add segment_bill_ref + allow 'laundry'
ALTER TABLE public.folio_charges
  ADD COLUMN IF NOT EXISTS segment_bill_ref text;

ALTER TABLE public.folio_charges DROP CONSTRAINT IF EXISTS folio_charges_charge_type_check;
ALTER TABLE public.folio_charges
  ADD CONSTRAINT folio_charges_charge_type_check
  CHECK (charge_type = ANY (ARRAY['room','food','laundry','extra','extra_bed','discount','tax']));

CREATE INDEX IF NOT EXISTS idx_folio_charges_segment_ref
  ON public.folio_charges (segment_bill_ref)
  WHERE segment_bill_ref IS NOT NULL;

-- 5. Checkout guard: list any unsettled food/laundry segment bills on a booking
CREATE OR REPLACE FUNCTION public.has_pending_segment_bills(_booking_id uuid)
RETURNS TABLE(id uuid, segment text, bill_number text, total_amount numeric, paid_amount numeric, balance numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT sb.id, sb.segment, sb.bill_number, sb.total_amount, sb.paid_amount,
         GREATEST(0, sb.total_amount - sb.paid_amount) AS balance
    FROM public.segment_bills sb
   WHERE sb.booking_id = _booking_id
     AND sb.status = 'open'
     AND GREATEST(0, sb.total_amount - sb.paid_amount) > 0.01
   ORDER BY sb.created_at
$$;

GRANT EXECUTE ON FUNCTION public.has_pending_segment_bills(uuid) TO authenticated;