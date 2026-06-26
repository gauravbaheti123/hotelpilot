
-- 1. bill_sequences: explicit deny policies for write paths via PostgREST.
-- The get_next_bill_number SECURITY DEFINER function continues to manage sequences server-side.
DROP POLICY IF EXISTS "no client insert bill_sequences" ON public.bill_sequences;
CREATE POLICY "no client insert bill_sequences" ON public.bill_sequences
  FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "no client update bill_sequences" ON public.bill_sequences;
CREATE POLICY "no client update bill_sequences" ON public.bill_sequences
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "no client delete bill_sequences" ON public.bill_sequences;
CREATE POLICY "no client delete bill_sequences" ON public.bill_sequences
  FOR DELETE TO authenticated USING (false);

-- 2. mis_ledger insert: require mis_account_id to belong to the same property.
DROP POLICY IF EXISTS "mis_ledger manager insert" ON public.mis_ledger;
CREATE POLICY "mis_ledger manager insert" ON public.mis_ledger
  FOR INSERT TO authenticated
  WITH CHECK (
    can_manage_masters(auth.uid())
    AND user_has_property(auth.uid(), property_id)
    AND (
      mis_account_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.mis_accounts a
         WHERE a.id = mis_ledger.mis_account_id
           AND a.property_id = mis_ledger.property_id
      )
    )
  );

-- Apply matching restriction to UPDATE so account swaps stay property-scoped.
DROP POLICY IF EXISTS "mis_ledger owner update" ON public.mis_ledger;
CREATE POLICY "mis_ledger owner update" ON public.mis_ledger
  FOR UPDATE TO authenticated
  USING (is_owner_or_super(auth.uid()) AND user_has_property(auth.uid(), property_id))
  WITH CHECK (
    is_owner_or_super(auth.uid())
    AND user_has_property(auth.uid(), property_id)
    AND (
      mis_account_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.mis_accounts a
         WHERE a.id = mis_ledger.mis_account_id
           AND a.property_id = mis_ledger.property_id
      )
    )
  );
