-- 1. Allow reserved / checked_in lifecycle statuses on booking_rooms
ALTER TABLE public.booking_rooms DROP CONSTRAINT IF EXISTS booking_rooms_status_check;
ALTER TABLE public.booking_rooms ADD CONSTRAINT booking_rooms_status_check
  CHECK (status::text = ANY (ARRAY['active','reserved','checked_in','shifted','checked_out']));

-- 2. Traceability columns
ALTER TABLE public.booking_rooms
  ADD COLUMN IF NOT EXISTS event_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_block_id uuid REFERENCES public.event_room_blocks(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS booking_rooms_event_block_uniq
  ON public.booking_rooms(event_block_id) WHERE event_block_id IS NOT NULL;

-- 3. Resolve (or create) the unified banquet booking for a legacy banquet_bookings row
CREATE OR REPLACE FUNCTION public.ensure_event_booking(_banquet_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_bb public.banquet_bookings%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_bb FROM public.banquet_bookings WHERE id = _banquet_booking_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT id INTO v_id FROM public.bookings
   WHERE booking_type = 'banquet' AND banquet_number = v_bb.banquet_number
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.bookings (
    property_id, booking_type, banquet_number, status,
    check_in, check_out, adults, children,
    hall_id, event_name, function_type, host_name,
    source, notes
  ) VALUES (
    v_bb.property_id, 'banquet', v_bb.banquet_number, 'reserved',
    v_bb.event_date, v_bb.event_date, 1, 0,
    v_bb.hall_id, v_bb.event_name, v_bb.function_type,
    COALESCE(v_bb.contact_person, v_bb.event_name),
    'banquet', 'Auto-created from banquet event ' || COALESCE(v_bb.banquet_number, '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 4. Core sync: keep exactly ONE booking_rooms row per event_room_block
CREATE OR REPLACE FUNCTION public.sync_event_block_booking_room(_block_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_b public.event_room_blocks%ROWTYPE;
  v_event_booking uuid;
  v_br public.booking_rooms%ROWTYPE;
  v_target_booking uuid;
  v_cat uuid;
  v_new_folio uuid;
  v_old_folio uuid;
BEGIN
  SELECT * INTO v_b FROM public.event_room_blocks WHERE id = _block_id;
  IF NOT FOUND OR v_b.room_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_br FROM public.booking_rooms WHERE event_block_id = v_b.id LIMIT 1;

  -- Cancelled: drop a still-reserved holder row, otherwise close it.
  IF v_b.status = 'cancelled' THEN
    IF v_br.id IS NOT NULL THEN
      IF COALESCE(v_br.status,'active') = 'reserved' THEN
        DELETE FROM public.booking_rooms WHERE id = v_br.id;
      ELSE
        UPDATE public.booking_rooms SET status = 'checked_out' WHERE id = v_br.id;
      END IF;
    END IF;
    RETURN NULL;
  END IF;

  -- Resolve / create unified event booking
  v_event_booking := COALESCE(v_b.event_booking_id, public.ensure_event_booking(v_b.banquet_booking_id));
  IF v_event_booking IS NULL THEN RETURN NULL; END IF;
  IF v_b.event_booking_id IS DISTINCT FROM v_event_booking THEN
    UPDATE public.event_room_blocks SET event_booking_id = v_event_booking WHERE id = v_b.id;
  END IF;

  -- Adopt an existing stay booking_rooms row (legacy check-ins) instead of duplicating.
  IF v_br.id IS NULL AND v_b.booking_id IS NOT NULL THEN
    SELECT * INTO v_br FROM public.booking_rooms
     WHERE booking_id = v_b.booking_id AND room_id = v_b.room_id
     ORDER BY created_at LIMIT 1;
    IF v_br.id IS NOT NULL THEN
      UPDATE public.booking_rooms
         SET event_block_id = v_b.id, event_booking_id = v_event_booking
       WHERE id = v_br.id;
    END IF;
  END IF;

  -- Once the guest stay booking exists the room row lives on it; before that, on the event booking.
  v_target_booking := COALESCE(v_b.booking_id, v_event_booking);

  IF v_br.id IS NULL THEN
    SELECT category_id INTO v_cat FROM public.rooms WHERE id = v_b.room_id;
    INSERT INTO public.booking_rooms (
      booking_id, property_id, room_id, category_id, rate,
      check_in, check_out, check_in_time, check_out_time,
      status, actual_check_in, event_booking_id, event_block_id
    ) VALUES (
      v_target_booking, v_b.property_id, v_b.room_id, v_cat, COALESCE(v_b.special_rate, 0),
      v_b.checkin_date, v_b.checkout_date, v_b.checkin_time, v_b.checkout_time,
      CASE WHEN v_b.status = 'checked_in' THEN 'checked_in'
           WHEN v_b.status = 'checked_out' THEN 'checked_out'
           ELSE 'reserved' END,
      CASE WHEN v_b.status IN ('checked_in','checked_out') THEN COALESCE(v_b.checked_in_at, now()) END,
      v_event_booking, v_b.id
    )
    RETURNING * INTO v_br;
    RETURN v_br.id;
  END IF;

  -- Repointing to the stay booking: carry any seeded room charge over to the stay folio.
  IF v_br.booking_id IS DISTINCT FROM v_target_booking THEN
    v_old_folio := (SELECT fc.folio_id FROM public.folio_charges fc
                     WHERE fc.source_table = 'booking_rooms' AND fc.source_id = v_br.id
                       AND COALESCE(fc.is_wiped,false) = false LIMIT 1);
    UPDATE public.booking_rooms SET booking_id = v_target_booking WHERE id = v_br.id;
    IF v_old_folio IS NOT NULL THEN
      v_new_folio := public.get_or_create_folio(v_target_booking);
      IF v_new_folio IS NOT NULL AND v_new_folio <> v_old_folio THEN
        UPDATE public.folio_charges SET folio_id = v_new_folio
         WHERE source_table = 'booking_rooms' AND source_id = v_br.id
           AND COALESCE(is_wiped,false) = false;
        PERFORM public.recompute_folio_totals(v_old_folio);
        PERFORM public.recompute_folio_totals(v_new_folio);
      END IF;
    END IF;
  END IF;

  UPDATE public.booking_rooms
     SET room_id       = v_b.room_id,
         rate          = COALESCE(v_b.special_rate, rate),
         check_in      = v_b.checkin_date,
         check_out     = v_b.checkout_date,
         check_in_time = v_b.checkin_time,
         check_out_time= v_b.checkout_time,
         event_booking_id = v_event_booking,
         status = CASE WHEN v_b.status = 'checked_in' THEN 'checked_in'
                       WHEN v_b.status = 'checked_out' THEN 'checked_out'
                       ELSE 'reserved' END,
         actual_check_in = CASE
             WHEN v_b.status IN ('checked_in','checked_out')
               THEN COALESCE(actual_check_in, v_b.checked_in_at, now())
             ELSE actual_check_in END,
         actual_check_out = CASE
             WHEN v_b.status = 'checked_out'
               THEN COALESCE(actual_check_out, v_b.checked_out_at, now())
             ELSE actual_check_out END
   WHERE id = v_br.id;

  RETURN v_br.id;
END;
$$;

-- 5. Triggers on event_room_blocks
CREATE OR REPLACE FUNCTION public.tg_event_block_sync_booking_room()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.sync_event_block_booking_room(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_block_sync_br_ins ON public.event_room_blocks;
CREATE TRIGGER trg_event_block_sync_br_ins
AFTER INSERT ON public.event_room_blocks
FOR EACH ROW EXECUTE FUNCTION public.tg_event_block_sync_booking_room();

DROP TRIGGER IF EXISTS trg_event_block_sync_br_upd ON public.event_room_blocks;
CREATE TRIGGER trg_event_block_sync_br_upd
AFTER UPDATE OF status, room_id, checkin_date, checkout_date, checkin_time, checkout_time, special_rate, booking_id, event_booking_id
ON public.event_room_blocks
FOR EACH ROW EXECUTE FUNCTION public.tg_event_block_sync_booking_room();

-- 6. Backfill existing live blocks
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.event_room_blocks WHERE status IN ('blocked','checked_in') LOOP
    PERFORM public.sync_event_block_booking_room(r.id);
  END LOOP;
END $$;