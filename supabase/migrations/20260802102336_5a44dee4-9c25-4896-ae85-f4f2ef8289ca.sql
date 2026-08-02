WITH ranked AS (
  SELECT id, property_id, lower(btrim(name)) AS n,
         row_number() OVER (
           PARTITION BY property_id, lower(btrim(name))
           ORDER BY (nullif(btrim(coalesce(gstin,'')),'') IS NULL), created_at
         ) AS rn,
         first_value(id) OVER (
           PARTITION BY property_id, lower(btrim(name))
           ORDER BY (nullif(btrim(coalesce(gstin,'')),'') IS NULL), created_at
         ) AS keeper
    FROM public.billing_companies
),
dupes AS (SELECT id, keeper FROM ranked WHERE rn > 1)
UPDATE public.bookings b
   SET billing_company_id = d.keeper
  FROM dupes d
 WHERE b.billing_company_id = d.id;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY property_id, lower(btrim(name))
           ORDER BY (nullif(btrim(coalesce(gstin,'')),'') IS NULL), created_at
         ) AS rn
    FROM public.billing_companies
)
DELETE FROM public.billing_companies bc
 USING ranked r
 WHERE bc.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS billing_companies_property_name_uniq
  ON public.billing_companies (property_id, lower(btrim(name)));