import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { fetchGstInvoices, todayIso, type GstInvoiceRow } from "@/lib/reports";
import { inr } from "@/lib/billing";

export const Route = createFileRoute("/_authenticated/reports/gst")({
  head: () => ({ meta: [{ title: "GST Report — HotelPilot" }] }),
  component: GstReportPage,
});

function firstOfMonth() {
  const d = new Date(); d.setDate(1);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function GstReportPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [from, setFrom] = useState<string>(firstOfMonth());
  const [to, setTo] = useState<string>(todayIso());
  const [rows, setRows] = useState<GstInvoiceRow[]>([]);

  useEffect(() => {
    if (!propertyId) return;
    (async () => setRows(await fetchGstInvoices(propertyId, from, to)))();
  }, [propertyId, from, to]);

  const totals = useMemo(() => {
    const b2b = rows.filter((r) => !!r.guest_gstin);
    const b2c = rows.filter((r) => !r.guest_gstin);
    const sum = (arr: GstInvoiceRow[], k: keyof GstInvoiceRow) =>
      arr.reduce((a, r) => a + Number(r[k] ?? 0), 0);
    return {
      b2b_count: b2b.length,
      b2c_count: b2c.length,
      b2b_sub: sum(b2b, "sub_total"), b2b_gst: sum(b2b, "gst_amount"), b2b_total: sum(b2b, "total_amount"),
      b2c_sub: sum(b2c, "sub_total"), b2c_gst: sum(b2c, "gst_amount"), b2c_total: sum(b2c, "total_amount"),
    };
  }, [rows]);

  function exportCsv() {
    const header = ["Invoice", "Date", "Guest", "GSTIN", "Company", "Sub", "GST", "Total", "Type"];
    const lines = [header.join(",")].concat(
      rows.map((r) => [
        r.invoice_number,
        new Date(r.created_at).toISOString().slice(0, 10),
        (r.guest_name ?? "").replace(/,/g, " "),
        r.guest_gstin ?? "",
        (r.guest_company ?? "").replace(/,/g, " "),
        r.sub_total.toFixed(2), r.gst_amount.toFixed(2), r.total_amount.toFixed(2),
        r.guest_gstin ? "B2B" : "B2C",
      ].join(","))
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gst-${from}-to-${to}.csv`;
    a.click();
  }

  if (!propertyId) return <AppShell title="GST Report"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="GST Report">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" /></div>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 mb-4">
        <Card><CardContent className="p-4">
          <div className="text-xs uppercase text-muted-foreground">B2B (with GSTIN)</div>
          <div className="text-2xl font-semibold mt-1">{inr(totals.b2b_total)}</div>
          <div className="text-xs text-muted-foreground mt-1">{totals.b2b_count} invoices · GST {inr(totals.b2b_gst)}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="text-xs uppercase text-muted-foreground">B2C (without GSTIN)</div>
          <div className="text-2xl font-semibold mt-1">{inr(totals.b2c_total)}</div>
          <div className="text-xs text-muted-foreground mt-1">{totals.b2c_count} invoices · GST {inr(totals.b2c_gst)}</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0 divide-y">
          {rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">No GST invoices in range.</p>}
          {rows.map((r) => (
            <div key={r.invoice_number} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-sm">{r.invoice_number}</div>
                  <Badge variant="outline" className="text-[10px]">{r.guest_gstin ? "B2B" : "B2C"}</Badge>
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {new Date(r.created_at).toLocaleDateString()} · {r.guest_name ?? "—"}
                  {r.guest_gstin ? ` · ${r.guest_gstin}` : ""}
                  {r.guest_company ? ` · ${r.guest_company}` : ""}
                </div>
              </div>
              <div className="text-right text-sm">
                <div className="font-medium">{inr(r.total_amount)}</div>
                <div className="text-xs text-muted-foreground">GST {inr(r.gst_amount)}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </AppShell>
  );
}