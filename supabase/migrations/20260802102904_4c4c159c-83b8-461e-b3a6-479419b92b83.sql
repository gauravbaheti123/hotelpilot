ALTER TABLE public.guests DROP COLUMN IF EXISTS nation;
UPDATE public.guests SET country = 'India' WHERE country IS NULL OR btrim(country) = '';
ALTER TABLE public.guests ALTER COLUMN country SET DEFAULT 'India';