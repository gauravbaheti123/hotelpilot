ALTER TABLE public.room_status_color_settings
  DROP CONSTRAINT room_status_color_settings_status_check;

ALTER TABLE public.room_status_color_settings
  ADD CONSTRAINT room_status_color_settings_status_check
  CHECK (status = ANY (ARRAY[
    'vacant'::text, 'occupied'::text, 'dirty'::text, 'maintenance'::text,
    'overdue'::text, 'event'::text, 'event_in'::text,
    'segment_pending'::text, 'segment_clear'::text
  ]));