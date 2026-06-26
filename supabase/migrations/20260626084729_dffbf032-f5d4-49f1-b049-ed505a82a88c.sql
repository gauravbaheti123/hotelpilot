
ALTER TABLE public.banquet_bookings DROP CONSTRAINT IF EXISTS banquet_bookings_status_check;
ALTER TABLE public.banquet_bookings ADD CONSTRAINT banquet_bookings_status_check
  CHECK (status = ANY (ARRAY['reserved','confirmed','in_progress','completed','cancelled']));
ALTER TABLE public.banquet_bookings
  ADD COLUMN IF NOT EXISTS extra_charge_description text,
  ADD COLUMN IF NOT EXISTS advance_payment_mode text;
