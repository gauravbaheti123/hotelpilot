CREATE UNIQUE INDEX IF NOT EXISTS uq_open_segment_bill_booking
  ON public.segment_bills (property_id, segment, booking_id)
  WHERE status = 'open' AND booking_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_open_segment_bill_table
  ON public.segment_bills (property_id, segment, table_id, ((created_at AT TIME ZONE 'Asia/Kolkata')::date))
  WHERE status = 'open' AND booking_id IS NULL AND table_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_open_segment_bill_walkin
  ON public.segment_bills (property_id, segment, guest_name, ((created_at AT TIME ZONE 'Asia/Kolkata')::date))
  WHERE status = 'open' AND booking_id IS NULL AND table_id IS NULL AND guest_name IS NOT NULL;