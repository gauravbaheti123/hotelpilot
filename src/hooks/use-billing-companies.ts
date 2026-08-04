/**
 * Part 2 (perf) — cached billing-companies read. The audit measured this as a
 * slow statement (176ms mean, 44s total over 252 calls) re-issued by every
 * Bill To / checkout screen mount.
 */
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { reportQueryError } from "@/lib/queryError";

export interface BillingCompanyRow {
  id: string;
  name: string;
  gstin: string | null;
  gst_status: string | null;
  address: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  nation: string | null;
}

export const billingCompaniesQueryKey = (propertyId: string | null | undefined) =>
  ["billing-companies", propertyId ?? null] as const;

export function useBillingCompanies(propertyId: string | null | undefined) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: billingCompaniesQueryKey(propertyId),
    enabled: !!propertyId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<BillingCompanyRow[]> => {
      const { data, error } = await supabase
        .from("billing_companies")
        .select("id,name,gstin,gst_status,address,email,city,state,nation")
        .eq("property_id", propertyId!)
        .eq("is_active", true)
        .order("name");
      if (error) reportQueryError("billing companies", error);
      return (data ?? []) as unknown as BillingCompanyRow[];
    },
  });

  /** Call after inserting a new billing company so pickers pick it up. */
  const reload = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: billingCompaniesQueryKey(propertyId) });
  }, [qc, propertyId]);

  return { companies: data ?? [], loading: isLoading, reload };
}