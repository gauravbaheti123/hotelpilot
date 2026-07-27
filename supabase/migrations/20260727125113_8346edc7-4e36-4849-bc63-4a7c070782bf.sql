CREATE TABLE public.billing_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  gstin text,
  address text,
  contact_person text,
  phone text,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX billing_companies_property_active_idx
  ON public.billing_companies (property_id, is_active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_companies TO authenticated;
GRANT ALL ON public.billing_companies TO service_role;

ALTER TABLE public.billing_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_companies_view ON public.billing_companies
  FOR SELECT USING (
    public.has_permission(auth.uid(), property_id, 'master_data', 'view')
    OR public.has_permission(auth.uid(), property_id, 'invoices', 'view')
    OR public.has_permission(auth.uid(), property_id, 'pos', 'view')
  );

CREATE POLICY billing_companies_create ON public.billing_companies
  FOR INSERT WITH CHECK (
    public.has_permission(auth.uid(), property_id, 'master_data', 'create')
  );

CREATE POLICY billing_companies_edit ON public.billing_companies
  FOR UPDATE USING (
    public.has_permission(auth.uid(), property_id, 'master_data', 'edit')
  ) WITH CHECK (
    public.has_permission(auth.uid(), property_id, 'master_data', 'edit')
  );

CREATE POLICY billing_companies_delete ON public.billing_companies
  FOR DELETE USING (
    public.has_permission(auth.uid(), property_id, 'master_data', 'delete')
  );

CREATE TRIGGER trg_billing_companies_updated_at
  BEFORE UPDATE ON public.billing_companies
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS billing_company_id uuid REFERENCES public.billing_companies(id) ON DELETE SET NULL;

ALTER TABLE public.folios
  ADD COLUMN IF NOT EXISTS billing_company_id uuid REFERENCES public.billing_companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bookings_billing_company_idx ON public.bookings(billing_company_id);
CREATE INDEX IF NOT EXISTS folios_billing_company_idx ON public.folios(billing_company_id);