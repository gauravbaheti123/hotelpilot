
-- Line-item discount columns on folio_charges
ALTER TABLE public.folio_charges
  ADD COLUMN IF NOT EXISTS discount_type text,
  ADD COLUMN IF NOT EXISTS discount_value numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.folio_charges
  DROP CONSTRAINT IF EXISTS folio_charges_discount_type_chk;
ALTER TABLE public.folio_charges
  ADD CONSTRAINT folio_charges_discount_type_chk
  CHECK (discount_type IS NULL OR discount_type IN ('percent','amount'));

-- Bill-level discount type/value on folios (discount_amount already exists)
ALTER TABLE public.folios
  ADD COLUMN IF NOT EXISTS discount_type text,
  ADD COLUMN IF NOT EXISTS discount_value numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.folios
  DROP CONSTRAINT IF EXISTS folios_discount_type_chk;
ALTER TABLE public.folios
  ADD CONSTRAINT folios_discount_type_chk
  CHECK (discount_type IS NULL OR discount_type IN ('percent','amount'));

-- Helper RPC: return current user's max discount %  (uses existing user_max_discount_pct)
CREATE OR REPLACE FUNCTION public.current_user_max_discount_pct(_property_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_max_discount_pct(auth.uid(), _property_id)
$$;

GRANT EXECUTE ON FUNCTION public.current_user_max_discount_pct(uuid) TO authenticated;
