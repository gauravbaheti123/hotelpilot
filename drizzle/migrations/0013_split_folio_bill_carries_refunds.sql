DO $$
DECLARE d text; n text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
    FROM pg_proc p
   WHERE p.proname = 'split_folio_bill'
     AND p.pronamespace = 'public'::regnamespace;
  IF d IS NULL THEN
    RAISE EXCEPTION 'public.split_folio_bill not found';
  END IF;

  -- Refunds are negative payment rows. Skipping them stranded the refund on
  -- the voided parent and made every child bill look overpaid.
  n := replace(d, 'CONTINUE WHEN v_amt <= 0;', 'CONTINUE WHEN v_amt = 0;');
  -- Leftover check must also catch a negative (refund-only) remainder.
  n := replace(n, 'IF v_paid_left > 0.01 THEN', 'IF abs(v_paid_left) > 0.01 THEN');

  IF n = d THEN
    RAISE EXCEPTION 'split_folio_bill source did not match the expected patterns';
  END IF;

  EXECUTE n;
END $$;