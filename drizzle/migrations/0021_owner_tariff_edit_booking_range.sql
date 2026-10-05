DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.split_room_night(uuid,date,numeric)'::regprocedure);
  d := replace(d, $r$    IF _night < v_br.check_in OR _night >= v_br.check_out THEN
      RAISE EXCEPTION 'That night is not part of this stay';
    END IF;$r$,
    $r$    IF NOT EXISTS (SELECT 1 FROM public.booking_rooms b2
                    WHERE b2.booking_id = v_br.booking_id AND b2.room_id = v_br.room_id
                      AND _night >= b2.check_in AND _night < b2.check_out)
       AND NOT EXISTS (SELECT 1 FROM public.bookings bk
                    WHERE bk.id = v_br.booking_id AND _night >= bk.check_in::date AND _night < bk.check_out::date) THEN
      RAISE EXCEPTION 'That night is not part of this stay';
    END IF;$r$);
  EXECUTE d;
END $do$;