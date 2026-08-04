-- Batch 6: RLS performance rewrite for finance/master-data tables.
-- Only the has_permission(...) wrapping changes; access semantics identical.

-- billing_companies
DROP POLICY billing_companies_view ON public.billing_companies;
CREATE POLICY billing_companies_view ON public.billing_companies FOR SELECT USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','view'))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'invoices','view'))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'pos','view'))
);
DROP POLICY billing_companies_create ON public.billing_companies;
CREATE POLICY billing_companies_create ON public.billing_companies FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','create'))
);
DROP POLICY billing_companies_edit ON public.billing_companies;
CREATE POLICY billing_companies_edit ON public.billing_companies FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
);
DROP POLICY billing_companies_delete ON public.billing_companies;
CREATE POLICY billing_companies_delete ON public.billing_companies FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','delete'))
);

-- expense_categories
DROP POLICY expense_categories_view ON public.expense_categories;
CREATE POLICY expense_categories_view ON public.expense_categories FOR SELECT USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','view'))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'expenses','view'))
);
DROP POLICY expense_categories_create ON public.expense_categories;
CREATE POLICY expense_categories_create ON public.expense_categories FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','create'))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'expenses','create'))
);
DROP POLICY expense_categories_edit ON public.expense_categories;
CREATE POLICY expense_categories_edit ON public.expense_categories FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
);
DROP POLICY expense_categories_delete ON public.expense_categories;
CREATE POLICY expense_categories_delete ON public.expense_categories FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','delete'))
);

-- expenses
DROP POLICY expenses_view ON public.expenses;
CREATE POLICY expenses_view ON public.expenses FOR SELECT USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'expenses','view'))
);
DROP POLICY expenses_create ON public.expenses;
CREATE POLICY expenses_create ON public.expenses FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'expenses','create'))
);
DROP POLICY expenses_edit ON public.expenses;
CREATE POLICY expenses_edit ON public.expenses FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'expenses','edit'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'expenses','edit'))
);
DROP POLICY expenses_delete ON public.expenses;
CREATE POLICY expenses_delete ON public.expenses FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'expenses','delete'))
);

-- gst_slabs (view policy uses user_has_property -> untouched)
DROP POLICY gst_slabs_create ON public.gst_slabs;
CREATE POLICY gst_slabs_create ON public.gst_slabs FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','create'))
);
DROP POLICY gst_slabs_edit ON public.gst_slabs;
CREATE POLICY gst_slabs_edit ON public.gst_slabs FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
);
DROP POLICY gst_slabs_delete ON public.gst_slabs;
CREATE POLICY gst_slabs_delete ON public.gst_slabs FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','delete'))
);

-- inventory_items
DROP POLICY inventory_items_view ON public.inventory_items;
CREATE POLICY inventory_items_view ON public.inventory_items FOR SELECT USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'inventory','view'))
);
DROP POLICY inventory_items_create ON public.inventory_items;
CREATE POLICY inventory_items_create ON public.inventory_items FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'inventory','create'))
);
DROP POLICY inventory_items_edit ON public.inventory_items;
CREATE POLICY inventory_items_edit ON public.inventory_items FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'inventory','edit'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'inventory','edit'))
);
DROP POLICY inventory_items_delete ON public.inventory_items;
CREATE POLICY inventory_items_delete ON public.inventory_items FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'inventory','delete'))
);

-- stock_movements
DROP POLICY stock_movements_view ON public.stock_movements;
CREATE POLICY stock_movements_view ON public.stock_movements FOR SELECT USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'inventory','view'))
);
DROP POLICY stock_movements_create ON public.stock_movements;
CREATE POLICY stock_movements_create ON public.stock_movements FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'inventory','create'))
);
DROP POLICY stock_movements_edit ON public.stock_movements;
CREATE POLICY stock_movements_edit ON public.stock_movements FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'inventory','edit'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'inventory','edit'))
);
DROP POLICY stock_movements_delete ON public.stock_movements;
CREATE POLICY stock_movements_delete ON public.stock_movements FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'inventory','delete'))
);

-- vendors
DROP POLICY vendors_view ON public.vendors;
CREATE POLICY vendors_view ON public.vendors FOR SELECT USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'inventory','view'))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'expenses','view'))
);
DROP POLICY vendors_create ON public.vendors;
CREATE POLICY vendors_create ON public.vendors FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'inventory','create'))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'expenses','create'))
);
DROP POLICY vendors_edit ON public.vendors;
CREATE POLICY vendors_edit ON public.vendors FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'inventory','edit'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'inventory','edit'))
);
DROP POLICY vendors_delete ON public.vendors;
CREATE POLICY vendors_delete ON public.vendors FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'inventory','delete'))
);

-- sundry_items
DROP POLICY sundry_items_view ON public.sundry_items;
CREATE POLICY sundry_items_view ON public.sundry_items FOR SELECT USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','view'))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'invoices','view'))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'pos','view'))
);
DROP POLICY sundry_items_create ON public.sundry_items;
CREATE POLICY sundry_items_create ON public.sundry_items FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','create'))
);
DROP POLICY sundry_items_edit ON public.sundry_items;
CREATE POLICY sundry_items_edit ON public.sundry_items FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
);
DROP POLICY sundry_items_delete ON public.sundry_items;
CREATE POLICY sundry_items_delete ON public.sundry_items FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','delete'))
);

-- payment_methods (view policy uses user_roles EXISTS -> untouched)
DROP POLICY payment_methods_create ON public.payment_methods;
CREATE POLICY payment_methods_create ON public.payment_methods FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','create'))
);
DROP POLICY payment_methods_edit ON public.payment_methods;
CREATE POLICY payment_methods_edit ON public.payment_methods FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
);
DROP POLICY payment_methods_delete ON public.payment_methods;
CREATE POLICY payment_methods_delete ON public.payment_methods FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','delete'))
);

-- petty_cash_entries (create keeps created_by ownership guard)
DROP POLICY petty_cash_entries_view ON public.petty_cash_entries;
CREATE POLICY petty_cash_entries_view ON public.petty_cash_entries FOR SELECT USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'shift_handover','view'))
);
DROP POLICY petty_cash_entries_create ON public.petty_cash_entries;
CREATE POLICY petty_cash_entries_create ON public.petty_cash_entries FOR INSERT WITH CHECK (
  (
    (SELECT is_superadmin(auth.uid()))
    OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
    OR property_id IN (SELECT permitted_property_ids(auth.uid(),'shift_handover','create'))
  ) AND created_by = auth.uid()
);
DROP POLICY petty_cash_entries_edit ON public.petty_cash_entries;
CREATE POLICY petty_cash_entries_edit ON public.petty_cash_entries FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'shift_handover','create'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'shift_handover','create'))
);
DROP POLICY petty_cash_entries_delete ON public.petty_cash_entries;
CREATE POLICY petty_cash_entries_delete ON public.petty_cash_entries FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'shift_handover','delete'))
);

-- pos_categories
DROP POLICY pos_categories_view ON public.pos_categories;
CREATE POLICY pos_categories_view ON public.pos_categories FOR SELECT USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','view'))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'pos','view'))
);
DROP POLICY pos_categories_create ON public.pos_categories;
CREATE POLICY pos_categories_create ON public.pos_categories FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','create'))
);
DROP POLICY pos_categories_edit ON public.pos_categories;
CREATE POLICY pos_categories_edit ON public.pos_categories FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
);
DROP POLICY pos_categories_delete ON public.pos_categories;
CREATE POLICY pos_categories_delete ON public.pos_categories FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','delete'))
);

-- restaurant_outlets (view retains its extra superadmin / property-membership clauses)
DROP POLICY restaurant_outlets_view ON public.restaurant_outlets;
CREATE POLICY restaurant_outlets_view ON public.restaurant_outlets FOR SELECT USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','view'))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'pos','view'))
  OR property_id IN (SELECT ur.property_id FROM public.user_roles ur WHERE ur.user_id = auth.uid())
);
DROP POLICY restaurant_outlets_create ON public.restaurant_outlets;
CREATE POLICY restaurant_outlets_create ON public.restaurant_outlets FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','create'))
);
DROP POLICY restaurant_outlets_edit ON public.restaurant_outlets;
CREATE POLICY restaurant_outlets_edit ON public.restaurant_outlets FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
);
DROP POLICY restaurant_outlets_delete ON public.restaurant_outlets;
CREATE POLICY restaurant_outlets_delete ON public.restaurant_outlets FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','delete'))
);
