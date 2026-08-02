ALTER TABLE public.banquet_bookings ALTER COLUMN hall_id DROP NOT NULL;

ALTER TABLE public.event_room_blocks
  ADD COLUMN IF NOT EXISTS checkin_time time without time zone NOT NULL DEFAULT '12:00',
  ADD COLUMN IF NOT EXISTS checkout_time time without time zone NOT NULL DEFAULT '11:00';

ALTER TABLE public.banquet_bulk_rooms
  ADD COLUMN IF NOT EXISTS guest_name text,
  ADD COLUMN IF NOT EXISTS guest_mobile text,
  ADD COLUMN IF NOT EXISTS check_in_time time without time zone NOT NULL DEFAULT '12:00',
  ADD COLUMN IF NOT EXISTS check_out_time time without time zone NOT NULL DEFAULT '11:00';