
-- Banquet bill discount support: bill-level type/value + JSONB line discounts for the 4 fixed lines
ALTER TABLE public.banquet_bookings
  ADD COLUMN IF NOT EXISTS discount_type text CHECK (discount_type IN ('percent','amount')),
  ADD COLUMN IF NOT EXISTS discount_value numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_discounts jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Room-block line-item discount columns (mirrors folio_charges pattern)
ALTER TABLE public.banquet_bulk_rooms
  ADD COLUMN IF NOT EXISTS discount_type text CHECK (discount_type IN ('percent','amount')),
  ADD COLUMN IF NOT EXISTS discount_value numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2) NOT NULL DEFAULT 0;
