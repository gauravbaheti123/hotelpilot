
-- ============================================================
-- BATCH 1 — KOT idempotency, per-category GST, visit count
-- ============================================================

-- 1. KOT IDEMPOTENCY -----------------------------------------
ALTER TABLE public.kot_orders
  ADD COLUMN IF NOT EXISTS client_ref uuid;

-- Partial unique index: only enforces when client_ref is provided.
CREATE UNIQUE INDEX IF NOT EXISTS kot_orders_property_client_ref_uniq
  ON public.kot_orders (property_id, client_ref)
  WHERE client_ref IS NOT NULL;

-- 2. PER-CATEGORY GST ----------------------------------------
-- room_categories.gst_rate (integer percent, default 12)
ALTER TABLE public.room_categories
  ADD COLUMN IF NOT EXISTS gst_rate integer NOT NULL DEFAULT 12;

-- menu_items already has gst_rate numeric — no new column needed.
-- Normalise NULLs and ensure default 5 for food.
UPDATE public.menu_items SET gst_rate = 5 WHERE gst_rate IS NULL;
ALTER TABLE public.menu_items
  ALTER COLUMN gst_rate SET DEFAULT 5;

-- 3. GUEST VISIT COUNT ---------------------------------------
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS visit_count integer NOT NULL DEFAULT 0;

-- Trigger function: increment guest visit_count when a booking
-- transitions into checked_in.
CREATE OR REPLACE FUNCTION public.tg_bump_guest_visit_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'checked_in'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'checked_in')
     AND NEW.guest_id IS NOT NULL THEN
    UPDATE public.guests
       SET visit_count = COALESCE(visit_count, 0) + 1,
           updated_at = now()
     WHERE id = NEW.guest_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_guest_visit_count ON public.bookings;
CREATE TRIGGER trg_bump_guest_visit_count
AFTER INSERT OR UPDATE OF status ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.tg_bump_guest_visit_count();

-- Backfill existing visit counts from historical checked_in / checked_out bookings.
UPDATE public.guests g
   SET visit_count = sub.cnt
  FROM (
    SELECT guest_id, COUNT(*)::int AS cnt
      FROM public.bookings
     WHERE guest_id IS NOT NULL
       AND status IN ('checked_in','checked_out')
     GROUP BY guest_id
  ) sub
 WHERE g.id = sub.guest_id;
