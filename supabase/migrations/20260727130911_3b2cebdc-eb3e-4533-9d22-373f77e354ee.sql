ALTER TABLE public.sundry_items ADD COLUMN IF NOT EXISTS short_code text;
CREATE INDEX IF NOT EXISTS sundry_items_property_short_code_idx
  ON public.sundry_items (property_id, lower(short_code))
  WHERE short_code IS NOT NULL AND short_code <> '';