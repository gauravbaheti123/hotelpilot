-- Vendors: allow read + quick-add for expenses users (write/edit unchanged)
DROP POLICY IF EXISTS vendors_view ON public.vendors;
CREATE POLICY vendors_view ON public.vendors FOR SELECT
USING (
  has_permission(auth.uid(), property_id, 'inventory'::text, 'view'::text)
  OR has_permission(auth.uid(), property_id, 'expenses'::text, 'view'::text)
);

DROP POLICY IF EXISTS vendors_create ON public.vendors;
CREATE POLICY vendors_create ON public.vendors FOR INSERT
WITH CHECK (
  has_permission(auth.uid(), property_id, 'inventory'::text, 'create'::text)
  OR has_permission(auth.uid(), property_id, 'expenses'::text, 'create'::text)
);

-- Staff: allow read + quick-add for expenses users (write/edit unchanged)
DROP POLICY IF EXISTS staff_view ON public.staff;
CREATE POLICY staff_view ON public.staff FOR SELECT
USING (
  has_permission(auth.uid(), property_id, 'staff_hr'::text, 'view'::text)
  OR has_permission(auth.uid(), property_id, 'expenses'::text, 'view'::text)
);

DROP POLICY IF EXISTS staff_create ON public.staff;
CREATE POLICY staff_create ON public.staff FOR INSERT
WITH CHECK (
  has_permission(auth.uid(), property_id, 'staff_hr'::text, 'create'::text)
  OR has_permission(auth.uid(), property_id, 'expenses'::text, 'create'::text)
);

-- Expense categories: quick-add for expenses users (edit/delete unchanged)
DROP POLICY IF EXISTS expense_categories_create ON public.expense_categories;
CREATE POLICY expense_categories_create ON public.expense_categories FOR INSERT
WITH CHECK (
  has_permission(auth.uid(), property_id, 'master_data'::text, 'create'::text)
  OR has_permission(auth.uid(), property_id, 'expenses'::text, 'create'::text)
);
