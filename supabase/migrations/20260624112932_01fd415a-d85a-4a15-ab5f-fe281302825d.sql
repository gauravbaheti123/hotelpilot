
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_guests_tags ON public.guests USING gin (tags);
