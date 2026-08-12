ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name text
  GENERATED ALWAYS AS (COALESCE(NULLIF(btrim(name), ''), email)) STORED;