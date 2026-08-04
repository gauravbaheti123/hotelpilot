CREATE OR REPLACE FUNCTION public.generate_system_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- 3a. Upcoming arrivals — reservations checking in today, not yet checked in
  INSERT INTO public.reminders (property_id, type, category, related_record_id, title, message, notes, reminder_datetime)
  SELECT
    b.property_id,
    'system',
    'reservation_arrival',
    b.id,
    'Arriving today: ' || COALESCE(b.booking_number, 'Reservation'),
    'Reservation check-in ' || to_char(b.check_in, 'DD Mon YYYY') || ' — not yet checked in.',
    NULL,
    now()
  FROM public.bookings b
  WHERE b.status = 'reserved'
    AND b.check_in = CURRENT_DATE
    AND NOT b.is_wiped
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 3b. Pending payment on bookings due to check out today or overdue
  INSERT INTO public.reminders (property_id, type, category, related_record_id, title, message, notes, reminder_datetime)
  SELECT
    b.property_id,
    'system',
    'payment_pending',
    b.id,
    'Pending payment: ' || COALESCE(b.booking_number, 'Booking'),
    'Balance ₹' || to_char(COALESCE(b.balance_amount, 0), 'FM999,999,990.00') || ' — checkout ' || to_char(b.check_out, 'DD Mon'),
    NULL,
    now()
  FROM public.bookings b
  WHERE b.status IN ('checked_in','reserved')
    AND COALESCE(b.balance_amount, 0) > 0
    AND b.check_out <= CURRENT_DATE
    AND NOT b.is_wiped
  ON CONFLICT DO NOTHING;

  RETURN v_count;
END;
$$;