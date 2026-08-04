import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentProperty } from "@/hooks/use-property";
import { fetchGstInvoiceSlabs, type GstInvoiceSlabRow } from "@/lib/reports";
import { billNo } from "@/lib/billNumber";
import { ReportShell } from "@/components/ReportShell";
import { RequirePermission } from "@/components/RequirePermission";
import { ReportDataTable } from "@/components/ReportDataTable";
import {
  ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR,
  buildTallySalesXml, downloadXml, buildFileName,
} from "@/lib/reportExports";
import { istDateISO } from "@/lib/date";

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
    return istDateISO(d);
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

  // Per-slab display. Intra-state rows split CGST/SGST at gst_rate/2;
  // inter-state rows carry the full rate as IGST (GSTR-1 style separation).
  const display = useMemo(() => rows.map((r) => ({
    ...r,
    cgstPct: r.tax_type === "igst" ? 0 : r.gst_rate / 2,
    sgstPct: r.tax_type === "igst" ? 0 : r.gst_rate / 2,
    igstPct: r.tax_type === "igst" ? r.gst_rate : 0,
    supply: r.tax_type === "igst" ? "Inter-State" : "Intra-State",
  })), [rows]);
  type Display = GstInvoiceSlabRow & { cgstPct: number; sgstPct: number; igstPct: number; supply: string };
  const [derived, setDerived] = useState<Display[]>([]);

  const totals = useMemo(() => {
    let taxable = 0, gst = 0, invoice = 0, cgst = 0, sgst = 0, igst = 0;
    const seen = new Set<string>();
    for (const r of derived) {
      taxable += Number(r.taxable ?? 0);
      gst += Number(r.gst_total ?? 0);
      cgst += Number(r.cgst ?? 0);
      sgst += Number(r.sgst ?? 0);
      igst += Number(r.igst ?? 0);
      const invKey = r.invoice_number ?? `unnumbered-${r.created_at}`;
      if (!seen.has(invKey)) {
        invoice += Number(r.invoice_total ?? 0);
        seen.add(invKey);
      }
    }
    return { taxable, gst, invoice, cgst, sgst, igst };
  }, [derived]);

  const columns: ReportColumn<Display>[] = [
    { key: "bill_no", header: "Bill No", get: (r) => billNo(r.invoice_number), type: "text" },
    { key: "date", header: "Date", get: (r) => fmtDate(r.created_at), type: "date", sortValue: (r) => r.created_at, dateValue: (r) => r.created_at },
    { key: "guest", header: "Guest Name", get: (r) => r.guest_name ?? "", type: "text" },
    { key: "gstin", header: "GSTIN", get: (r) => r.guest_gstin ?? "", type: "text" },
    { key: "supply", header: "Supply", get: (r) => r.supply, type: "text" },
    { key: "state", header: "Bill-To State", get: (r) => r.bill_to_state ?? "", type: "text" },
    { key: "tax", header: "Taxable", get: (r) => r.taxable, currency: true, sortValue: (r) => Number(r.taxable) },
    { key: "cgstpct", header: "CGST %", get: (r) => r.cgstPct, numeric: true, sortValue: (r) => r.cgstPct },
    { key: "cgst", header: "CGST Amt", get: (r) => r.cgst, currency: true, sortValue: (r) => r.cgst },
    { key: "sgstpct", header: "SGST %", get: (r) => r.sgstPct, numeric: true, sortValue: (r) => r.sgstPct },
    { key: "sgst", header: "SGST Amt", get: (r) => r.sgst, currency: true, sortValue: (r) => r.sgst },
    { key: "igstpct", header: "IGST %", get: (r) => r.igstPct, numeric: true, sortValue: (r) => r.igstPct },
    { key: "igst", header: "IGST Amt", get: (r) => r.igst, currency: true, sortValue: (r) => r.igst },
    { key: "totalgst", header: "Total GST", get: (r) => r.gst_total, currency: true, sortValue: (r) => Number(r.gst_total) },
    { key: "invtotal", header: "Invoice Total", get: (r) => r.invoice_total, currency: true, sortValue: (r) => Number(r.invoice_total) },
  ];

  const meta = { reportName: "GST Report", propertyName: current?.name ?? "Property", from, to,
    totals: [
      ["Total Taxable", fmtINR(totals.taxable)],
      ["Total CGST", fmtINR(totals.cgst)],
      ["Total SGST", fmtINR(totals.sgst)],
      ["Total IGST", fmtINR(totals.igst)],
      ["Total GST", fmtINR(totals.gst)],
      ["Total Invoice Value", fmtINR(totals.invoice)],
    ] as [string, string|number][] };

  function tallyXml() {
    // Tally: one voucher per invoice (aggregated across slabs).
    const byInvoice = new Map<string, {
      date: string; voucher_number: string; guest_name: string;
      taxable_amount: number; cgst_amount: number; sgst_amount: number; igst_amount: number; total_amount: number;
    }>();
    for (const r of display) {
      const invKey = r.invoice_number ?? `unnumbered-${r.created_at}`;
      const v = byInvoice.get(invKey) ?? {
        date: r.created_at, voucher_number: billNo(r.invoice_number),
        guest_name: r.guest_name ?? "Walk-In Guest",
        taxable_amount: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, total_amount: 0,
      };
      v.taxable_amount += Number(r.taxable);
      v.cgst_amount += r.cgst;
      v.sgst_amount += r.sgst;
      v.igst_amount += r.igst;
      v.total_amount += Number(r.invoice_total ?? 0);
      byInvoice.set(invKey, v);
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
      onExcel={() => exportExcel(derived, columns, meta)}
      onPdf={() => exportPdf(derived, columns, meta)}
      onTally={tallyXml}
      tallyLabel="Export for Tally"
      disabled={rows.length === 0}
    >
      <Card><CardContent className="pt-4">
        <ReportDataTable
          rows={display}
          columns={columns}
          onDerivedRowsChange={setDerived}
          rowKey={(r, i) => `${r.invoice_number}-${r.gst_rate}-${i}`}
          emptyText="No GST invoices in this month."
          totalsRow={() => (
            <tr>
              <td colSpan={6} className="text-right px-2 py-2">Totals</td>
              <td className="text-right px-2 py-2 tabular-nums">{fmtINR(totals.taxable)}</td>
              <td />
              <td className="text-right px-2 py-2 tabular-nums">{fmtINR(totals.cgst)}</td>
              <td />
              <td className="text-right px-2 py-2 tabular-nums">{fmtINR(totals.sgst)}</td>
              <td />
              <td className="text-right px-2 py-2 tabular-nums">{fmtINR(totals.igst)}</td>
              <td className="text-right px-2 py-2 tabular-nums">{fmtINR(totals.gst)}</td>
              <td className="text-right px-2 py-2 tabular-nums">{fmtINR(totals.invoice)}</td>
            </tr>
          )}
        />
        <p className="text-xs text-muted-foreground mt-3 italic">
          This report is for GST filing reference only. Verify with your CA before filing.
        </p>
      </CardContent></Card>
    </ReportShell>
  );
}