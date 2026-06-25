
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_mode_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_mode_check
  CHECK (mode IN ('cash','card','upi','bank','bank_transfer','wallet','complimentary','other'));
