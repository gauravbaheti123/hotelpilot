ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS food_gst_rate integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS sundry_gst_rate integer NOT NULL DEFAULT 18;