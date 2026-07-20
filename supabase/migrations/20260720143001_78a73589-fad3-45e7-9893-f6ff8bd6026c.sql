
-- 1. Audit table
CREATE TABLE IF NOT EXISTS public.checkout_undo_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  folio_id uuid REFERENCES public.folios(id) ON DELETE SET NULL,
  undone_by uuid NOT NULL REFERENCES auth.users(id),
  original_checkout_at timestamptz NOT NULL,
  undone_at timestamptz NOT NULL DEFAULT now(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE
);

GRANT SELECT, INSERT ON public.checkout_undo_log TO authenticated;
GRANT ALL ON public.checkout_undo_log TO service_role;

ALTER TABLE public.checkout_undo_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view checkout undo log for their property"
  ON public.checkout_undo_log FOR SELECT TO authenticated
  USING (public.user_has_property(auth.uid(), property_id));

CREATE POLICY "Users can insert checkout undo log for their property"
  ON public.checkout_undo_log FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_property(auth.uid(), property_id)
    AND undone_by = auth.uid()
  );

CREATE INDEX IF NOT EXISTS idx_checkout_undo_log_booking ON public.checkout_undo_log(booking_id);
CREATE INDEX IF NOT EXISTS idx_checkout_undo_log_property ON public.checkout_undo_log(property_id, undone_at DESC);

-- 2. Reopened flag on folios
ALTER TABLE public.folios ADD COLUMN IF NOT EXISTS is_reopened boolean NOT NULL DEFAULT false;

-- 3. Update balance trigger so reopened folios stay 'open' until explicit re-checkout
CREATE OR REPLACE FUNCTION public.tg_folios_balance_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  NEW.balance_amount := GREATEST(0, COALESCE(NEW.total_amount,0) - COALESCE(NEW.paid_amount,0));
  IF NEW.status NOT IN ('void','refunded') THEN
    IF COALESCE(NEW.is_reopened, false) AND NEW.status <> 'settled' THEN
      NEW.status := 'open';
      NEW.settled_at := NULL;
    ELSIF NEW.balance_amount <= 0.01 AND COALESCE(NEW.paid_amount,0) > 0 THEN
      NEW.status := 'settled';
      IF NEW.settled_at IS NULL THEN NEW.settled_at := now(); END IF;
      NEW.is_reopened := false;
    ELSE
      NEW.status := 'open';
      NEW.settled_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- 4. Undo checkout function
CREATE OR REPLACE FUNCTION public.undo_checkout(_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_folio   public.folios%ROWTYPE;
  v_room_ids uuid[];
  v_conflict int;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF NOT public.can_front_desk(auth.uid(), v_booking.property_id) THEN
    RAISE EXCEPTION 'Not authorised to undo checkout';
  END IF;

  IF v_booking.status <> 'checked_out' THEN
    RAISE EXCEPTION 'Booking is not in checked-out state';
  END IF;
  IF v_booking.checked_out_at IS NULL THEN
    RAISE EXCEPTION 'Checkout timestamp is missing';
  END IF;
  IF now() - v_booking.checked_out_at > interval '1 hour' THEN
    RAISE EXCEPTION 'Undo window (1 hour) has passed';
  END IF;

  IF public.is_day_locked(v_booking.property_id, v_booking.checked_out_at::date) THEN
    RAISE EXCEPTION 'Day is locked by Night Audit; cannot undo checkout';
  END IF;

  SELECT array_agg(room_id) INTO v_room_ids
    FROM public.booking_rooms
    WHERE booking_id = _booking_id AND room_id IS NOT NULL;

  IF v_room_ids IS NOT NULL AND array_length(v_room_ids, 1) > 0 THEN
    -- Newer checkout on same room?
    SELECT count(*) INTO v_conflict
      FROM public.bookings b2
      JOIN public.booking_rooms br ON br.booking_id = b2.id
      WHERE br.room_id = ANY(v_room_ids)
        AND b2.id <> _booking_id
        AND b2.status = 'checked_out'
        AND b2.checked_out_at > v_booking.checked_out_at;
    IF v_conflict > 0 THEN
      RAISE EXCEPTION 'A newer checkout exists on this room; undo not allowed';
    END IF;

    -- Reassigned to a live booking?
    SELECT count(*) INTO v_conflict
      FROM public.booking_rooms br
      JOIN public.bookings b2 ON b2.id = br.booking_id
      WHERE br.room_id = ANY(v_room_ids)
        AND br.booking_id <> _booking_id
        AND COALESCE(br.status,'active') IN ('active','reserved','checked_in')
        AND COALESCE(b2.status,'reserved') NOT IN ('cancelled','no_show','checked_out');
    IF v_conflict > 0 THEN
      RAISE EXCEPTION 'Room has been reassigned to another booking; undo not allowed';
    END IF;
  END IF;

  SELECT * INTO v_folio FROM public.folios
    WHERE booking_id = _booking_id
      AND COALESCE(is_deleted, false) = false
      AND status <> 'void'
    ORDER BY created_at DESC LIMIT 1;

  INSERT INTO public.checkout_undo_log (booking_id, folio_id, undone_by, original_checkout_at, property_id)
  VALUES (_booking_id, v_folio.id, auth.uid(), v_booking.checked_out_at, v_booking.property_id);

  IF v_folio.id IS NOT NULL THEN
    UPDATE public.folios
       SET status = 'open',
           settled_at = NULL,
           is_reopened = true,
           updated_at = now()
     WHERE id = v_folio.id;
  END IF;

  UPDATE public.bookings
     SET status = 'checked_in',
         checked_out_at = NULL,
         checked_out_by = NULL,
         updated_at = now()
   WHERE id = _booking_id;

  UPDATE public.booking_rooms
     SET actual_check_out = NULL,
         status = 'active',
         updated_at = now()
   WHERE booking_id = _booking_id;

  IF v_room_ids IS NOT NULL AND array_length(v_room_ids, 1) > 0 THEN
    UPDATE public.rooms
       SET status = 'occupied',
           updated_at = now()
     WHERE id = ANY(v_room_ids);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', _booking_id,
    'folio_id', v_folio.id,
    'original_checkout_at', v_booking.checked_out_at
  );
END $$;

GRANT EXECUTE ON FUNCTION public.undo_checkout(uuid) TO authenticated;
