CREATE OR REPLACE FUNCTION public.auto_close_segment_bills()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b RECORD;
  closed_count integer := 0;
  item_count integer;
  res jsonb;
BEGIN
  FOR b IN
    SELECT sb.id, sb.bill_number, sb.property_id
    FROM public.segment_bills sb
    WHERE sb.status = 'open'
      AND sb.segment IN ('food','laundry')
      AND sb.is_walkin = false
      AND sb.booking_id IS NOT NULL
      AND (sb.created_at AT TIME ZONE 'Asia/Kolkata')::date
          <= (now() AT TIME ZONE 'Asia/Kolkata')::date
  LOOP
    BEGIN
      SELECT COUNT(*) INTO item_count
        FROM public.segment_bill_items i WHERE i.segment_bill_id = b.id;

      IF item_count = 0 THEN
        -- Empty shell (every punch was deleted). Never settle it and never
        -- leave it open forever: cancel it so it stops showing as a 0 bill.
        UPDATE public.segment_bills
           SET status = 'cancelled',
               total_amount = 0,
               gst_amount = 0,
               notes = COALESCE(notes || ' | ', '')
                       || 'Auto-cancelled at daily close — no items on bill',
               updated_at = now()
         WHERE id = b.id;

        INSERT INTO public.activity_log (
          property_id, action_type, module, reference_id, reference_label, details
        ) VALUES (
          b.property_id, 'SEGMENT_BILL_AUTO_VOIDED_EMPTY', 'food', b.id, b.bill_number,
          jsonb_build_object('reason', 'bill had no item lines at daily close')
        );
        CONTINUE;
      END IF;

      res := public.settle_segment_bill(b.id, NULL, true);
      IF COALESCE((res->>'ok')::boolean, false) THEN
        closed_count := closed_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.activity_log (
        property_id, action_type, module, reference_id, reference_label, details
      ) VALUES (
        b.property_id, 'SEGMENT_BILL_AUTO_CLOSE_FAILED', 'food', b.id, b.bill_number,
        jsonb_build_object('error', SQLERRM)
      );
    END;
  END LOOP;

  RETURN closed_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.auto_close_segment_bills() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_close_segment_bills() TO authenticated, service_role;