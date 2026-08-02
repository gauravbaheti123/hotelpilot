ALTER TABLE public.banquet_bookings
  ADD COLUMN IF NOT EXISTS host_name text,
  ADD COLUMN IF NOT EXISTS host_mobile text,
  ADD COLUMN IF NOT EXISTS host_email text;

UPDATE public.banquet_bookings b
SET host_name = COALESCE(b.host_name, g.name),
    host_mobile = COALESCE(b.host_mobile, g.mobile),
    host_email = COALESCE(b.host_email, g.email)
FROM public.guests g
WHERE g.id = b.guest_id AND b.host_name IS NULL;