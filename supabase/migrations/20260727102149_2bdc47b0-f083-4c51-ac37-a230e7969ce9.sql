-- Phase 2: Auto Daily Close for Food & Laundry segment bills

-- 1) Auto-close function (idempotent transfer to Lodge folio)
CREATE OR REPLACE FUNCTION public.auto_close_segment_bills()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b RECORD;
  target_folio_id uuid;
  closed_count integer := 0;
  existing_count integer;
BEGIN
  FOR b IN
    SELECT sb.*
    FROM public.segment_bills sb
    WHERE sb.status = 'open'
      AND sb.segment IN ('food','laundry')
      AND sb.is_walkin = false
      AND sb.booking_id IS NOT NULL
  LOOP
    -- Resolve/ensure Lodge folio for the booking
    BEGIN
      target_folio_id := COALESCE(b.folio_id, public.get_or_create_folio(b.booking_id));
    EXCEPTION WHEN OTHERS THEN
      target_folio_id := b.folio_id;
    END;

    -- Idempotent transfer: only insert folio_charges if none exist for this bill
    IF target_folio_id IS NOT NULL THEN
      SELECT COUNT(*) INTO existing_count
      FROM public.folio_charges
      WHERE source_table = 'segment_bills' AND source_id = b.id;

      IF existing_count = 0 THEN
        INSERT INTO public.folio_charges (
          folio_id, charge_type, description, qty, rate, amount, gst_rate, gst_amount,
          source_table, source_id, segment_bill_ref
        )
        SELECT
          target_folio_id,
          CASE WHEN b.segment = 'food' THEN 'food' ELSE 'laundry' END,
          i.description || ' (' || b.bill_number || ')',
          i.qty, i.rate, i.amount, i.gst_rate, i.gst_amount,
          'segment_bills', b.id, b.bill_number
        FROM public.segment_bill_items i
        WHERE i.segment_bill_id = b.id;
      END IF;
    END IF;

    -- Close the bill (reuse 'settled' status so reports uniformly treat it)
    UPDATE public.segment_bills
    SET status = 'settled',
        settled_at = now(),
        folio_id = COALESCE(target_folio_id, folio_id),
        notes = COALESCE(notes,'') || CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END || 'Auto-closed at daily close on ' || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI'),
        updated_at = now()
    WHERE id = b.id;

    -- Activity log
    INSERT INTO public.activity_log (
      property_id, action_type, module, reference_id, reference_label, details
    ) VALUES (
      b.property_id,
      'SEGMENT_BILL_AUTO_CLOSED',
      CASE WHEN b.segment = 'food' THEN 'food' ELSE 'laundry' END,
      b.id,
      b.bill_number,
      jsonb_build_object(
        'segment', b.segment,
        'bill_number', b.bill_number,
        'amount', b.total_amount,
        'room_id', b.room_id,
        'booking_id', b.booking_id,
        'folio_id', target_folio_id,
        'closed_at', now()
      )
    );

    closed_count := closed_count + 1;
  END LOOP;

  RETURN closed_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_close_segment_bills() TO service_role;

-- 2) Schedule via pg_cron — 23:59 IST daily (18:29 UTC)
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-close-segment-bills-daily') THEN
    PERFORM cron.unschedule('auto-close-segment-bills-daily');
  END IF;
END $$;

SELECT cron.schedule(
  'auto-close-segment-bills-daily',
  '29 18 * * *',
  $cron$ SELECT public.auto_close_segment_bills(); $cron$
);