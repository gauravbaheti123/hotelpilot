
-- Feature 1: Restaurant direct billing (ledger posting)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS restaurant_ledger_balance NUMERIC(10,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.restaurant_direct_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  guest_id UUID REFERENCES public.guests(id) ON DELETE SET NULL,
  amount NUMERIC(10,2) NOT NULL,
  description TEXT DEFAULT 'Restaurant Charge',
  charge_date DATE NOT NULL DEFAULT CURRENT_DATE,
  posted_by UUID REFERENCES public.profiles(id),
  is_settled BOOLEAN NOT NULL DEFAULT FALSE,
  settled_at TIMESTAMPTZ,
  settled_by UUID REFERENCES public.profiles(id),
  folio_charge_id UUID REFERENCES public.folio_charges(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_direct_charges TO authenticated;
GRANT ALL ON public.restaurant_direct_charges TO service_role;
ALTER TABLE public.restaurant_direct_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access" ON public.restaurant_direct_charges
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id))
  WITH CHECK (public.user_has_property(auth.uid(), property_id));

CREATE TABLE IF NOT EXISTS public.restaurant_payables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  charge_id UUID REFERENCES public.restaurant_direct_charges(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  description TEXT,
  charge_date DATE NOT NULL,
  is_settled BOOLEAN NOT NULL DEFAULT FALSE,
  settlement_date DATE,
  settlement_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_payables TO authenticated;
GRANT ALL ON public.restaurant_payables TO service_role;
ALTER TABLE public.restaurant_payables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access" ON public.restaurant_payables
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id))
  WITH CHECK (public.user_has_property(auth.uid(), property_id));

-- Feature 2: ID document upload (Google Drive)
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS id_document_url TEXT,
  ADD COLUMN IF NOT EXISTS id_document_name TEXT,
  ADD COLUMN IF NOT EXISTS id_document_uploaded_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.guest_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  guest_id UUID REFERENCES public.guests(id) ON DELETE SET NULL,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  document_name TEXT,
  drive_file_id TEXT,
  drive_view_url TEXT,
  drive_folder_path TEXT,
  uploaded_by UUID REFERENCES public.profiles(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guest_documents TO authenticated;
GRANT ALL ON public.guest_documents TO service_role;
ALTER TABLE public.guest_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access" ON public.guest_documents
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id))
  WITH CHECK (public.user_has_property(auth.uid(), property_id));
