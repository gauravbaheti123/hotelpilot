import { supabase } from "@/integrations/supabase/client";

/**
 * Petty cash + cash-expense reconciliation helpers.
 *
 * The handover "cash" line keys off `payment_methods.name === "cash"`, which is
 * exactly the same literal used by `expenses.payment_mode`, so the two join
 * safely on the raw string.
 */
export const CASH_MODE = "cash";

export type PettyCashType = "opening" | "in" | "out";

export interface PettyCashEntry {
  id: string;
  property_id: string;
  entry_type: PettyCashType;
  amount: number;
  reason: string | null;
  created_by_name: string | null;
  created_at: string;
  handover_id: string | null;
}

export interface CashExpenseRow {
  id: string;
  amount: number;
  paid_at: string;
  paid_at_approx: boolean;
  description: string | null;
  reference: string | null;
}

export const PETTY_TYPE_LABEL: Record<PettyCashType, string> = {
  opening: "Opening float",
  in: "Cash in",
  out: "Cash out",
};

/** Signed contribution of an entry to the cash drawer. */
export function pettySign(t: PettyCashType): number {
  return t === "out" ? -1 : 1;
}

/** Petty cash entries not yet folded into a handover. */
export async function fetchUnreconciledPetty(propertyId: string): Promise<PettyCashEntry[]> {
  const { data, error } = await supabase
    .from("petty_cash_entries")
    .select("id,property_id,entry_type,amount,reason,created_by_name,created_at,handover_id")
    .eq("property_id", propertyId)
    .is("handover_id", null)
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown[]).map((r) => {
    const e = r as Record<string, unknown>;
    return {
      id: String(e.id),
      property_id: String(e.property_id),
      entry_type: e.entry_type as PettyCashType,
      amount: Number(e.amount ?? 0),
      reason: (e.reason as string) ?? null,
      created_by_name: (e.created_by_name as string) ?? null,
      created_at: String(e.created_at),
      handover_id: (e.handover_id as string) ?? null,
    };
  });
}

/** Cash expenses paid inside the open shift window and not yet reconciled. */
export async function fetchUnreconciledCashExpenses(
  propertyId: string,
  windowStart: string,
): Promise<CashExpenseRow[]> {
  const { data, error } = await supabase
    .from("expenses")
    .select("id,amount,paid_at,paid_at_approx,description,reference")
    .eq("property_id", propertyId)
    .eq("payment_mode", CASH_MODE)
    .is("handover_id", null)
    .gte("paid_at", windowStart)
    .order("paid_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown[]).map((r) => {
    const e = r as Record<string, unknown>;
    return {
      id: String(e.id),
      amount: Number(e.amount ?? 0),
      paid_at: String(e.paid_at ?? ""),
      paid_at_approx: Boolean(e.paid_at_approx),
      description: (e.description as string) ?? null,
      reference: (e.reference as string) ?? null,
    };
  });
}

export interface CashBreakdown {
  opening: number;
  payments: number;
  cashIn: number;
  cashOut: number;
  expenses: number;
  expected: number;
}

export function buildCashBreakdown(
  opening: number,
  payments: number,
  petty: PettyCashEntry[],
  expenses: CashExpenseRow[],
): CashBreakdown {
  // 'opening' typed petty entries are the drawer float itself: they are shown
  // separately (as the opening figure) only when no previous handover carried
  // a closing balance forward, so they are counted as cash-in here.
  const cashIn = petty.filter((p) => p.entry_type !== "out").reduce((s, p) => s + p.amount, 0);
  const cashOut = petty.filter((p) => p.entry_type === "out").reduce((s, p) => s + p.amount, 0);
  const exp = expenses.reduce((s, e) => s + e.amount, 0);
  return {
    opening,
    payments,
    cashIn,
    cashOut,
    expenses: exp,
    expected: Number((opening + payments + cashIn - cashOut - exp).toFixed(2)),
  };
}

/** Previous handover's closing float for this property (carry-forward). */
export async function fetchPreviousClosingCash(propertyId: string): Promise<number | null> {
  const { data } = await supabase
    .from("shift_handovers")
    .select("closing_cash,window_end,created_at")
    .eq("property_id", propertyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const v = (data as Record<string, unknown>).closing_cash;
  return v === null || v === undefined ? 0 : Number(v);
}
