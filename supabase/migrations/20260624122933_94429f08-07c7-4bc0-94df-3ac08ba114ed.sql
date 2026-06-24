
-- 1. Helper role check
CREATE OR REPLACE FUNCTION public.is_owner_or_super(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'superadmin'::app_role)
      OR public.has_role(_user_id, 'owner'::app_role)
$$;

-- 2. wipe_logs
CREATE TABLE public.wipe_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  initiated_by uuid REFERENCES auth.users(id),
  date_from date NOT NULL,
  date_to date NOT NULL,
  percentage int NOT NULL DEFAULT 100,
  tables_selected text[] NOT NULL DEFAULT '{}',
  record_count int NOT NULL DEFAULT 0,
  wiped_at timestamptz NOT NULL DEFAULT now(),
  is_restored boolean NOT NULL DEFAULT false,
  restored_at timestamptz,
  restored_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.wipe_logs TO authenticated;
GRANT ALL ON public.wipe_logs TO service_role;
ALTER TABLE public.wipe_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wipe_logs read owner+super" ON public.wipe_logs FOR SELECT TO authenticated USING (public.is_owner_or_super(auth.uid()));
CREATE POLICY "wipe_logs write owner+super" ON public.wipe_logs FOR ALL TO authenticated USING (public.is_owner_or_super(auth.uid())) WITH CHECK (public.is_owner_or_super(auth.uid()));

-- 3. wiped_data_archive
CREATE TABLE public.wiped_data_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wipe_log_id uuid NOT NULL REFERENCES public.wipe_logs(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  original_data jsonb NOT NULL,
  wiped_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wiped_archive_log_idx ON public.wiped_data_archive(wipe_log_id);
CREATE INDEX wiped_archive_record_idx ON public.wiped_data_archive(table_name, record_id);
GRANT SELECT ON public.wiped_data_archive TO authenticated;
GRANT ALL ON public.wiped_data_archive TO service_role;
ALTER TABLE public.wiped_data_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wiped_archive read owner+super" ON public.wiped_data_archive FOR SELECT TO authenticated USING (public.is_owner_or_super(auth.uid()));

-- 4. Add wipe columns to transaction tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookings','payments','folio_charges','kot_orders','kot_items','guests','expenses'] LOOP
    EXECUTE format('ALTER TABLE public.%I
        ADD COLUMN IF NOT EXISTS is_wiped boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS wiped_at timestamptz,
        ADD COLUMN IF NOT EXISTS wipe_log_id uuid REFERENCES public.wipe_logs(id) ON DELETE SET NULL', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(is_wiped) WHERE is_wiped = true', t||'_is_wiped_idx', t);
  END LOOP;
END $$;

-- 5. Replace SELECT policies to hide wiped records (owners/superadmins still see for restore)

-- bookings
DROP POLICY IF EXISTS "view bookings" ON public.bookings;
CREATE POLICY "view bookings" ON public.bookings FOR SELECT
  USING ((is_wiped = false OR is_wiped IS NULL) OR public.is_owner_or_super(auth.uid()));

-- guests
DROP POLICY IF EXISTS "view guests" ON public.guests;
CREATE POLICY "view guests" ON public.guests FOR SELECT
  USING ((is_wiped = false OR is_wiped IS NULL) OR public.is_owner_or_super(auth.uid()));

-- payments
DROP POLICY IF EXISTS "Billing read payments" ON public.payments;
CREATE POLICY "Billing read payments" ON public.payments FOR SELECT TO authenticated
  USING (can_billing(auth.uid()) AND ((is_wiped = false OR is_wiped IS NULL) OR public.is_owner_or_super(auth.uid())));

-- folio_charges
DROP POLICY IF EXISTS "Billing read folio_charges" ON public.folio_charges;
CREATE POLICY "Billing read folio_charges" ON public.folio_charges FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.folios f WHERE f.id = folio_charges.folio_id AND can_billing(auth.uid()))
    AND ((is_wiped = false OR is_wiped IS NULL) OR public.is_owner_or_super(auth.uid()))
  );

-- kot_orders
DROP POLICY IF EXISTS "Food staff read kot_orders" ON public.kot_orders;
CREATE POLICY "Food staff read kot_orders" ON public.kot_orders FOR SELECT TO authenticated
  USING (can_food(auth.uid()) AND ((is_wiped = false OR is_wiped IS NULL) OR public.is_owner_or_super(auth.uid())));

-- expenses (the existing policy is FOR ALL; add a tighter SELECT then keep manage policy unaffected by re-creating it strict)
DROP POLICY IF EXISTS "expenses_rw" ON public.expenses;
CREATE POLICY "expenses read" ON public.expenses FOR SELECT TO authenticated
  USING (can_billing(auth.uid()) AND ((is_wiped = false OR is_wiped IS NULL) OR public.is_owner_or_super(auth.uid())));
CREATE POLICY "expenses write" ON public.expenses FOR INSERT TO authenticated WITH CHECK (can_billing(auth.uid()));
CREATE POLICY "expenses update" ON public.expenses FOR UPDATE TO authenticated USING (can_billing(auth.uid())) WITH CHECK (can_billing(auth.uid()));
CREATE POLICY "expenses delete" ON public.expenses FOR DELETE TO authenticated USING (can_billing(auth.uid()));
