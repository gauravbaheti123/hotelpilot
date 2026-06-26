
ALTER TABLE public.properties
  ALTER COLUMN invoice_template SET DEFAULT 'premium';
UPDATE public.properties SET invoice_template = 'premium'
  WHERE invoice_template IS NULL OR invoice_template IN ('classic','modern','minimal');
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS use_gst_slabs BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.gst_slabs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  from_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  to_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gst_slabs_property ON public.gst_slabs(property_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gst_slabs TO authenticated;
GRANT ALL ON public.gst_slabs TO service_role;
ALTER TABLE public.gst_slabs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "view gst_slabs" ON public.gst_slabs;
DROP POLICY IF EXISTS "manage gst_slabs" ON public.gst_slabs;
CREATE POLICY "view gst_slabs" ON public.gst_slabs FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage gst_slabs" ON public.gst_slabs FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid()))
  WITH CHECK (public.can_manage_masters(auth.uid()));

CREATE TABLE IF NOT EXISTS public.event_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.banquet_bookings(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  payment_mode TEXT NOT NULL DEFAULT 'cash',
  reference TEXT,
  notes TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_payments_event ON public.event_payments(event_id);
CREATE INDEX IF NOT EXISTS idx_event_payments_property ON public.event_payments(property_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_payments TO authenticated;
GRANT ALL ON public.event_payments TO service_role;
ALTER TABLE public.event_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "view event_payments" ON public.event_payments;
DROP POLICY IF EXISTS "manage event_payments" ON public.event_payments;
CREATE POLICY "view event_payments" ON public.event_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage event_payments" ON public.event_payments FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
