ALTER TABLE public.booking_rooms DROP CONSTRAINT IF EXISTS booking_rooms_status_check;
ALTER TABLE public.booking_rooms ADD CONSTRAINT booking_rooms_status_check
  CHECK (status::text = ANY (ARRAY['active','reserved','checked_in','shifted','checked_out','cancelled']));