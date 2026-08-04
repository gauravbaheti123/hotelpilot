-- Batch 5: staff/HR tables RLS performance rewrite (semantics-preserving)

-- ============ staff ============
DROP POLICY IF EXISTS staff_view ON public.staff;
CREATE POLICY staff_view ON public.staff FOR SELECT USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'staff_hr', 'view'))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'expenses', 'view'))
);

DROP POLICY IF EXISTS staff_create ON public.staff;
CREATE POLICY staff_create ON public.staff FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'staff_hr', 'create'))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'expenses', 'create'))
);

DROP POLICY IF EXISTS staff_edit ON public.staff;
CREATE POLICY staff_edit ON public.staff FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'staff_hr', 'edit'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'staff_hr', 'edit'))
);

DROP POLICY IF EXISTS staff_delete ON public.staff;
CREATE POLICY staff_delete ON public.staff FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'staff_hr', 'delete'))
);

-- ============ attendance ============
DROP POLICY IF EXISTS attendance_view ON public.attendance;
CREATE POLICY attendance_view ON public.attendance FOR SELECT USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'staff_hr', 'view'))
);

DROP POLICY IF EXISTS attendance_create ON public.attendance;
CREATE POLICY attendance_create ON public.attendance FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'staff_hr', 'create'))
);

DROP POLICY IF EXISTS attendance_edit ON public.attendance;
CREATE POLICY attendance_edit ON public.attendance FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'staff_hr', 'edit'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'staff_hr', 'edit'))
);

DROP POLICY IF EXISTS attendance_delete ON public.attendance;
CREATE POLICY attendance_delete ON public.attendance FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'staff_hr', 'delete'))
);

-- ============ payroll_runs ============
DROP POLICY IF EXISTS payroll_runs_view ON public.payroll_runs;
CREATE POLICY payroll_runs_view ON public.payroll_runs FOR SELECT USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'staff_hr', 'view'))
);

DROP POLICY IF EXISTS payroll_runs_create ON public.payroll_runs;
CREATE POLICY payroll_runs_create ON public.payroll_runs FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'staff_hr', 'create'))
);

DROP POLICY IF EXISTS payroll_runs_edit ON public.payroll_runs;
CREATE POLICY payroll_runs_edit ON public.payroll_runs FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'staff_hr', 'edit'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'staff_hr', 'edit'))
);

DROP POLICY IF EXISTS payroll_runs_delete ON public.payroll_runs;
CREATE POLICY payroll_runs_delete ON public.payroll_runs FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(), 'staff_hr', 'delete'))
);