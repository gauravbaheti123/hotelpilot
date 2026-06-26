
-- Link bookings to banquet events
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.banquet_bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_event_id ON public.bookings(event_id);

-- Fix the stale event_room_blocks row for Room 401 (booking is already checked_out)
UPDATE public.event_room_blocks
   SET status = 'checked_out',
       checked_out_at = COALESCE(checked_out_at, now()),
       updated_at = now()
 WHERE booking_id IN (
   SELECT id FROM public.bookings WHERE status = 'checked_out'
 ) AND status = 'checked_in';
