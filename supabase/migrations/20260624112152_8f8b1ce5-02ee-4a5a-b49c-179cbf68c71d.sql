
CREATE TABLE public.day_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  business_date date NOT NULL,
  rooms_occupied int NOT NULL DEFAULT 0,
  rooms_available int NOT NULL DEFAULT 0,
  sub_total numeric(12,2) NOT NULL DEFAULT 0,
  gst_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  cash_total numeric(12,2) NOT NULL DEFAULT 0,
  card_total numeric(12,2) NOT NULL DEFAULT 0,
  upi_total numeric(12,2) NOT NULL DEFAULT 0,
  bank_total numeric(12,2) NOT NULL DEFAULT 0,
  other_total numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (property_id, business_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.day_closures TO authenticated;
GRANT ALL ON public.day_closures TO service_role;

ALTER TABLE public.day_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Billing read day_closures" ON public.day_closures
  FOR SELECT TO authenticated
  USING (public.can_billing(auth.uid()));

CREATE POLICY "Billing write day_closures" ON public.day_closures
  FOR INSERT TO authenticated
  WITH CHECK (public.can_billing(auth.uid()));

CREATE INDEX idx_day_closures_property_date
  ON public.day_closures (property_id, business_date DESC);
