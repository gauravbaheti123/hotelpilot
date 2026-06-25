
-- 1) Extend day_closures with cash position fields
ALTER TABLE public.day_closures
  ADD COLUMN IF NOT EXISTS opening_cash         NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closing_cash_expected NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS closing_cash_actual   NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_difference       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expense_total         NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 2) night_audit_reports
CREATE TABLE IF NOT EXISTS public.night_audit_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  audit_date DATE NOT NULL,
  closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  occupancy_count INTEGER NOT NULL DEFAULT 0,
  rooms_total INTEGER NOT NULL DEFAULT 0,
  total_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  room_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  food_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  banquet_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_collections NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_expenses NUMERIC(12,2) NOT NULL DEFAULT 0,
  opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
  closing_cash_expected NUMERIC(12,2) NOT NULL DEFAULT 0,
  closing_cash_actual NUMERIC(12,2) NOT NULL DEFAULT 0,
  cash_difference NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  report_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(property_id, audit_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.night_audit_reports TO authenticated;
GRANT ALL ON public.night_audit_reports TO service_role;

ALTER TABLE public.night_audit_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant view night_audit_reports" ON public.night_audit_reports;
CREATE POLICY "tenant view night_audit_reports"
  ON public.night_audit_reports
  FOR SELECT TO authenticated
  USING (public.user_has_property(auth.uid(), property_id));

DROP POLICY IF EXISTS "tenant insert night_audit_reports" ON public.night_audit_reports;
CREATE POLICY "tenant insert night_audit_reports"
  ON public.night_audit_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_property(auth.uid(), property_id)
    AND public.can_billing(auth.uid())
  );

DROP POLICY IF EXISTS "owner update night_audit_reports" ON public.night_audit_reports;
CREATE POLICY "owner update night_audit_reports"
  ON public.night_audit_reports
  FOR UPDATE TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.is_owner_or_super(auth.uid()))
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND public.is_owner_or_super(auth.uid()));

DROP POLICY IF EXISTS "owner delete night_audit_reports" ON public.night_audit_reports;
CREATE POLICY "owner delete night_audit_reports"
  ON public.night_audit_reports
  FOR DELETE TO authenticated
  USING (public.user_has_property(auth.uid(), property_id) AND public.is_owner_or_super(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_nar_property_date ON public.night_audit_reports(property_id, audit_date DESC);

-- 3) Day-lock helpers
CREATE OR REPLACE FUNCTION public.is_day_locked(_property_id UUID, _d DATE)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.night_audit_reports
     WHERE property_id = _property_id AND audit_date >= _d
  ) OR EXISTS (
    SELECT 1 FROM public.day_closures
     WHERE property_id = _property_id AND business_date >= _d
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_day_locked(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_day_locked(UUID, DATE) TO authenticated, service_role;
