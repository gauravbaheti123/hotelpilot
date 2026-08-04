-- 1. invoice_number nullable (trigger timing unchanged)
ALTER TABLE public.folios ALTER COLUMN invoice_number DROP NOT NULL;

-- 2. 'due' status vocabulary
ALTER TABLE public.folios DROP CONSTRAINT IF EXISTS folios_status_check;
ALTER TABLE public.folios ADD CONSTRAINT folios_status_check
  CHECK (status = ANY (ARRAY['open'::text,'settled'::text,'due'::text,'void'::text,'refunded'::text]));

-- live-bill resolver: a 'due' folio is finalised, not the live bill
CREATE OR REPLACE FUNCTION public.get_or_create_folio(_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_id uuid; v_prop uuid;
BEGIN
  SELECT id INTO v_id
    FROM public.folios
   WHERE booking_id = _booking_id
     AND COALESCE(is_deleted, false) = false
     AND status NOT IN ('void','refunded','due')
   ORDER BY
     CASE WHEN status = 'open' AND COALESCE(balance_amount,0) > 0 THEN 0 ELSE 1 END,
     CASE WHEN status = 'open' THEN 0 ELSE 1 END,
     CASE WHEN COALESCE(parent_folio_id, '00000000-0000-0000-0000-000000000000'::uuid) <> '00000000-0000-0000-0000-000000000000'::uuid THEN 0 ELSE 1 END,
     COALESCE(balance_amount,0) DESC,
     COALESCE(total_amount,0) DESC,
     created_at DESC
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT property_id INTO v_prop FROM public.bookings WHERE id = _booking_id;
  IF v_prop IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  INSERT INTO public.folios (property_id, booking_id, created_by)
    VALUES (v_prop, _booking_id, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END
$fn$;

-- 3. receivables / ledger-transfer logging on checkout_overrides
ALTER TABLE public.checkout_overrides
  ADD COLUMN IF NOT EXISTS override_type text NOT NULL DEFAULT 'pending_kot',
  ADD COLUMN IF NOT EXISTS amount_transferred numeric(12,2),
  ADD COLUMN IF NOT EXISTS guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS authorized_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS due_date date;

ALTER TABLE public.checkout_overrides DROP CONSTRAINT IF EXISTS checkout_overrides_type_chk;
ALTER TABLE public.checkout_overrides ADD CONSTRAINT checkout_overrides_type_chk
  CHECK (override_type = ANY (ARRAY['pending_kot'::text,'due_transfer'::text,'other'::text]));

CREATE INDEX IF NOT EXISTS checkout_overrides_type_idx ON public.checkout_overrides (override_type, authorized_at DESC);
CREATE INDEX IF NOT EXISTS checkout_overrides_guest_idx ON public.checkout_overrides (guest_id);
CREATE INDEX IF NOT EXISTS folios_status_due_idx ON public.folios (property_id, status);

-- aging view for receivables
CREATE OR REPLACE VIEW public.receivables_aging
WITH (security_invoker = true) AS
SELECT
  f.id                AS folio_id,
  f.property_id,
  f.booking_id,
  f.invoice_number,
  f.status,
  f.total_amount,
  f.paid_amount,
  f.balance_amount,
  b.guest_id,
  g.name              AS guest_name,
  g.mobile            AS guest_mobile,
  COALESCE(b.checked_out_at, co.authorized_at, f.settled_at, f.created_at) AS since_at,
  GREATEST(0, (CURRENT_DATE - COALESCE(b.checked_out_at, co.authorized_at, f.settled_at, f.created_at)::date))::int AS days_overdue,
  co.approved_by      AS authorized_by,
  co.reason           AS transfer_reason,
  co.amount_transferred
FROM public.folios f
LEFT JOIN public.bookings b ON b.id = f.booking_id
LEFT JOIN public.guests g ON g.id = b.guest_id
LEFT JOIN LATERAL (
  SELECT * FROM public.checkout_overrides c
   WHERE c.folio_id = f.id AND c.override_type = 'due_transfer'
   ORDER BY c.authorized_at DESC LIMIT 1
) co ON true
WHERE COALESCE(f.is_deleted, false) = false
  AND f.status = 'due'
  AND COALESCE(f.balance_amount, 0) > 0;

GRANT SELECT ON public.receivables_aging TO authenticated;
GRANT ALL ON public.receivables_aging TO service_role;