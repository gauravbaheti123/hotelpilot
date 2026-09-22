-- Conservation of a bill split, enforced at COMMIT by the database itself.
--
-- The existing check lives inside public.split_folio_bill. A short split still
-- got through on 22 Sept (Room 309), so the same rule is now a deferred
-- constraint trigger: whatever code path creates child bills, the transaction
-- cannot commit unless the children carry every live line of the parent.

CREATE OR REPLACE FUNCTION public.assert_split_children_conserve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent     uuid := NEW.parent_folio_id;
  v_parent_sum numeric := 0;
  v_child_sum  numeric := 0;
  v_is_share   boolean := false;
  v_missing    text;
BEGIN
  IF v_parent IS NULL THEN
    RETURN NULL;
  END IF;

  -- Percentage / amount "share" splits deliberately create synthetic lines and
  -- may cover only part of the bill; they keep only the "must not exceed" rule
  -- that split_folio_bill already applies.
  SELECT EXISTS (
    SELECT 1
      FROM public.folio_charges c
      JOIN public.folios f ON f.id = c.folio_id
     WHERE f.parent_folio_id = v_parent
       AND COALESCE(c.is_wiped, false) = false
       AND c.charge_type = 'share'
  ) INTO v_is_share;
  IF v_is_share THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(c.amount), 0) INTO v_parent_sum
    FROM public.folio_charges c
   WHERE c.folio_id = v_parent
     AND COALESCE(c.is_wiped, false) = false;

  IF v_parent_sum <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(c.amount), 0) INTO v_child_sum
    FROM public.folio_charges c
    JOIN public.folios f ON f.id = c.folio_id
   WHERE f.parent_folio_id = v_parent
     AND COALESCE(f.is_deleted, false) = false
     AND COALESCE(f.status, '') NOT IN ('void', 'refunded')
     AND COALESCE(c.is_wiped, false) = false;

  IF abs(v_child_sum - v_parent_sum) > 1.0 THEN
    RAISE EXCEPTION
      'Split rejected: the new bills carry charges of %, but the original bill has %. Nothing was changed — refresh the bill and try again.',
      round(v_child_sum, 2), round(v_parent_sum, 2);
  END IF;

  SELECT string_agg(p.label, ', ' ORDER BY p.label) INTO v_missing
    FROM (
      SELECT COALESCE(c.source_table,'') || ':' || COALESCE(c.source_id::text,'') || ':' || c.charge_type AS k,
             min(c.description) AS label,
             SUM(c.amount) AS amt
        FROM public.folio_charges c
       WHERE c.folio_id = v_parent
         AND COALESCE(c.is_wiped, false) = false
       GROUP BY 1
    ) p
    LEFT JOIN (
      SELECT COALESCE(c.source_table,'') || ':' || COALESCE(c.source_id::text,'') || ':' || c.charge_type AS k,
             SUM(c.amount) AS amt
        FROM public.folio_charges c
        JOIN public.folios f ON f.id = c.folio_id
       WHERE f.parent_folio_id = v_parent
         AND COALESCE(f.is_deleted, false) = false
         AND COALESCE(f.status, '') NOT IN ('void', 'refunded')
         AND COALESCE(c.is_wiped, false) = false
       GROUP BY 1
    ) k ON k.k = p.k
   WHERE abs(COALESCE(k.amt, 0) - p.amt) > 1.0;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Split rejected: these charge lines of the original bill were not carried to the new bills — %. Nothing was changed.',
      v_missing;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_split_children_conserve ON public.folios;

CREATE CONSTRAINT TRIGGER trg_split_children_conserve
AFTER INSERT ON public.folios
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NEW.parent_folio_id IS NOT NULL)
EXECUTE FUNCTION public.assert_split_children_conserve();

COMMENT ON FUNCTION public.assert_split_children_conserve() IS
  'Commit-time guarantee that split child bills carry every live charge line of their parent bill.';
