UPDATE public.tariff_plans tp
SET extra_adult_rate = rc.extra_bed_rate,
    updated_at = now()
FROM public.room_categories rc
WHERE tp.category_id = rc.id
  AND COALESCE(tp.extra_adult_rate, 0) = 0
  AND COALESCE(rc.extra_bed_rate, 0) > 0;