UPDATE public.booking_rooms p
   SET actual_check_out = s.actual_check_out, updated_at = now()
  FROM public.booking_rooms s
 WHERE s.booking_id = p.booking_id
   AND s.id <> p.id
   AND s.room_id = p.room_id
   AND s.status = 'shifted'
   AND s.actual_check_out IS NOT NULL
   AND p.actual_check_out IS NULL
   AND p.status IN ('active','checked_in')
   AND p.check_out <= s.check_out;