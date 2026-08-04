ALTER TABLE public.folios ALTER COLUMN bill_type SET DEFAULT 'gst_invoice';
ALTER TABLE public.properties DROP COLUMN IF EXISTS default_bill_type;