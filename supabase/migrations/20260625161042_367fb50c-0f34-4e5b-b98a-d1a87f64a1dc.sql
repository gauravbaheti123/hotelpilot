ALTER TABLE public.banquet_bookings
  ADD COLUMN IF NOT EXISTS bill_type TEXT NOT NULL DEFAULT 'gst_invoice'
    CHECK (bill_type IN ('gst_invoice', 'cash_bill'));