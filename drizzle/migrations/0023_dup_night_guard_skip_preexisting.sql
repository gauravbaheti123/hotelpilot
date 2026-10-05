DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.tg_booking_rooms_no_overlap'::regproc);
  IF position('OLD.check_in < br.check_out' in d) = 0 THEN
    d := replace(d,
      E'     AND br.check_in < NEW.check_out\n     AND br.check_out > NEW.check_in\n   LIMIT 1;',
      E'     AND br.check_in < NEW.check_out\n     AND br.check_out > NEW.check_in\n     -- Only block NEW overlaps; rows that already overlapped (legacy duplicates)\n     -- must stay re-activatable so Undo Checkout / restore stay never dead-ends.\n     AND NOT (TG_OP = ''UPDATE'' AND OLD.room_id IS NOT DISTINCT FROM NEW.room_id\n              AND OLD.check_in < br.check_out AND OLD.check_out > br.check_in)\n   LIMIT 1;');
    IF position('OLD.check_in < br.check_out' in d) = 0 THEN
      RAISE EXCEPTION 'patch target not found';
    END IF;
    EXECUTE d;
  END IF;
END $mig$;