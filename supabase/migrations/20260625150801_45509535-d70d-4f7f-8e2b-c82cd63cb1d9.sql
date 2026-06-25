
-- ===== 1. bill_sequences =====
CREATE TABLE IF NOT EXISTS public.bill_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  sequence_type TEXT NOT NULL CHECK (sequence_type IN ('regular','event')),
  last_number INTEGER NOT NULL DEFAULT 0,
  prefix TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, sequence_type)
);

GRANT SELECT ON public.bill_sequences TO authenticated;
GRANT ALL ON public.bill_sequences TO service_role;
ALTER TABLE public.bill_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read bill_sequences" ON public.bill_sequences
  FOR SELECT TO authenticated
  USING (public.user_has_property(auth.uid(), property_id));

INSERT INTO public.bill_sequences (property_id, sequence_type, last_number, prefix)
SELECT id, 'regular', 0, 'BILL' FROM public.properties
ON CONFLICT (property_id, sequence_type) DO NOTHING;

INSERT INTO public.bill_sequences (property_id, sequence_type, last_number, prefix)
SELECT id, 'event', 0, 'EVENT' FROM public.properties
ON CONFLICT (property_id, sequence_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_bill_sequences_for_property()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.bill_sequences (property_id, sequence_type, last_number, prefix) VALUES
    (NEW.id, 'regular', 0, 'BILL'),
    (NEW.id, 'event',   0, 'EVENT')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_create_bill_sequences ON public.properties;
CREATE TRIGGER trg_create_bill_sequences
  AFTER INSERT ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.create_bill_sequences_for_property();

CREATE OR REPLACE FUNCTION public.get_next_bill_number(p_property_id UUID, p_type TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_next INTEGER; v_prefix TEXT;
BEGIN
  -- ensure row exists
  INSERT INTO public.bill_sequences (property_id, sequence_type, last_number, prefix)
  VALUES (p_property_id, p_type, 0, CASE WHEN p_type='event' THEN 'EVENT' ELSE 'BILL' END)
  ON CONFLICT (property_id, sequence_type) DO NOTHING;

  UPDATE public.bill_sequences
     SET last_number = last_number + 1, updated_at = now()
   WHERE property_id = p_property_id AND sequence_type = p_type
   RETURNING last_number, prefix INTO v_next, v_prefix;

  RETURN v_prefix || LPAD(v_next::TEXT, 3, '0');
END $$;

REVOKE EXECUTE ON FUNCTION public.get_next_bill_number(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_next_bill_number(UUID, TEXT) TO authenticated, service_role;

-- ===== 2. Replace folio invoice number trigger to use BILL sequence =====
CREATE OR REPLACE FUNCTION public.tg_assign_invoice_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    RETURN NEW;
  END IF;
  NEW.invoice_number := public.get_next_bill_number(NEW.property_id, 'regular');
  RETURN NEW;
END $$;

-- ===== 3. Replace banquet number trigger to use EVENT sequence =====
CREATE OR REPLACE FUNCTION public.tg_assign_banquet_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.banquet_number IS NOT NULL AND NEW.banquet_number <> '' THEN
    RETURN NEW;
  END IF;
  NEW.banquet_number := public.get_next_bill_number(NEW.property_id, 'event');
  RETURN NEW;
END $$;

-- ===== 4. banquet_bookings extras =====
ALTER TABLE public.banquet_bookings
  ADD COLUMN IF NOT EXISTS event_name TEXT,
  ADD COLUMN IF NOT EXISTS event_bill_id UUID,
  ADD COLUMN IF NOT EXISTS total_room_charges NUMERIC(12,2) NOT NULL DEFAULT 0;

-- ===== 5. event_room_blocks =====
CREATE TABLE IF NOT EXISTS public.event_room_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  banquet_booking_id UUID NOT NULL REFERENCES public.banquet_bookings(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  room_number TEXT,
  room_category TEXT,
  guest_id UUID REFERENCES public.guests(id) ON DELETE SET NULL,
  guest_name TEXT,
  guest_mobile TEXT,
  checkin_date DATE NOT NULL,
  checkout_date DATE NOT NULL,
  special_rate NUMERIC(10,2),
  status TEXT NOT NULL DEFAULT 'blocked' CHECK (status IN ('blocked','checked_in','checked_out','cancelled')),
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  checked_in_at TIMESTAMPTZ,
  checked_in_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  checked_out_at TIMESTAMPTZ,
  checked_out_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_room_blocks_event ON public.event_room_blocks(banquet_booking_id);
CREATE INDEX IF NOT EXISTS idx_event_room_blocks_property ON public.event_room_blocks(property_id, status);
CREATE INDEX IF NOT EXISTS idx_event_room_blocks_room ON public.event_room_blocks(room_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_room_blocks TO authenticated;
GRANT ALL ON public.event_room_blocks TO service_role;

ALTER TABLE public.event_room_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant access event_room_blocks" ON public.event_room_blocks
  FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id))
  WITH CHECK (public.user_has_property(auth.uid(), property_id));

DROP TRIGGER IF EXISTS trg_event_room_blocks_updated_at ON public.event_room_blocks;
CREATE TRIGGER trg_event_room_blocks_updated_at
  BEFORE UPDATE ON public.event_room_blocks
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS trg_bill_sequences_updated_at ON public.bill_sequences;
CREATE TRIGGER trg_bill_sequences_updated_at
  BEFORE UPDATE ON public.bill_sequences
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
