
-- 1) booking_rooms schema extension
ALTER TABLE public.booking_rooms
  ADD COLUMN IF NOT EXISTS status varchar(20) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS start_date timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS end_date timestamptz,
  ADD COLUMN IF NOT EXISTS shifted_to_room_id uuid REFERENCES public.rooms(id),
  ADD COLUMN IF NOT EXISTS shifted_at timestamptz,
  ADD COLUMN IF NOT EXISTS shifted_by uuid REFERENCES auth.users(id);

ALTER TABLE public.booking_rooms
  DROP CONSTRAINT IF EXISTS booking_rooms_status_check;
ALTER TABLE public.booking_rooms
  ADD CONSTRAINT booking_rooms_status_check
  CHECK (status IN ('active','shifted','checked_out'));

UPDATE public.booking_rooms SET status = 'active' WHERE status IS NULL OR status = '';

CREATE INDEX IF NOT EXISTS idx_booking_rooms_status ON public.booking_rooms(status);

-- 2) system_logs table for audit
CREATE TABLE IF NOT EXISTS public.system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  message text,
  payload jsonb,
  property_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_logs TO authenticated;
GRANT ALL ON public.system_logs TO service_role;

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Superadmins can view system logs"
  ON public.system_logs FOR SELECT
  TO authenticated
  USING (public.is_superadmin(auth.uid()));

-- 3) Auto-cancel function (called by pg_cron)
CREATE OR REPLACE FUNCTION public.auto_cancel_incomplete_bookings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH cancelled AS (
    UPDATE public.bookings b
       SET status = 'cancelled',
           cancelled_at = now(),
           cancelled_reason = 'Auto-cancelled: incomplete booking',
           updated_at = now()
     WHERE b.status = 'reserved'
       AND b.created_at < now() - INTERVAL '1 hour'
       AND b.guest_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.booking_rooms br WHERE br.booking_id = b.id
       )
    RETURNING b.id, b.property_id
  )
  SELECT count(*) INTO v_count FROM cancelled;

  IF v_count > 0 THEN
    INSERT INTO public.system_logs (event_type, message, payload)
    VALUES (
      'auto_cancel_incomplete_bookings',
      'Auto-cancelled ' || v_count || ' incomplete bookings',
      jsonb_build_object('count', v_count, 'ran_at', now())
    );
  END IF;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_cancel_incomplete_bookings() FROM PUBLIC, anon, authenticated;
