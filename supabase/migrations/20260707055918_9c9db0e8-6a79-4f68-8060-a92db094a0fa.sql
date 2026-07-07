ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS short_code text;
CREATE UNIQUE INDEX IF NOT EXISTS menu_items_property_short_code_uniq
  ON public.menu_items (property_id, lower(short_code))
  WHERE short_code IS NOT NULL AND short_code <> '';