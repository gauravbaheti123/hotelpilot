/**
 * One shared rule for turning a folio charge into a revenue category, so the
 * invoice GST breakup and every report agree. Direct restaurant postings used
 * to fall into "Others" because they are stored as `charge_type = 'extra'`;
 * they are now resolved to their outlet (Restaurant, Fast Food, Sweets …)
 * through `restaurant_direct_charges.folio_charge_id`, with a description
 * fallback for rows re-created by split/undo flows.
 */
export interface CategorisableCharge {
  id?: string | null;
  charge_type?: string | null;
  description?: string | null;
}

export interface ChargeCategory {
  key: string;
  label: string;
}

const FIXED: Record<string, ChargeCategory> = {
  room: { key: "room", label: "Accommodation" },
  food: { key: "food", label: "Food & Beverage" },
  laundry: { key: "laundry", label: "Laundry" },
  early_checkin: { key: "early_checkin", label: "Early Check-in" },
  extra_bed: { key: "extra_bed", label: "Extra Bed" },
  sundry: { key: "sundry", label: "Sundry / POS" },
  discount: { key: "discount", label: "Discount" },
  tax: { key: "tax", label: "Tax" },
};

export const OTHERS: ChargeCategory = { key: "other", label: "Others" };

/** Stable ordering for summaries — known buckets first, outlets, then Others. */
const ORDER = ["room", "early_checkin", "extra_bed", "food", "laundry", "sundry"];

export function categoryKeyOrder(key: string): number {
  const i = ORDER.indexOf(key);
  if (i >= 0) return i;
  if (key === "other") return 900;
  return 500; // outlet categories sit between the fixed ones and Others
}

function titleise(name: string): string {
  const t = name.trim().replace(/\s+/g, " ");
  if (!t) return "";
  if (t === t.toUpperCase() || t === t.toLowerCase()) {
    return t.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());
  }
  return t;
}

/** Outlet name pulled out of "Restaurant Charge — FASTFOOD Charge (Bill No 1)". */
function outletFromDescription(description: string | null | undefined): string | null {
  const d = String(description ?? "").trim();
  const m = d.match(/^restaurant\s+charge\s*[—–-]\s*(.+)$/i);
  if (!m) return /^restaurant\s+charge/i.test(d) ? "Restaurant" : null;
  let rest = m[1]!.replace(/\(bill\s*no[^)]*\)/i, "").trim();
  rest = rest.replace(/\s+charges?$/i, "").trim();
  if (!rest || /^direct$/i.test(rest)) return "Restaurant";
  return titleise(rest);
}

/**
 * @param outletByChargeId folio_charge_id -> outlet name (from restaurant_direct_charges)
 */
export function categoriseCharge(
  charge: CategorisableCharge,
  outletByChargeId?: Map<string, string>,
): ChargeCategory {
  const type = String(charge.charge_type ?? "").toLowerCase();
  const fixed = FIXED[type];
  if (fixed) return fixed;

  const linked = charge.id ? outletByChargeId?.get(String(charge.id)) : undefined;
  const outlet = titleise(linked ?? "") || outletFromDescription(charge.description);
  if (outlet) {
    return { key: `outlet:${outlet.toLowerCase()}`, label: `${outlet} Charges` };
  }
  return OTHERS;
}

/** Build the folio_charge_id -> outlet-name map from restaurant_direct_charges rows. */
export function buildOutletMap(
  rows: Array<{ folio_charge_id?: string | null; description?: string | null; restaurant_outlets?: { name?: string | null } | null }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (!r.folio_charge_id) continue;
    const name = r.restaurant_outlets?.name ?? outletFromDescription(r.description) ?? "";
    if (name) map.set(String(r.folio_charge_id), titleise(name));
  }
  return map;
}
