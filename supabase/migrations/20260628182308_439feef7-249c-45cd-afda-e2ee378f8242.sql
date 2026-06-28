
-- 1) Idempotency: one room charge per folio per business date
CREATE UNIQUE INDEX IF NOT EXISTS uq_folio_charges_room_per_day
  ON public.folio_charges (folio_id, charged_on)
  WHERE charge_type = 'room' AND COALESCE(is_wiped,false) = false;

-- Backfill charged_on for legacy rows from created_at (safe; only where null)
UPDATE public.folio_charges
   SET charged_on = (created_at AT TIME ZONE 'UTC')::date
 WHERE charged_on IS NULL;

-- 2) RPC: Post nightly room charges idempotently for a property/date.
-- Returns count of newly-posted charges.
CREATE OR REPLACE FUNCTION public.post_nightly_room_charges(
  _property_id uuid,
  _audit_date  date
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec    record;
  v_folio  uuid;
  v_posted int := 0;
BEGIN
  IF NOT public.user_has_property(auth.uid(), _property_id) THEN
    RAISE EXCEPTION 'Not authorised for this property';
  END IF;
  IF NOT public.can_billing(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to post charges';
  END IF;

  FOR v_rec IN
    SELECT br.booking_id, br.room_id, br.rate, r.room_number
      FROM public.booking_rooms br
      JOIN public.bookings b ON b.id = br.booking_id
      LEFT JOIN public.rooms r ON r.id = br.room_id
     WHERE br.property_id = _property_id
       AND b.check_in  <= _audit_date
       AND b.check_out  > _audit_date
       AND b.status IN ('checked_in','reserved')
       AND COALESCE(br.status,'active') IN ('active','checked_in','reserved')
       AND COALESCE(br.rate,0) > 0
  LOOP
    v_folio := public.get_or_create_folio(v_rec.booking_id);
    IF v_folio IS NULL THEN CONTINUE; END IF;

    -- Idempotency guard: skip if a room charge already exists for this folio/date
    IF EXISTS (
      SELECT 1 FROM public.folio_charges
       WHERE folio_id = v_folio
         AND charge_type = 'room'
         AND charged_on = _audit_date
         AND COALESCE(is_wiped,false) = false
    ) THEN
      CONTINUE;
    END IF;

    BEGIN
      INSERT INTO public.folio_charges(
        folio_id, charge_type, description, qty, rate, amount,
        gst_amount, charged_on, source_table, source_id, created_by
      ) VALUES (
        v_folio, 'room',
        'Room Charge — ' || to_char(_audit_date,'YYYY-MM-DD') ||
          COALESCE(' — Rm ' || v_rec.room_number, ''),
        1, v_rec.rate, v_rec.rate, 0, _audit_date,
        'night_audit', v_rec.booking_id, auth.uid()
      );
      v_posted := v_posted + 1;
    EXCEPTION WHEN unique_violation THEN
      -- another concurrent run already posted; treat as success
      NULL;
    END;
  END LOOP;

  RETURN v_posted;
END $$;

REVOKE ALL ON FUNCTION public.post_nightly_room_charges(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.post_nightly_room_charges(uuid, date) TO authenticated;

-- 3) RPC: Delete night audit — Owner/Superadmin only
CREATE OR REPLACE FUNCTION public.delete_night_audit(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_prop uuid;
BEGIN
  IF NOT public.is_owner_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'Only Owner or Superadmin can delete a night audit';
  END IF;
  SELECT property_id INTO v_prop FROM public.night_audit_reports WHERE id = _id;
  IF v_prop IS NULL THEN RAISE EXCEPTION 'Audit not found'; END IF;
  IF NOT public.user_has_property(auth.uid(), v_prop) THEN
    RAISE EXCEPTION 'Not authorised for this property';
  END IF;
  DELETE FROM public.night_audit_reports WHERE id = _id;
END $$;

REVOKE ALL ON FUNCTION public.delete_night_audit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_night_audit(uuid) TO authenticated;

-- 4) RLS hardening on night_audit_reports: only owner/superadmin may DELETE
DROP POLICY IF EXISTS night_audit_delete ON public.night_audit_reports;
DROP POLICY IF EXISTS "night_audit_reports_delete" ON public.night_audit_reports;
DROP POLICY IF EXISTS "Delete night audit" ON public.night_audit_reports;
CREATE POLICY night_audit_delete_owner_only
  ON public.night_audit_reports
  FOR DELETE TO authenticated
  USING (
    public.is_owner_or_super(auth.uid())
    AND public.user_has_property(auth.uid(), property_id)
  );

-- Unique guard so duplicate audits for same property/date are impossible
CREATE UNIQUE INDEX IF NOT EXISTS uq_night_audit_property_date
  ON public.night_audit_reports (property_id, audit_date);
