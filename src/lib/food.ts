export const KOT_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  printed: "Printed",
  served: "Served",
  billed: "Billed",
  void: "Void",
};

export const KOT_STATUS_TONE: Record<string, string> = {
  open: "bg-amber-100 text-amber-800 border-amber-300",
  printed: "bg-blue-100 text-blue-800 border-blue-300",
  served: "bg-emerald-100 text-emerald-800 border-emerald-300",
  billed: "bg-slate-200 text-slate-700 border-slate-300",
  void: "bg-rose-100 text-rose-800 border-rose-300",
};

export function computeKotTotals(
  items: { qty: number; rate: number; gst_rate: number; is_void?: boolean }[],
) {
  let sub = 0;
  let gst = 0;
  for (const it of items) {
    if (it.is_void) continue;
    const amt = Number(it.qty) * Number(it.rate);
    sub += amt;
    gst += amt * (Number(it.gst_rate) / 100);
  }
  return {
    sub_total: Math.round(sub * 100) / 100,
    gst_amount: Math.round(gst * 100) / 100,
    total_amount: Math.round((sub + gst) * 100) / 100,
  };
}