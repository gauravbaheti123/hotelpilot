import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PaymentMethodOption {
  id: string;
  name: string;
  is_default: boolean;
  is_active: boolean;
  display_order: number;
}

const FALLBACK: PaymentMethodOption[] = [
  { id: "cash", name: "cash", is_default: true, is_active: true, display_order: 1 },
  { id: "card", name: "card", is_default: true, is_active: true, display_order: 2 },
  { id: "upi",  name: "upi",  is_default: true, is_active: true, display_order: 3 },
];

/**
 * Loads active payment methods for a property, sorted by display order.
 * Returns a safe default (Cash / Card / UPI) while loading or if the fetch fails.
 */
export function usePaymentMethods(propertyId: string | null | undefined) {
  const [methods, setMethods] = useState<PaymentMethodOption[]>(FALLBACK);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!propertyId) return;
      setLoading(true);
      const { data, error } = await supabase
        .from("payment_methods" as any)
        .select("id,name,is_default,is_active,display_order")
        .eq("property_id", propertyId)
        .eq("is_active", true)
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });
      if (!cancelled) {
        if (!error && data && (data as any[]).length > 0) {
          setMethods(data as unknown as PaymentMethodOption[]);
        }
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [propertyId]);

  return { methods, loading };
}

export function formatPaymentMethodLabel(name: string): string {
  if (!name) return "";
  const spaced = name.replace(/[_-]+/g, " ").trim();
  return spaced
    .split(/\s+/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}
