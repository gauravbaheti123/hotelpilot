DO $mig$
DECLARE d text; o text; n text;
BEGIN
  d := pg_get_functiondef('public.tg_booking_rooms_no_overlap'::regproc);
  o := E'AND OLD.check_in < br.check_out AND OLD.check_out > br.check_in)';
  n := E'AND OLD.check_in < br.check_out AND OLD.check_out > br.check_in\n              AND GREATEST(NEW.check_in, br.check_in) >= GREATEST(OLD.check_in, br.check_in)\n              AND LEAST(NEW.check_out, br.check_out) <= LEAST(OLD.check_out, br.check_out))';
  IF position('GREATEST(NEW.check_in, br.check_in)' in d) = 0 THEN
    IF position(o in d) = 0 THEN RAISE EXCEPTION 'patch target not found'; END IF;
    d := replace(d, o, n);
    EXECUTE d;
  END IF;
END $mig$;