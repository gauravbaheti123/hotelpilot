ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS nation text NOT NULL DEFAULT 'India';

ALTER TABLE public.billing_companies
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS nation text NOT NULL DEFAULT 'India';