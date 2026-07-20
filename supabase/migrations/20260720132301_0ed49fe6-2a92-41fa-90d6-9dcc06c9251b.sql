ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS checkout_grace_time TIME NOT NULL DEFAULT '14:30:00';