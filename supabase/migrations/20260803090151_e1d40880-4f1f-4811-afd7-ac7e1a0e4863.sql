-- 1. Enum + table
DO $$ BEGIN
  CREATE TYPE public.petty_cash_entry_type AS ENUM ('opening','in','out');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.petty_cash_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  entry_type public.petty_cash_entry_type NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reason text,
  created_by uuid,
  created_by_name text,
  handover_id uuid REFERENCES public.shift_handovers(id) ON DELETE SET NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_by uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.petty_cash_entries TO authenticated;
GRANT ALL ON public.petty_cash_entries TO service_role;

ALTER TABLE public.petty_cash_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY petty_cash_entries_view ON public.petty_cash_entries FOR SELECT
USING (has_permission(auth.uid(), property_id, 'shift_handover'::text, 'view'::text));

CREATE POLICY petty_cash_entries_create ON public.petty_cash_entries FOR INSERT
WITH CHECK (
  has_permission(auth.uid(), property_id, 'shift_handover'::text, 'create'::text)
  AND created_by = auth.uid()
);

CREATE POLICY petty_cash_entries_edit ON public.petty_cash_entries FOR UPDATE
USING (has_permission(auth.uid(), property_id, 'shift_handover'::text, 'create'::text))
WITH CHECK (has_permission(auth.uid(), property_id, 'shift_handover'::text, 'create'::text));

CREATE POLICY petty_cash_entries_delete ON public.petty_cash_entries FOR DELETE
USING (has_permission(auth.uid(), property_id, 'shift_handover'::text, 'delete'::text));

CREATE INDEX IF NOT EXISTS idx_petty_cash_open
  ON public.petty_cash_entries (property_id, created_at)
  WHERE handover_id IS NULL AND is_deleted = false;

CREATE TRIGGER trg_petty_cash_updated_at
  BEFORE UPDATE ON public.petty_cash_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Mandatory reason for in/out (trigger, not CHECK, to keep it explicit)
CREATE OR REPLACE FUNCTION public.tg_petty_cash_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.entry_type IN ('in','out') AND COALESCE(btrim(NEW.reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required for cash in/out entries';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_petty_cash_validate
  BEFORE INSERT OR UPDATE ON public.petty_cash_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_petty_cash_validate();

-- 2. expenses.paid_at + reconciliation link
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at_approx boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handover_id uuid REFERENCES public.shift_handovers(id) ON DELETE SET NULL;

UPDATE public.expenses
   SET paid_at = (expense_date::timestamp + interval '12 hours') AT TIME ZONE 'Asia/Kolkata',
       paid_at_approx = true
 WHERE paid_at IS NULL;

ALTER TABLE public.expenses ALTER COLUMN paid_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_expenses_cash_unreconciled
  ON public.expenses (property_id, paid_at)
  WHERE handover_id IS NULL;

-- 3. shift_handovers float columns
ALTER TABLE public.shift_handovers
  ADD COLUMN IF NOT EXISTS opening_cash numeric(12,2),
  ADD COLUMN IF NOT EXISTS closing_cash numeric(12,2);
