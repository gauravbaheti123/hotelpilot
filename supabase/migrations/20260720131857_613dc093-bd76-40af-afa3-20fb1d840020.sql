
CREATE TABLE IF NOT EXISTS public.food_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  folio_id uuid REFERENCES public.folios(id) ON DELETE SET NULL,
  food_bill_number text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, food_bill_number),
  UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_food_bills_property ON public.food_bills(property_id);
CREATE INDEX IF NOT EXISTS idx_food_bills_folio    ON public.food_bills(folio_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.food_bills TO authenticated;
GRANT ALL ON public.food_bills TO service_role;

ALTER TABLE public.food_bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "food_bills_select" ON public.food_bills
  FOR SELECT TO authenticated
  USING (public.user_has_property(auth.uid(), property_id));

CREATE POLICY "food_bills_insert" ON public.food_bills
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_property(auth.uid(), property_id));

CREATE POLICY "food_bills_update" ON public.food_bills
  FOR UPDATE TO authenticated
  USING (public.can_billing(auth.uid(), property_id))
  WITH CHECK (public.can_billing(auth.uid(), property_id));

CREATE POLICY "food_bills_delete" ON public.food_bills
  FOR DELETE TO authenticated
  USING (public.is_owner_or_super(auth.uid()));

CREATE TRIGGER trg_food_bills_updated_at
  BEFORE UPDATE ON public.food_bills
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Assign FB-XXXX per property, gap-tolerant, following invoice-number pattern.
CREATE OR REPLACE FUNCTION public.tg_assign_food_bill_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_next int;
  v_prefix text := 'FB-';
BEGIN
  IF NEW.food_bill_number IS NOT NULL AND NEW.food_bill_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(
           MAX(NULLIF(regexp_replace(food_bill_number, '^' || v_prefix, ''), '')::int),
           0
         ) + 1
    INTO v_next
    FROM public.food_bills
   WHERE property_id = NEW.property_id
     AND food_bill_number LIKE v_prefix || '%';
  NEW.food_bill_number := v_prefix || LPAD(v_next::text, 4, '0');
  RETURN NEW;
END $$;

CREATE TRIGGER trg_assign_food_bill_number
  BEFORE INSERT ON public.food_bills
  FOR EACH ROW EXECUTE FUNCTION public.tg_assign_food_bill_number();

-- Auto-create a food_bills row the first time a food charge lands on a booking's folio.
CREATE OR REPLACE FUNCTION public.tg_ensure_food_bill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_booking uuid;
  v_property uuid;
BEGIN
  IF NEW.charge_type <> 'food' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_wiped, false) THEN RETURN NEW; END IF;

  SELECT f.booking_id, f.property_id INTO v_booking, v_property
    FROM public.folios f WHERE f.id = NEW.folio_id;
  IF v_booking IS NULL OR v_property IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.food_bills (property_id, booking_id, folio_id)
  VALUES (v_property, v_booking, NEW.folio_id)
  ON CONFLICT (booking_id) DO UPDATE
    SET folio_id = COALESCE(public.food_bills.folio_id, EXCLUDED.folio_id),
        updated_at = now();

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ensure_food_bill ON public.folio_charges;
CREATE TRIGGER trg_ensure_food_bill
  AFTER INSERT ON public.folio_charges
  FOR EACH ROW EXECUTE FUNCTION public.tg_ensure_food_bill();

-- Backfill: any existing booking that already has food charges gets an FB number.
INSERT INTO public.food_bills (property_id, booking_id, folio_id)
SELECT DISTINCT f.property_id, f.booking_id, f.id
  FROM public.folio_charges fc
  JOIN public.folios f ON f.id = fc.folio_id
 WHERE fc.charge_type = 'food'
   AND COALESCE(fc.is_wiped, false) = false
   AND f.booking_id IS NOT NULL
ON CONFLICT (booking_id) DO NOTHING;
