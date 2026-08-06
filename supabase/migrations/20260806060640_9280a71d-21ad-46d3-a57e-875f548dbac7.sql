CREATE OR REPLACE FUNCTION public.split_folio_bill(_folio_id uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor        uuid := auth.uid();
  v_parent       public.folios%ROWTYPE;
  v_reason       text := NULLIF(btrim(COALESCE(_payload->>'reason','')), '');
  v_child        jsonb;
  v_charge       jsonb;
  v_pay          jsonb;
  v_alloc        jsonb;
  v_child_ids    uuid[] := ARRAY[]::uuid[];
  v_new_id       uuid;
  v_sum_children numeric := 0;
  v_paid_left    numeric := 0;
  v_pay_row      public.payments%ROWTYPE;
  v_alloc_sum    numeric;
  v_first        boolean;
  v_idx          int;
  v_amt          numeric;
  v_orphans      int;
  v_fallback     uuid;
  v_target       uuid;
  v_seg          record;
  v_out          jsonb := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to split a bill.';
  END IF;

  SELECT * INTO v_parent FROM public.folios WHERE id = _folio_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The bill being split no longer exists.';
  END IF;

  -- Single permission check for the whole operation.
  IF NOT (public.is_owner_or_super(v_actor)
          OR public.has_permission(v_actor, v_parent.property_id, 'billing', 'split_bill')) THEN
    RAISE EXCEPTION 'You do not have permission to split bills. Ask your Owner/Admin to enable Billing → Split Bill for your role.';
  END IF;

  IF v_reason IS NULL THEN
    v_reason := 'Split bill';
  END IF;

  IF COALESCE(v_parent.is_deleted, false) OR v_parent.status IN ('void','refunded') THEN
    RAISE EXCEPTION 'This bill has already been voided and cannot be split.';
  END IF;

  IF jsonb_typeof(_payload->'children') <> 'array'
     OR jsonb_array_length(_payload->'children') < 2 THEN
    RAISE EXCEPTION 'A split needs at least two resulting bills.';
  END IF;

  -- Refuse to compound a previous incomplete attempt.
  SELECT count(*) INTO v_orphans
    FROM public.folios f
   WHERE f.parent_folio_id = _folio_id
     AND COALESCE(f.is_deleted,false) = false
     AND f.status NOT IN ('void','refunded')
     AND f.invoice_number IS NULL;
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'A previous split of this bill did not complete and left % incomplete bill(s) behind. Clear those before splitting again.', v_orphans;
  END IF;

  -- 1) Child folios + their charges.
  FOR v_child IN SELECT * FROM jsonb_array_elements(_payload->'children')
  LOOP
    INSERT INTO public.folios (
      property_id, booking_id, parent_folio_id, gst_mode, bill_type,
      guest_gstin, guest_company, billing_company_id, notes,
      discount_type, discount_value,
      sub_total, discount_amount, gst_amount, total_amount, round_off_amount,
      paid_amount, balance_amount, created_by
    ) VALUES (
      v_parent.property_id,
      v_parent.booking_id,
      _folio_id,
      COALESCE(v_child->>'gst_mode','gst'),
      COALESCE(v_child->>'bill_type','gst_invoice'),
      NULLIF(v_child->>'guest_gstin',''),
      NULLIF(v_child->>'guest_company',''),
      NULLIF(v_child->>'billing_company_id','')::uuid,
      NULLIF(v_child->>'notes',''),
      NULLIF(v_child->>'discount_type',''),
      COALESCE((v_child->>'discount_value')::numeric, 0),
      COALESCE((v_child->>'sub_total')::numeric, 0),
      COALESCE((v_child->>'discount_amount')::numeric, 0),
      COALESCE((v_child->>'gst_amount')::numeric, 0),
      COALESCE((v_child->>'total_amount')::numeric, 0),
      COALESCE((v_child->>'round_off_amount')::numeric, 0),
      0,
      COALESCE((v_child->>'total_amount')::numeric, 0),
      v_actor
    ) RETURNING id INTO v_new_id;

    v_child_ids := v_child_ids || v_new_id;

    IF jsonb_typeof(v_child->'charges') = 'array' THEN
      FOR v_charge IN SELECT * FROM jsonb_array_elements(v_child->'charges')
      LOOP
        INSERT INTO public.folio_charges (
          folio_id, charge_type, description, qty, rate, amount,
          gst_rate, gst_amount, hsn_code, segment_bill_ref, charged_on,
          source_table, source_id, discount_type, discount_value, discount_amount, created_by
        ) VALUES (
          v_new_id,
          COALESCE(v_charge->>'charge_type','misc'),
          COALESCE(v_charge->>'description',''),
          COALESCE((v_charge->>'qty')::numeric, 1),
          COALESCE((v_charge->>'rate')::numeric, 0),
          COALESCE((v_charge->>'amount')::numeric, 0),
          COALESCE((v_charge->>'gst_rate')::numeric, 0),
          COALESCE((v_charge->>'gst_amount')::numeric, 0),
          NULLIF(v_charge->>'hsn_code',''),
          NULLIF(v_charge->>'segment_bill_ref',''),
          NULLIF(v_charge->>'charged_on','')::date,
          NULLIF(v_charge->>'source_table',''),
          NULLIF(v_charge->>'source_id','')::uuid,
          NULLIF(v_charge->>'discount_type',''),
          COALESCE((v_charge->>'discount_value')::numeric, 0),
          COALESCE((v_charge->>'discount_amount')::numeric, 0),
          v_actor
        );
      END LOOP;
    END IF;
  END LOOP;

  -- 2) Integrity: children must not exceed the parent's total.
  SELECT COALESCE(SUM(total_amount),0) INTO v_sum_children
    FROM public.folios WHERE id = ANY(v_child_ids);
  IF v_sum_children > COALESCE(v_parent.total_amount,0) + 1.0 THEN
    RAISE EXCEPTION 'Split rejected: the new bills total % but the original bill is only %.',
      v_sum_children, v_parent.total_amount;
  END IF;

  -- 3) Re-home existing parent payments onto the children.
  IF jsonb_typeof(_payload->'payments') = 'array' THEN
    FOR v_pay IN SELECT * FROM jsonb_array_elements(_payload->'payments')
    LOOP
      SELECT * INTO v_pay_row FROM public.payments
       WHERE id = (v_pay->>'payment_id')::uuid AND folio_id = _folio_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'A payment on this bill could not be found — it may have been changed by someone else. Refresh and try again.';
      END IF;

      SELECT COALESCE(SUM((a->>'amount')::numeric),0) INTO v_alloc_sum
        FROM jsonb_array_elements(v_pay->'allocations') a;
      IF abs(v_alloc_sum - v_pay_row.amount) > 0.01 THEN
        RAISE EXCEPTION 'Payment allocation of % does not match the recorded payment of %.',
          v_alloc_sum, v_pay_row.amount;
      END IF;

      v_first := true;
      FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_pay->'allocations')
      LOOP
        v_amt := ROUND(COALESCE((v_alloc->>'amount')::numeric, 0), 2);
        CONTINUE WHEN v_amt <= 0;
        v_idx := (v_alloc->>'child_index')::int;
        IF v_idx < 0 OR v_idx >= array_length(v_child_ids, 1) THEN
          RAISE EXCEPTION 'Invalid payment allocation target.';
        END IF;
        IF v_first THEN
          UPDATE public.payments
             SET folio_id = v_child_ids[v_idx + 1],
                 amount   = v_amt,
                 notes    = COALESCE(NULLIF(v_pay->>'notes',''), v_pay_row.notes)
           WHERE id = v_pay_row.id;
          v_first := false;
        ELSE
          INSERT INTO public.payments (
            property_id, folio_id, booking_id, amount, mode, reference_no, paid_at, notes, created_by
          ) VALUES (
            v_pay_row.property_id,
            v_child_ids[v_idx + 1],
            COALESCE(v_pay_row.booking_id, v_parent.booking_id),
            v_amt,
            v_pay_row.mode,
            v_pay_row.reference_no,
            v_pay_row.paid_at,
            COALESCE(NULLIF(v_pay->>'notes',''), v_pay_row.notes),
            v_actor
          );
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  -- 4) Parent must now be payment-free, then void it.
  SELECT COALESCE(SUM(amount),0) INTO v_paid_left
    FROM public.payments WHERE folio_id = _folio_id;
  IF v_paid_left > 0.01 THEN
    RAISE EXCEPTION 'Some payments on the original bill were not allocated to the new bills (₹% left). Split cancelled.', v_paid_left;
  END IF;

  UPDATE public.folios
     SET is_deleted = true, deleted_at = now(), deleted_by = v_actor,
         status = 'void', voided_at = now(), void_reason = v_reason,
         paid_amount = 0, balance_amount = 0, updated_at = now()
   WHERE id = _folio_id;

  -- 5) Repoint segment / food bills at the child that received their charges.
  v_fallback := v_child_ids[array_length(v_child_ids,1)];
  FOR v_seg IN SELECT id FROM public.segment_bills WHERE folio_id = _folio_id
  LOOP
    SELECT c.folio_id INTO v_target
      FROM public.folio_charges c
     WHERE c.folio_id = ANY(v_child_ids)
       AND c.source_table = 'segment_bills'
       AND c.source_id = v_seg.id
     LIMIT 1;
    UPDATE public.segment_bills SET folio_id = COALESCE(v_target, v_fallback) WHERE id = v_seg.id;
  END LOOP;
  UPDATE public.food_bills SET folio_id = v_fallback WHERE folio_id = _folio_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'folio_id', f.id,
           'invoice_number', f.invoice_number,
           'total_amount', f.total_amount,
           'paid_amount', f.paid_amount,
           'balance_amount', f.balance_amount
         ) ORDER BY array_position(v_child_ids, f.id)), '[]'::jsonb)
    INTO v_out
    FROM public.folios f WHERE f.id = ANY(v_child_ids);

  RETURN jsonb_build_object(
    'parent_folio_id', _folio_id,
    'parent_total', v_parent.total_amount,
    'children', v_out
  );
END $function$;

REVOKE ALL ON FUNCTION public.split_folio_bill(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.split_folio_bill(uuid, jsonb) TO authenticated;