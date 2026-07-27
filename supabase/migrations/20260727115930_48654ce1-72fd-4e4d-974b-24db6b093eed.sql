
-- 1. Profile photo
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS photo_url text;

-- 2. Extend reminders with categorization + read tracking
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS related_record_id uuid,
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS read_by uuid,
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- Dedup index for system-generated reminders (per property, per category, per record, per day)
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS reminder_day date
    GENERATED ALWAYS AS ((reminder_datetime AT TIME ZONE 'UTC')::date) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS reminders_system_dedup_idx
  ON public.reminders (property_id, category, related_record_id, reminder_day)
  WHERE type = 'system' AND related_record_id IS NOT NULL;

-- 3. System-reminder generator
CREATE OR REPLACE FUNCTION public.generate_system_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  -- 3a. Checkout due today / overdue
  INSERT INTO public.reminders (property_id, type, category, related_record_id, title, message, notes, reminder_datetime)
  SELECT
    b.property_id,
    'system',
    'checkout_due',
    b.id,
    CASE WHEN b.check_out < CURRENT_DATE THEN 'Overdue checkout: ' ELSE 'Checkout due today: ' END
      || COALESCE(b.booking_number, 'Booking'),
    'Guest is still checked-in. Scheduled checkout: ' || to_char(b.check_out, 'DD Mon YYYY'),
    NULL,
    now()
  FROM public.bookings b
  WHERE b.status = 'checked_in'
    AND b.check_out <= CURRENT_DATE
    AND NOT b.is_wiped
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 3b. Pending payment on bookings due to check out today or overdue
  INSERT INTO public.reminders (property_id, type, category, related_record_id, title, message, notes, reminder_datetime)
  SELECT
    b.property_id,
    'system',
    'payment_pending',
    b.id,
    'Pending payment: ' || COALESCE(b.booking_number, 'Booking'),
    'Balance ₹' || to_char(COALESCE(b.balance_amount, 0), 'FM999,999,990.00') || ' — checkout ' || to_char(b.check_out, 'DD Mon'),
    NULL,
    now()
  FROM public.bookings b
  WHERE b.status IN ('checked_in','reserved')
    AND COALESCE(b.balance_amount, 0) > 0
    AND b.check_out <= CURRENT_DATE
    AND NOT b.is_wiped
  ON CONFLICT DO NOTHING;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_system_reminders() TO authenticated, service_role;

-- Schedule hourly generation via pg_cron (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('generate-system-reminders-hourly')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generate-system-reminders-hourly');
    PERFORM cron.schedule(
      'generate-system-reminders-hourly',
      '5 * * * *',
      $cron$SELECT public.generate_system_reminders();$cron$
    );
  END IF;
END $$;
