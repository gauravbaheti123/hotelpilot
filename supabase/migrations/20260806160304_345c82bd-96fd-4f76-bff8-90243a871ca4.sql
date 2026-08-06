-- Permission-driven, pre-checkout-only edit/delete of punch line items
DROP POLICY IF EXISTS segment_bill_items_update ON public.segment_bill_items;
CREATE POLICY segment_bill_items_update ON public.segment_bill_items
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.segment_bills sb
  WHERE sb.id = segment_bill_items.segment_bill_id
    AND (
      public.is_owner_or_super(auth.uid())
      OR (sb.status = 'open' AND public.has_permission(auth.uid(), sb.property_id, 'all_kots', 'edit'))
    )
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.segment_bills sb
  WHERE sb.id = segment_bill_items.segment_bill_id
    AND (
      public.is_owner_or_super(auth.uid())
      OR (sb.status = 'open' AND public.has_permission(auth.uid(), sb.property_id, 'all_kots', 'edit'))
    )
));

DROP POLICY IF EXISTS segment_bill_items_delete ON public.segment_bill_items;
CREATE POLICY segment_bill_items_delete ON public.segment_bill_items
FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.segment_bills sb
  WHERE sb.id = segment_bill_items.segment_bill_id
    AND (
      public.is_owner_or_super(auth.uid())
      OR (sb.status = 'open' AND public.has_permission(auth.uid(), sb.property_id, 'all_kots', 'delete'))
    )
));

-- Bill totals must be recalculable by the same users
DROP POLICY IF EXISTS segment_bills_update ON public.segment_bills;
CREATE POLICY segment_bills_update ON public.segment_bills
FOR UPDATE TO authenticated
USING (
  public.can_billing(auth.uid(), property_id)
  OR (status = 'open' AND public.has_permission(auth.uid(), property_id, 'all_kots', 'edit'))
)
WITH CHECK (
  public.can_billing(auth.uid(), property_id)
  OR (status = 'open' AND public.has_permission(auth.uid(), property_id, 'all_kots', 'edit'))
);

-- Grant all_kots edit/delete to every role
INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.module = 'all_kots' AND p.action IN ('edit', 'delete')
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = true;
