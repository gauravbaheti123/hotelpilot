CREATE TABLE public.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  attendance_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL CHECK (status IN ('present','absent','half_day','leave','week_off')),
  check_in time,
  check_out time,
  hours_worked numeric(5,2) NOT NULL DEFAULT 0,
  notes text,
  marked_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, staff_id, attendance_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance TO authenticated;
GRANT ALL ON public.attendance TO service_role;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_rw" ON public.attendance FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid()))
  WITH CHECK (public.can_manage_masters(auth.uid()));
CREATE INDEX idx_att_property_date ON public.attendance(property_id, attendance_date DESC);
CREATE INDEX idx_att_staff_date ON public.attendance(staff_id, attendance_date DESC);

CREATE TABLE public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  gross_salary numeric(12,2) NOT NULL DEFAULT 0,
  present_days numeric(5,2) NOT NULL DEFAULT 0,
  absent_days numeric(5,2) NOT NULL DEFAULT 0,
  total_days int NOT NULL DEFAULT 30,
  deductions numeric(12,2) NOT NULL DEFAULT 0,
  bonus numeric(12,2) NOT NULL DEFAULT 0,
  advance numeric(12,2) NOT NULL DEFAULT 0,
  net_pay numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','paid')),
  paid_at timestamptz,
  paid_via text CHECK (paid_via IN ('cash','card','upi','bank')),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, staff_id, period_month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_runs TO authenticated;
GRANT ALL ON public.payroll_runs TO service_role;
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payroll_rw" ON public.payroll_runs FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid()))
  WITH CHECK (public.can_manage_masters(auth.uid()));
CREATE INDEX idx_payroll_property_period ON public.payroll_runs(property_id, period_month DESC);

CREATE TRIGGER trg_att_updated BEFORE UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER trg_payroll_updated BEFORE UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();