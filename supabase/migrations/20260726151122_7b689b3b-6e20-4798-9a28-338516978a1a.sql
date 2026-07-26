-- 1. Split-bill: allow multiple active folios per booking when they are split children.
ALTER TABLE public.folios
  ADD COLUMN IF NOT EXISTS parent_folio_id uuid REFERENCES public.folios(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS public.folios_active_per_booking_uniq;
CREATE UNIQUE INDEX folios_active_per_booking_uniq
  ON public.folios (booking_id)
  WHERE is_deleted = false AND status <> 'void' AND parent_folio_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_folios_parent_folio_id
  ON public.folios (parent_folio_id) WHERE parent_folio_id IS NOT NULL;

-- 2. Menu items: drop uniqueness of short_code, keep a plain lookup index.
DROP INDEX IF EXISTS public.menu_items_property_short_code_uniq;
CREATE INDEX IF NOT EXISTS menu_items_property_short_code_idx
  ON public.menu_items (property_id, lower(short_code))
  WHERE short_code IS NOT NULL AND short_code <> '';

-- 3. Undo checkout: Manager / Owner bypass the 1-hour window.
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
  v_privileged boolean;
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

  v_privileged := public.has_role(auth.uid(), 'owner'::app_role)
               OR public.has_role(auth.uid(), 'superadmin'::app_role)
               OR public.has_role(auth.uid(), 'manager'::app_role);

  IF NOT v_privileged AND now() - v_booking.checked_out_at > interval '1 hour' THEN
    RAISE EXCEPTION 'Undo window (1 hour) has passed';
  END IF;

  IF public.is_day_locked(v_booking.property_id, v_booking.checked_out_at::date) THEN
    RAISE EXCEPTION 'Day is locked by Night Audit; cannot undo checkout';
  END IF;

  SELECT array_agg(room_id) INTO v_room_ids
    FROM public.booking_rooms
    WHERE booking_id = _booking_id AND room_id IS NOT NULL;

  IF v_room_ids IS NOT NULL AND array_length(v_room_ids, 1) > 0 THEN
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
    'original_checkout_at', v_booking.checked_out_at,
    'privileged_override', v_privileged AND now() - v_booking.checked_out_at > interval '1 hour'
  );
END $$;

GRANT EXECUTE ON FUNCTION public.undo_checkout(uuid) TO authenticated;