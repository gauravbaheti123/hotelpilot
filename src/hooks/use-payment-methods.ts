import { useQuery } from "@tanstack/react-query";
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

export const paymentMethodsQueryKey = (propertyId: string | null | undefined) =>
  ["payment-methods", propertyId ?? null] as const;

/**
 * Loads active payment methods for a property, sorted by display order.
 * Returns a safe default (Cash / Card / UPI) while loading or if the fetch fails.
 *
 * Part 2 (perf) — backed by TanStack Query so the same property's methods are
 * fetched once and shared by every payment form.
 */
export function usePaymentMethods(propertyId: string | null | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: paymentMethodsQueryKey(propertyId),
    enabled: !!propertyId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<PaymentMethodOption[]> => {
      const { data, error } = await supabase
        .from("payment_methods" as any)
        .select("id,name,is_default,is_active,display_order")
        .eq("property_id", propertyId!)
        .eq("is_active", true)
        .order("display_order", { ascending: true })
        .order("name", { ascending: true });
      // Keep the safe default rather than surfacing an empty picker.
      if (error || !data || (data as any[]).length === 0) return FALLBACK;
      return data as unknown as PaymentMethodOption[];
    },
  });

  return { methods: data ?? FALLBACK, loading: isLoading };
}

export function formatPaymentMethodLabel(name: string): string {
  if (!name) return "";
  const spaced = name.replace(/[_-]+/g, " ").trim();
  return spaced
    .split(/\s+/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}
