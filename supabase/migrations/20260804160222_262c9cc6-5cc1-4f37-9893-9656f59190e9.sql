ALTER TABLE public.billing_companies ADD COLUMN IF NOT EXISTS gst_status text;
ALTER TABLE public.billing_companies DROP CONSTRAINT IF EXISTS billing_companies_gst_status_check;
ALTER TABLE public.billing_companies ADD CONSTRAINT billing_companies_gst_status_check CHECK (gst_status IS NULL OR gst_status IN ('active','cancelled'));