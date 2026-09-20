-- Guarded wrapper around public.split_folio_bill.
-- When the caller declares full coverage (item-mode split of the whole bill),
-- every live charge line of the parent bill must be carried onto the new bills,
-- and the amounts must match line-group by line-group. A split that silently
-- drops a room night (or any other line) is rejected and rolled back.
CREATE OR REPLACE FUNCTION public.split_folio_bill_v2(_folio_id uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_coverage   text := COALESCE(NULLIF(btrim(COALESCE(_payload->>'coverage','')), ''), 'scope');
  v_parent_sum numeric := 0;
  v_child_sum  numeric := 0;
  v_missing    text;
BEGIN
  IF v_coverage = 'full' THEN
    SELECT COALESCE(SUM(c.amount), 0) INTO v_parent_sum
      FROM public.folio_charges c
     WHERE c.folio_id = _folio_id
       AND COALESCE(c.is_wiped, false) = false;

    SELECT COALESCE(SUM((ch->>'amount')::numeric), 0) INTO v_child_sum
      FROM jsonb_array_elements(COALESCE(_payload->'children', '[]'::jsonb)) kid,
           jsonb_array_elements(COALESCE(kid->'charges', '[]'::jsonb)) ch;

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
         WHERE c.folio_id = _folio_id
           AND COALESCE(c.is_wiped, false) = false
         GROUP BY 1
      ) p
      LEFT JOIN (
        SELECT COALESCE(NULLIF(ch->>'source_table',''),'') || ':' || COALESCE(NULLIF(ch->>'source_id',''),'') || ':' || COALESCE(ch->>'charge_type','misc') AS k,
               SUM((ch->>'amount')::numeric) AS amt
          FROM jsonb_array_elements(COALESCE(_payload->'children', '[]'::jsonb)) kid,
               jsonb_array_elements(COALESCE(kid->'charges', '[]'::jsonb)) ch
         GROUP BY 1
      ) c ON c.k = p.k
     WHERE abs(COALESCE(c.amt, 0) - p.amt) > 1.0;

    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION
        'Split rejected: these charge lines of the original bill were not carried to the new bills — %. Nothing was changed.',
        v_missing;
    END IF;
  END IF;

  RETURN public.split_folio_bill(_folio_id, _payload);
END $function$;

REVOKE ALL ON FUNCTION public.split_folio_bill_v2(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.split_folio_bill_v2(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.split_folio_bill_v2(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_folio_bill_v2(uuid, jsonb) TO service_role;