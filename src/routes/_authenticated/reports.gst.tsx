import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentProperty } from "@/hooks/use-property";
import { fetchGstInvoiceSlabs, type GstInvoiceSlabRow } from "@/lib/reports";
import { ReportShell } from "@/components/ReportShell";
import { RequirePermission } from "@/components/RequirePermission";
import {
  ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR,
  buildTallySalesXml, downloadXml, buildFileName,
} from "@/lib/reportExports";

export const Route = createFileRoute("/_authenticated/reports/gst")({
  head: () => ({ meta: [{ title: "GST Report — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><GstReportPage /></RequirePermission>),
});

function monthBounds(month: string): [string, string] {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  const f = (d: Date) => {
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  return [f(start), f(end)];
}

function GstReportPage() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [rows, setRows] = useState<GstInvoiceSlabRow[]>([]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    const [f, t] = monthBounds(month);
    setRows(await fetchGstInvoiceSlabs(propertyId, f, t));
  }, [propertyId, month]);

  useEffect(() => { load(); }, [load]);

  const [from, to] = monthBounds(month);

  // Per-slab display: CGST% = SGST% = gst_rate / 2 (clean slab, no blending).
  const display = useMemo(() => rows.map((r) => ({
    ...r,
    cgstPct: r.gst_rate / 2,
    sgstPct: r.gst_rate / 2,
  })), [rows]);

  const totals = useMemo(() => {
    let taxable = 0, gst = 0, invoice = 0;
    for (const r of rows) {
      taxable += Number(r.taxable ?? 0);
      gst += Number(r.gst_total ?? 0);
      invoice += Number(r.invoice_total ?? 0); // only counted on first slab row
    }
    return { taxable, gst, invoice, cgst: gst / 2, sgst: gst / 2 };
  }, [rows]);

  type Display = GstInvoiceSlabRow & { cgstPct: number; sgstPct: number };
  const columns: ReportColumn<Display>[] = [
    { key: "bill_no", header: "Bill No", get: (r) => r.is_first_of_invoice ? r.invoice_number : "" },
    { key: "date", header: "Date", get: (r) => r.is_first_of_invoice ? fmtDate(r.created_at) : "" },
    { key: "guest", header: "Guest Name", get: (r) => r.is_first_of_invoice ? (r.guest_name ?? "") : "" },
    { key: "gstin", header: "GSTIN", get: (r) => r.is_first_of_invoice ? (r.guest_gstin ?? "") : "" },
    { key: "tax", header: "Taxable", get: (r) => r.taxable, currency: true },
    { key: "cgstpct", header: "CGST %", get: (r) => r.cgstPct },
    { key: "cgst", header: "CGST Amt", get: (r) => r.cgst, currency: true },
    { key: "sgstpct", header: "SGST %", get: (r) => r.sgstPct },
    { key: "sgst", header: "SGST Amt", get: (r) => r.sgst, currency: true },
    { key: "totalgst", header: "Total GST", get: (r) => r.gst_total, currency: true },
    { key: "invtotal", header: "Invoice Total", get: (r) => r.is_first_of_invoice ? r.invoice_total : "", currency: true },
  ];

  const meta = { reportName: "GST Report", propertyName: current?.name ?? "Property", from, to,
    totals: [
      ["Total Taxable", fmtINR(totals.taxable)],
      ["Total CGST", fmtINR(totals.cgst)],
      ["Total SGST", fmtINR(totals.sgst)],
      ["Total GST", fmtINR(totals.gst)],
      ["Total Invoice Value", fmtINR(totals.invoice)],
    ] as [string, string|number][] };

  function tallyXml() {
    // Tally: one voucher per invoice (aggregated across slabs).
    const byInvoice = new Map<string, {
      date: string; voucher_number: string; guest_name: string;
      taxable_amount: number; cgst_amount: number; sgst_amount: number; total_amount: number;
    }>();
    for (const r of display) {
      const v = byInvoice.get(r.invoice_number) ?? {
        date: r.created_at, voucher_number: r.invoice_number,
        guest_name: r.guest_name ?? "Walk-In Guest",
        taxable_amount: 0, cgst_amount: 0, sgst_amount: 0, total_amount: 0,
      };
      v.taxable_amount += Number(r.taxable);
      v.cgst_amount += r.cgst;
      v.sgst_amount += r.sgst;
      v.total_amount += Number(r.invoice_total ?? 0);
      byInvoice.set(r.invoice_number, v);
    }
    const xml = buildTallySalesXml([...byInvoice.values()]);
    downloadXml(xml, buildFileName({ ...meta, reportName: "GST_Tally" }, "xml"));
  }

  return (
    <ReportShell
      title="GST Report"
      description="This report is for GST filing reference only. Verify with your CA before filing."
      filters={<>
        <div><Label>Month</Label><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" /></div>
        <div><Label>Bill Type</Label><Input value="GST Invoice only" disabled className="w-40" /></div>
      </>}
      onExcel={() => exportExcel(display, columns, meta)}
      onPdf={() => exportPdf(display, columns, meta)}
      onTally={tallyXml}
      tallyLabel="Export for Tally"
      disabled={rows.length === 0}
    >
      <Card><CardContent className="pt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40"><tr>
            {columns.map((c) => <th key={c.key} className={`px-2 py-2 text-left whitespace-nowrap ${c.currency ? "text-right" : ""}`}>{c.header}</th>)}
          </tr></thead>
          <tbody>
            {display.map((r, idx) => (
              <tr
                key={`${r.invoice_number}-${r.gst_rate}-${idx}`}
                className={r.is_first_of_invoice ? "border-t" : ""}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-2 py-1.5 ${c.currency ? "text-right tabular-nums" : ""}`}>
                    {c.currency
                      ? (c.get(r) === "" ? "" : fmtINR(c.get(r) as number))
                      : c.get(r)}
                  </td>
                ))}
              </tr>
            ))}
            {display.length === 0 && <tr><td colSpan={columns.length} className="text-center py-6 text-muted-foreground">No GST invoices in this month.</td></tr>}
          </tbody>
          <tfoot className="bg-emerald-50 font-semibold">
            <tr>
              <td colSpan={4} className="text-right px-2 py-2">Totals</td>
              <td className="text-right px-2 py-2 tabular-nums">{fmtINR(totals.taxable)}</td>
              <td />
              <td className="text-right px-2 py-2 tabular-nums">{fmtINR(totals.cgst)}</td>
              <td />
              <td className="text-right px-2 py-2 tabular-nums">{fmtINR(totals.sgst)}</td>
              <td className="text-right px-2 py-2 tabular-nums">{fmtINR(totals.gst)}</td>
              <td className="text-right px-2 py-2 tabular-nums">{fmtINR(totals.invoice)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="text-xs text-muted-foreground mt-3 italic">
          This report is for GST filing reference only. Verify with your CA before filing.
        </p>
      </CardContent></Card>
    </ReportShell>
  );
}