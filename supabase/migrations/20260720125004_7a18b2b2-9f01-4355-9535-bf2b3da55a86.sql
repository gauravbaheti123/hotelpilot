DROP INDEX IF EXISTS public.uq_folio_charges_room_per_day;

CREATE UNIQUE INDEX IF NOT EXISTS uq_folio_charges_booking_room_source
  ON public.folio_charges (folio_id, source_table, source_id)
  WHERE charge_type = 'room'
    AND source_table = 'booking_rooms'
    AND source_id IS NOT NULL
    AND COALESCE(is_wiped, false) = false;

CREATE UNIQUE INDEX IF NOT EXISTS uq_folio_charges_night_audit_day
  ON public.folio_charges (folio_id, charged_on)
  WHERE charge_type = 'room'
    AND source_table = 'night_audit'
    AND COALESCE(is_wiped, false) = false;