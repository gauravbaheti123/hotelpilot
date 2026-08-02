import { supabase } from "@/integrations/supabase/client";
import { formatPaymentMethodLabel } from "@/hooks/use-payment-methods";
import { fmtINR } from "@/lib/reportExports";

export interface HandoverLineForPrint {
  mode: string;
  system_total: number;
  manual_entry: number;
  difference: number;
  note: string | null;
}

export interface HandoverForPrint {
  id: string;
  propertyId: string;
  propertyName: string;
  outgoing_user_name: string;
  incoming_user_name: string | null;
  window_start: string;
  window_end: string | null;
  submitted_at: string;
  notes: string | null;
  total_system: number;
  total_manual: number;
  total_difference: number;
  lines: HandoverLineForPrint[];
}

function fmtDT(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch {
    return String(iso);
  }
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

interface PaymentTx {
  id: string;
  amount: number;
  mode: string;
  paid_at: string;
  reference_no: string | null;
  bill_number: string | null;
}

async function fetchWindowPayments(
  propertyId: string,
  windowStart: string,
  windowEnd: string,
): Promise<PaymentTx[]> {
  // Mirrors the compute path used on the reconciliation screen: payments
  // by property, within [window_start, window_end]. Any change here MUST also
  // update StartHandoverPage's system-total query to keep Page 2 = Page 1.
  const { data, error } = await supabase
    .from("payments")
    .select("id,amount,mode,paid_at,reference_no,folios(invoice_number,bookings(booking_number))")
    .eq("property_id", propertyId)
    .gte("paid_at", windowStart)
    .lte("paid_at", windowEnd)
    .order("paid_at", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map((p) => ({
    id: p.id,
    amount: Number(p.amount ?? 0),
    mode: String(p.mode ?? ""),
    paid_at: p.paid_at,
    reference_no: p.reference_no ?? null,
    bill_number: p.folios?.invoice_number
      ?? p.folios?.bookings?.booking_number
      ?? null,
  }));
}

export async function printHandover(h: HandoverForPrint): Promise<void> {
  const windowEnd = h.window_end ?? h.submitted_at;
  let txs: PaymentTx[] = [];
  try {
    txs = await fetchWindowPayments(h.propertyId, h.window_start, windowEnd);
  } catch (e) {
    // Fall through with empty list; page 2 will show a note.
    console.warn("printHandover: fetchWindowPayments failed", e);
  }

  // Group txs by mode for Page-2 detail; totals recomputed for cross-check.
  const byMode = new Map<string, PaymentTx[]>();
  for (const t of txs) {
    if (!byMode.has(t.mode)) byMode.set(t.mode, []);
    byMode.get(t.mode)!.push(t);
  }
  const modeOrder = h.lines.map((l) => l.mode);
  for (const m of byMode.keys()) if (!modeOrder.includes(m)) modeOrder.push(m);

  const page1Rows = h.lines.map((l) => {
    const mismatch = Math.abs(l.difference) > 0.009;
    const sign = l.difference > 0 ? "+" : "";
    return `
      <tr${mismatch ? ' style="background:#fee2e2;"' : ""}>
        <td>${esc(formatPaymentMethodLabel(l.mode))}</td>
        <td class="num">${esc(fmtINR(l.system_total))}</td>
        <td class="num">${esc(fmtINR(l.manual_entry))}</td>
        <td class="num${mismatch ? ' mismatch' : ''}">${esc(sign + fmtINR(l.difference))}</td>
        <td>${esc(l.note ?? "")}</td>
      </tr>`;
  }).join("");

  const page1Totals = `
    <tr class="totals">
      <td>Totals</td>
      <td class="num">${esc(fmtINR(h.total_system))}</td>
      <td class="num">${esc(fmtINR(h.total_manual))}</td>
      <td class="num${Math.abs(h.total_difference) > 0.009 ? ' mismatch' : ''}">${esc((h.total_difference > 0 ? "+" : "") + fmtINR(h.total_difference))}</td>
      <td></td>
    </tr>`;

  const page2Summary = modeOrder.map((m) => {
    const list = byMode.get(m) ?? [];
    const sum = list.reduce((s, t) => s + t.amount, 0);
    return `
      <tr>
        <td>${esc(formatPaymentMethodLabel(m))}</td>
        <td class="num">${list.length}</td>
        <td class="num">${esc(fmtINR(sum))}</td>
      </tr>`;
  }).join("");

  const totalCount = txs.length;
  const totalAmount = txs.reduce((s, t) => s + t.amount, 0);

  const page2Detail = modeOrder.map((m) => {
    const list = byMode.get(m) ?? [];
    if (list.length === 0) return "";
    const sum = list.reduce((s, t) => s + t.amount, 0);
    const rows = list.map((t) => `
      <tr>
        <td>${esc(fmtDT(t.paid_at))}</td>
        <td>${esc(t.bill_number ?? t.reference_no ?? "—")}</td>
        <td class="num">${esc(fmtINR(t.amount))}</td>
      </tr>`).join("");
    return `
      <div class="mode-block">
        <h3>${esc(formatPaymentMethodLabel(m))} — ${list.length} txn · ${esc(fmtINR(sum))}</h3>
        <table class="detail">
          <thead><tr><th>Time</th><th>Bill / Ref</th><th class="num">Amount</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");

  // NOTE: parent app stylesheets are deliberately NOT inlined here.
  // src/styles.css ships `@media print { body * { visibility: hidden } }`
  // (scoped to #invoice-print-area), which blanked this print entirely.
  // The CSS below is fully self-contained.
  const css = `
    @page { size: A4 portrait; margin: 12mm; }
    * { visibility: visible !important; }
    html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; color: #000 !important; font-family: Arial, sans-serif; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-size: 10.5pt; line-height: 1.4; }
    .page { width: 100%; box-sizing: border-box; }
    .page.p1 { min-height: calc(297mm - 24mm); display: flex; flex-direction: column; page-break-after: always; }
    .page.p2 { page-break-before: always; }
    h1 { font-size: 16pt; margin: 0 0 2mm; }
    h2 { font-size: 12pt; margin: 6mm 0 2mm; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #000; padding-bottom: 1mm; }
    h3 { font-size: 11pt; margin: 4mm 0 1.5mm; }
    .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3mm 8mm; margin-bottom: 3mm; }
    .meta .lbl { font-size: 9pt; color: #444; text-transform: uppercase; letter-spacing: 0.4px; }
    .meta .val { font-weight: 600; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #000; padding: 2mm 3mm; text-align: left; vertical-align: top; font-size: 10pt; }
    th { background: #f1f5f9; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    tr.totals td { font-weight: 700; background: #f8fafc; }
    .mismatch { color: #b91c1c; font-weight: 700; }
    .notes { margin-top: 3mm; padding: 2mm 3mm; border: 1px dashed #666; font-size: 10pt; }
    .signatures { margin-top: auto; padding-top: 18mm; display: grid; grid-template-columns: 1fr 1fr; gap: 20mm; }
    .sig .line { border-top: 1px solid #000; height: 0; margin-top: 16mm; }
    .sig .role { font-size: 9pt; text-transform: uppercase; color: #333; margin-top: 1.5mm; }
    .sig .name { font-size: 10pt; font-weight: 600; margin-top: 0.5mm; }
    .mode-block { break-inside: avoid; margin-bottom: 4mm; }
    table.detail th, table.detail td { padding: 1.5mm 2.5mm; font-size: 9.5pt; }
  `;

  const overallNotes = h.notes && h.notes.trim()
    ? `<div class="notes"><b>Overall Notes:</b> ${esc(h.notes)}</div>`
    : "";

  const page1 = `
    <div class="page p1">
      <h1>Shift Handover — ${esc(h.propertyName)}</h1>
      <div class="meta">
        <div><div class="lbl">Outgoing Manager</div><div class="val">${esc(h.outgoing_user_name)}</div></div>
        <div><div class="lbl">Incoming Manager</div><div class="val">${esc(h.incoming_user_name ?? "—")}</div></div>
        <div><div class="lbl">Window Start</div><div class="val">${esc(fmtDT(h.window_start))}</div></div>
        <div><div class="lbl">Submitted At</div><div class="val">${esc(fmtDT(h.submitted_at))}</div></div>
      </div>
      <h2>Payment Mode Reconciliation</h2>
      <table>
        <thead><tr>
          <th>Payment Mode</th>
          <th class="num">System Auto Total</th>
          <th class="num">Manual Entry</th>
          <th class="num">Difference</th>
          <th>Note</th>
        </tr></thead>
        <tbody>${page1Rows}${page1Totals}</tbody>
      </table>
      ${overallNotes}
      <div class="signatures">
        <div class="sig">
          <div class="line"></div>
          <div class="role">Outgoing Manager Signature</div>
          <div class="name">${esc(h.outgoing_user_name)}</div>
        </div>
        <div class="sig">
          <div class="line"></div>
          <div class="role">Incoming Manager Signature</div>
          <div class="name">${esc(h.incoming_user_name ?? "____________________")}</div>
        </div>
      </div>
    </div>`;

  const page2 = `
    <div class="page p2">
      <h1>Calculation Detail</h1>
      <div class="meta">
        <div><div class="lbl">Property</div><div class="val">${esc(h.propertyName)}</div></div>
        <div><div class="lbl">Window</div><div class="val">${esc(fmtDT(h.window_start))} → ${esc(fmtDT(windowEnd))}</div></div>
      </div>
      <h2>Per-Mode Summary</h2>
      <table>
        <thead><tr><th>Payment Mode</th><th class="num">Transactions</th><th class="num">System Total</th></tr></thead>
        <tbody>
          ${page2Summary}
          <tr class="totals"><td>Totals</td><td class="num">${totalCount}</td><td class="num">${esc(fmtINR(totalAmount))}</td></tr>
        </tbody>
      </table>
      <h2>Transaction Detail</h2>
      ${page2Detail || '<p style="font-size:10pt;color:#666;">No transactions in this window.</p>'}
    </div>`;

  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>Handover ${esc(h.id.slice(0, 8))}</title><style>${css}</style></head><body>${page1}${page2}</body></html>`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed", right: "0", bottom: "0",
    width: "0", height: "0", border: "0", opacity: "0",
  });
  document.body.appendChild(iframe);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { iframe.parentNode?.removeChild(iframe); } catch { /* noop */ }
  };
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) { cleanup(); return; }
    try { win.focus(); } catch { /* noop */ }
    try { win.addEventListener("afterprint", () => setTimeout(cleanup, 200)); } catch { /* noop */ }
    setTimeout(() => {
      try { win.print(); } catch { cleanup(); }
      setTimeout(cleanup, 60_000);
    }, 80);
  };
  iframe.srcdoc = doc;
}