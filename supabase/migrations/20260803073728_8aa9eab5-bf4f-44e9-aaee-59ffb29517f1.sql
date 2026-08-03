ALTER TABLE public.restaurant_direct_charges ADD COLUMN IF NOT EXISTS bill_no text;
ALTER TABLE public.restaurant_payables ADD COLUMN IF NOT EXISTS bill_no text;