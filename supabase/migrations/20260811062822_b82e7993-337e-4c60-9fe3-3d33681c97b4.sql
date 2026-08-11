CREATE OR REPLACE FUNCTION public.auto_cancel_no_show_bookings(_grace_days integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_cancelled integer := 0;
  v_flagged   integer := 0;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  FOR r IN
    SELECT b.id, b.property_id, b.booking_number, b.check_in,
           (v_today - b.check_in) AS days_overdue,
           COALESCE((
             SELECT SUM(p.amount) FROM public.payments p
              WHERE p.booking_id = b.id
                 OR p.folio_id IN (SELECT f.id FROM public.folios f WHERE f.booking_id = b.id)
           ), 0) AS paid_amount
      FROM public.bookings b
     WHERE b.status = 'reserved'
       AND b.check_in < v_today - _grace_days
       AND NOT EXISTS (
         SELECT 1 FROM public.booking_rooms br
          WHERE br.booking_id = b.id AND br.actual_check_in IS NOT NULL
       )
  LOOP
    IF r.paid_amount <> 0 THEN
      -- Money already collected: never auto-cancel. Flag once for human review.
      IF NOT EXISTS (
        SELECT 1 FROM public.activity_log al
         WHERE al.action_type = 'BOOKING_NO_SHOW_NEEDS_REVIEW'
           AND al.reference_id = r.id
      ) THEN
        INSERT INTO public.activity_log (
          property_id, action_type, module, reference_id, reference_label, details
        ) VALUES (
          r.property_id, 'BOOKING_NO_SHOW_NEEDS_REVIEW', 'bookings', r.id, r.booking_number,
          jsonb_build_object(
            'check_in', r.check_in,
            'days_overdue', r.days_overdue,
            'paid_amount', r.paid_amount,
            'reason', 'No-show with advance payment — needs refund or reschedule decision'
          )
        );
        v_flagged := v_flagged + 1;
      END IF;
      CONTINUE;
    END IF;

    -- Reuse the standard cancellation path: the tg_booking_cancel_release_rooms
    -- trigger closes booking_rooms and frees the rooms.
    UPDATE public.bookings
       SET status           = 'cancelled',
           cancelled_at     = now(),
           cancelled_reason = 'Auto-cancelled: no-show (' || r.days_overdue || ' days past check-in)',
           updated_at       = now()
     WHERE id = r.id;

    INSERT INTO public.activity_log (
      property_id, action_type, module, reference_id, reference_label, details
    ) VALUES (
      r.property_id, 'BOOKING_AUTO_CANCELLED_NO_SHOW', 'bookings', r.id, r.booking_number,
      jsonb_build_object(
        'booking_id', r.id,
        'check_in', r.check_in,
        'days_overdue', r.days_overdue,
        'grace_days', _grace_days,
        'automated', true
      )
    );
    v_cancelled := v_cancelled + 1;
  END LOOP;

  IF v_cancelled > 0 OR v_flagged > 0 THEN
    INSERT INTO public.system_logs (event_type, message, payload)
    VALUES (
      'auto_cancel_no_show_bookings',
      'Auto-cancelled ' || v_cancelled || ' no-show bookings, flagged ' || v_flagged || ' for review',
      jsonb_build_object('cancelled', v_cancelled, 'flagged', v_flagged, 'ran_at', now())
    );
  END IF;

  RETURN jsonb_build_object('cancelled', v_cancelled, 'flagged_for_review', v_flagged);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.auto_cancel_no_show_bookings(integer) FROM anon;