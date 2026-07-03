import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentProperty } from "@/hooks/use-property";
import { fetchGstInvoices, type GstInvoiceRow } from "@/lib/reports";
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

interface DisplayRow extends GstInvoiceRow {
  cgst: number; sgst: number; cgstPct: number; sgstPct: number;
}

function GstReportPage() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const now = new Date();
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [rows, setRows] = useState<GstInvoiceRow[]>([]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    const [f, t] = monthBounds(month);
    setRows(await fetchGstInvoices(propertyId, f, t));
  }, [propertyId, month]);

  useEffect(() => { load(); }, [load]);

  const [from, to] = monthBounds(month);

  const display: DisplayRow[] = useMemo(() => rows.map((r) => {
    const cgst = Number(r.gst_amount) / 2;
    const pct = r.sub_total > 0 ? Math.round((cgst / r.sub_total) * 10000) / 100 : 0;
    return { ...r, cgst, sgst: cgst, cgstPct: pct, sgstPct: pct };
  }), [rows]);

  const totals = useMemo(() => {
    const sum = (k: "sub_total" | "gst_amount" | "total_amount") =>
      rows.reduce((a, r) => a + Number(r[k] ?? 0), 0);
    const gst = sum("gst_amount");
    return { taxable: sum("sub_total"), gst, invoice: sum("total_amount"), cgst: gst / 2, sgst: gst / 2 };
  }, [rows]);

  const columns: ReportColumn<DisplayRow>[] = [
    { key: "bill_no", header: "Bill No", get: (r) => r.invoice_number },
    { key: "date", header: "Date", get: (r) => fmtDate(r.created_at) },
    { key: "guest", header: "Guest Name", get: (r) => r.guest_name ?? "" },
    { key: "gstin", header: "GSTIN", get: (r) => r.guest_gstin ?? "" },
    { key: "tax", header: "Taxable", get: (r) => r.sub_total, currency: true },
    { key: "cgstpct", header: "CGST %", get: (r) => r.cgstPct },
    { key: "cgst", header: "CGST Amt", get: (r) => r.cgst, currency: true },
    { key: "sgstpct", header: "SGST %", get: (r) => r.sgstPct },
    { key: "sgst", header: "SGST Amt", get: (r) => r.sgst, currency: true },
    { key: "totalgst", header: "Total GST", get: (r) => r.gst_amount, currency: true },
    { key: "invtotal", header: "Invoice Total", get: (r) => r.total_amount, currency: true },
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
    const xml = buildTallySalesXml(display.map((r) => ({
      date: r.created_at, voucher_number: r.invoice_number,
      guest_name: r.guest_name ?? "Walk-In Guest",
      taxable_amount: Number(r.sub_total),
      cgst_amount: r.cgst, sgst_amount: r.sgst,
      total_amount: Number(r.total_amount),
    })));
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
            {display.map((r) => (
              <tr key={r.invoice_number} className="border-t">
                {columns.map((c) => (
                  <td key={c.key} className={`px-2 py-1.5 ${c.currency ? "text-right tabular-nums" : ""}`}>
                    {c.currency ? fmtINR(c.get(r) as number) : c.get(r)}
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