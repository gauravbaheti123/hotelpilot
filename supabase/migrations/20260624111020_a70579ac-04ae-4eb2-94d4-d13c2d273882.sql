
CREATE OR REPLACE FUNCTION public.can_billing(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_role(_user_id,'superadmin'::app_role)
      OR public.has_role(_user_id,'owner'::app_role)
      OR public.has_role(_user_id,'manager'::app_role)
      OR public.has_role(_user_id,'receptionist'::app_role)
$$;

CREATE TABLE IF NOT EXISTS public.folios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  invoice_number text NOT NULL DEFAULT '',
  gst_mode text NOT NULL DEFAULT 'gst' CHECK (gst_mode IN ('cash','gst')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled','void')),
  sub_total numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  gst_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  paid_amount numeric(12,2) NOT NULL DEFAULT 0,
  balance_amount numeric(12,2) NOT NULL DEFAULT 0,
  guest_gstin text,
  guest_company text,
  notes text,
  settled_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folios TO authenticated;
GRANT ALL ON public.folios TO service_role;
ALTER TABLE public.folios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Billing read folios" ON public.folios FOR SELECT TO authenticated USING (public.can_billing(auth.uid()));
CREATE POLICY "Billing write folios" ON public.folios FOR ALL TO authenticated USING (public.can_billing(auth.uid())) WITH CHECK (public.can_billing(auth.uid()));

CREATE TABLE IF NOT EXISTS public.folio_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio_id uuid NOT NULL REFERENCES public.folios(id) ON DELETE CASCADE,
  charge_type text NOT NULL CHECK (charge_type IN ('room','food','extra','discount','tax')),
  description text NOT NULL,
  qty numeric(10,2) NOT NULL DEFAULT 1,
  rate numeric(12,2) NOT NULL DEFAULT 0,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  gst_amount numeric(12,2) NOT NULL DEFAULT 0,
  source_table text,
  source_id uuid,
  charged_on date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folio_charges TO authenticated;
GRANT ALL ON public.folio_charges TO service_role;
ALTER TABLE public.folio_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Billing read folio_charges" ON public.folio_charges FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.folios f WHERE f.id = folio_charges.folio_id AND public.can_billing(auth.uid())));
CREATE POLICY "Billing write folio_charges" ON public.folio_charges FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.folios f WHERE f.id = folio_charges.folio_id AND public.can_billing(auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.folios f WHERE f.id = folio_charges.folio_id AND public.can_billing(auth.uid())));

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  folio_id uuid NOT NULL REFERENCES public.folios(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL,
  mode text NOT NULL CHECK (mode IN ('cash','card','upi','bank','wallet','other')),
  reference_no text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Billing read payments" ON public.payments FOR SELECT TO authenticated USING (public.can_billing(auth.uid()));
CREATE POLICY "Billing write payments" ON public.payments FOR ALL TO authenticated USING (public.can_billing(auth.uid())) WITH CHECK (public.can_billing(auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_assign_invoice_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_seq int; v_prefix text;
BEGIN
  IF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN RETURN NEW; END IF;
  v_prefix := 'INV-' || to_char(now(),'YYYYMMDD') || '-';
  SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_number,'^'||v_prefix,''),'')::int),0)+1
    INTO v_seq FROM public.folios
    WHERE property_id = NEW.property_id AND invoice_number LIKE v_prefix||'%';
  NEW.invoice_number := v_prefix || lpad(v_seq::text,4,'0');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_folio_invoice_number ON public.folios;
CREATE TRIGGER tg_folio_invoice_number BEFORE INSERT ON public.folios
  FOR EACH ROW EXECUTE FUNCTION public.tg_assign_invoice_number();

DROP TRIGGER IF EXISTS tg_folios_updated ON public.folios;
CREATE TRIGGER tg_folios_updated BEFORE UPDATE ON public.folios
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.get_or_create_folio(_booking_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid; v_prop uuid;
BEGIN
  SELECT id INTO v_id FROM public.folios WHERE booking_id = _booking_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT property_id INTO v_prop FROM public.bookings WHERE id = _booking_id;
  IF v_prop IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  INSERT INTO public.folios (property_id, booking_id, created_by)
    VALUES (v_prop, _booking_id, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE INDEX IF NOT EXISTS idx_folios_property ON public.folios(property_id,status);
CREATE INDEX IF NOT EXISTS idx_folio_charges_folio ON public.folio_charges(folio_id);
CREATE INDEX IF NOT EXISTS idx_payments_folio ON public.payments(folio_id);
CREATE INDEX IF NOT EXISTS idx_payments_property ON public.payments(property_id, paid_at DESC);
