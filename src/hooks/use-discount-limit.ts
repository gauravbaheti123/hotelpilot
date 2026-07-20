import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePropertyId } from "@/hooks/use-property";
import { useAuth } from "@/hooks/use-auth";
import {
  NO_DISCOUNT,
  UNLIMITED_DISCOUNT,
  type DiscountLimit,
  type DiscountLimitType,
} from "@/lib/discountLimit";

/**
 * Reads the signed-in user's discount limit for the current property.
 * Owner/Superadmin => unlimited.
 * Falls back to NO_DISCOUNT when the RPC fails or returns nothing.
 */
export function useDiscountLimit(): { limit: DiscountLimit; loading: boolean } {
  const propertyId = usePropertyId();
  const { roles } = useAuth();
  const isPrivileged = roles.includes("owner") || roles.includes("superadmin");
  const [limit, setLimit] = useState<DiscountLimit>(isPrivileged ? UNLIMITED_DISCOUNT : NO_DISCOUNT);
  const [loading, setLoading] = useState(!isPrivileged);

  useEffect(() => {
    if (isPrivileged) {
      setLimit(UNLIMITED_DISCOUNT);
      setLoading(false);
      return;
    }
    if (!propertyId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id ?? "";
      const { data, error } = await supabase.rpc("user_discount_limit", {
        _user_id: uid,
        _property_id: propertyId,
      });
      if (cancelled) return;
      const row = Array.isArray(data) ? data[0] : (data as any);
      if (error || !row) {
        setLimit(NO_DISCOUNT);
      } else {
        setLimit({
          limitType: (row.limit_type as DiscountLimitType) ?? "none",
          limitValue: Number(row.limit_value ?? 0),
          unlimited: !!row.unlimited,
        });
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [propertyId, isPrivileged]);

  return { limit, loading };
}