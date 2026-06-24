-- Phase 23: Checkout food lock + Cash/GST bill type

-- Add bill_type to folios (mirrors gst_mode for clarity)
ALTER TABLE public.folios
  ADD COLUMN IF NOT EXISTS bill_type text;

-- Backfill from existing gst_mode
UPDATE public.folios
  SET bill_type = CASE WHEN gst_mode = 'gst' THEN 'gst_invoice' ELSE 'cash_bill' END
  WHERE bill_type IS NULL;

ALTER TABLE public.folios
  ALTER COLUMN bill_type SET DEFAULT 'cash_bill';

ALTER TABLE public.folios
  ADD CONSTRAINT folios_bill_type_chk
  CHECK (bill_type IN ('gst_invoice','cash_bill')) NOT VALID;

-- HSN/SAC codes on charges and menu items
ALTER TABLE public.folio_charges
  ADD COLUMN IF NOT EXISTS hsn_code text;
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS hsn_code text;
ALTER TABLE public.room_categories
  ADD COLUMN IF NOT EXISTS hsn_code text;

-- Checkout override audit log
CREATE TABLE IF NOT EXISTS public.checkout_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  folio_id uuid REFERENCES public.folios(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  approver_email text,
  reason text NOT NULL,
  pending_kot_ids uuid[] DEFAULT '{}',
  pending_amount numeric(12,2) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.checkout_overrides TO authenticated;
GRANT ALL ON public.checkout_overrides TO service_role;

ALTER TABLE public.checkout_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "co select billing"
  ON public.checkout_overrides FOR SELECT
  TO authenticated
  USING (public.can_billing(auth.uid()));

CREATE POLICY "co insert billing"
  ON public.checkout_overrides FOR INSERT
  TO authenticated
  WITH CHECK (public.can_billing(auth.uid()));
