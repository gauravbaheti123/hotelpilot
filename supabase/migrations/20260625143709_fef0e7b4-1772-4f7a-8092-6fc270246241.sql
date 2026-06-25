
CREATE TABLE IF NOT EXISTS public.mis_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID UNIQUE REFERENCES public.properties(id) ON DELETE CASCADE,
  name TEXT DEFAULT 'MIS Account',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mis_accounts TO authenticated;
GRANT ALL ON public.mis_accounts TO service_role;
ALTER TABLE public.mis_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "property_mis_accounts" ON public.mis_accounts;
CREATE POLICY "property_mis_accounts" ON public.mis_accounts
  FOR ALL TO authenticated
  USING (public.is_superadmin(auth.uid()) OR public.user_has_property(auth.uid(), property_id))
  WITH CHECK (public.is_superadmin(auth.uid()) OR public.user_has_property(auth.uid(), property_id));

CREATE TABLE IF NOT EXISTS public.mis_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
  mis_account_id UUID REFERENCES public.mis_accounts(id) ON DELETE SET NULL,
  source_bill_id UUID,
  source_bill_number TEXT,
  source_booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  source_room_number TEXT,
  source_guest_name TEXT,
  source_guest_id UUID REFERENCES public.guests(id) ON DELETE SET NULL,
  amount NUMERIC(12,2) NOT NULL,
  description TEXT,
  line_items JSONB DEFAULT '[]'::jsonb,
  shifted_by UUID,
  shifted_by_name TEXT,
  shifted_at TIMESTAMPTZ DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_by UUID,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mis_ledger_property_idx ON public.mis_ledger(property_id, shifted_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mis_ledger TO authenticated;
GRANT ALL ON public.mis_ledger TO service_role;
ALTER TABLE public.mis_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "property_mis_ledger" ON public.mis_ledger;
CREATE POLICY "property_mis_ledger" ON public.mis_ledger
  FOR ALL TO authenticated
  USING (public.is_superadmin(auth.uid()) OR public.user_has_property(auth.uid(), property_id))
  WITH CHECK (public.is_superadmin(auth.uid()) OR public.user_has_property(auth.uid(), property_id));

CREATE OR REPLACE FUNCTION public.create_mis_for_property()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.mis_accounts (property_id) VALUES (NEW.id)
    ON CONFLICT (property_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trigger_create_mis ON public.properties;
CREATE TRIGGER trigger_create_mis
  AFTER INSERT ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.create_mis_for_property();

INSERT INTO public.mis_accounts (property_id)
  SELECT id FROM public.properties
  ON CONFLICT (property_id) DO NOTHING;

ALTER TABLE public.folios
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_by UUID,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
