
-- ====== MIS ACCOUNTS ======
CREATE TABLE IF NOT EXISTS public.mis_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL UNIQUE REFERENCES public.properties(id) ON DELETE CASCADE,
  name text DEFAULT 'MIS Account',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mis_accounts TO authenticated;
GRANT ALL ON public.mis_accounts TO service_role;

ALTER TABLE public.mis_accounts ENABLE ROW LEVEL SECURITY;

-- Only owners/superadmins can view/manage MIS accounts
CREATE POLICY "mis_accounts owner access" ON public.mis_accounts
  FOR ALL TO authenticated
  USING (public.is_owner_or_super(auth.uid()) AND public.user_has_property(auth.uid(), property_id))
  WITH CHECK (public.is_owner_or_super(auth.uid()) AND public.user_has_property(auth.uid(), property_id));

-- ====== MIS LEDGER ======
CREATE TABLE IF NOT EXISTS public.mis_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  mis_account_id uuid REFERENCES public.mis_accounts(id) ON DELETE SET NULL,

  source_bill_id uuid,
  source_bill_number text,
  source_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  source_room_number text,
  source_guest_name text,
  source_guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,

  amount numeric(10,2) NOT NULL,
  description text,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,

  shifted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  shifted_by_name text,
  shifted_at timestamptz NOT NULL DEFAULT now(),

  is_deleted boolean NOT NULL DEFAULT false,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_mis_ledger_property ON public.mis_ledger(property_id, shifted_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mis_ledger TO authenticated;
GRANT ALL ON public.mis_ledger TO service_role;

ALTER TABLE public.mis_ledger ENABLE ROW LEVEL SECURITY;

-- Manager+Owner+Superadmin can insert (shift action). Only Owner+Superadmin can view/delete.
CREATE POLICY "mis_ledger owner read" ON public.mis_ledger
  FOR SELECT TO authenticated
  USING (public.is_owner_or_super(auth.uid()) AND public.user_has_property(auth.uid(), property_id));

CREATE POLICY "mis_ledger manager insert" ON public.mis_ledger
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_masters(auth.uid()) AND public.user_has_property(auth.uid(), property_id));

CREATE POLICY "mis_ledger owner delete" ON public.mis_ledger
  FOR DELETE TO authenticated
  USING (public.is_owner_or_super(auth.uid()) AND public.user_has_property(auth.uid(), property_id));

CREATE POLICY "mis_ledger owner update" ON public.mis_ledger
  FOR UPDATE TO authenticated
  USING (public.is_owner_or_super(auth.uid()) AND public.user_has_property(auth.uid(), property_id))
  WITH CHECK (public.is_owner_or_super(auth.uid()) AND public.user_has_property(auth.uid(), property_id));

-- ====== Auto-create MIS for new properties ======
CREATE OR REPLACE FUNCTION public.create_mis_for_property()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.mis_accounts (property_id)
  VALUES (NEW.id)
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

-- ====== FOLIO SOFT-DELETE COLUMNS ======
ALTER TABLE public.folios
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_folios_is_deleted ON public.folios(is_deleted) WHERE is_deleted = true;

-- Revoke EXECUTE on the new trigger function from PUBLIC/anon for safety
REVOKE EXECUTE ON FUNCTION public.create_mis_for_property() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_mis_for_property() FROM anon;
