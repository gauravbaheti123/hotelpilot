import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { supabase } from "@/integrations/supabase/client";
import { inr } from "@/lib/billing";
import { todayIso, normaliseModeKey } from "@/lib/reports";
import { usePaymentMethods, formatPaymentMethodLabel } from "@/hooks/use-payment-methods";
import { fetchBanquetScope, isBanquetRecord } from "@/lib/banquetScope";

import { RequirePermission } from "@/components/RequirePermission";
import { istDateISO } from "@/lib/date";
import { reportQueryError } from "@/lib/queryError";
import { useReportBrand } from "@/hooks/use-report-brand";
import {
  exportExcelSections, exportSectionsPdf, fmtINR,
  type ExportSection, type ReportColumn,
} from "@/lib/reportExports";
import { pagedSelect } from "@/lib/reportPaging";

export const Route = createFileRoute("/_authenticated/reports/sales")({
  head: () => ({ meta: [{ title: "Sales Report — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><SalesReportPage /></RequirePermission>),
});

function firstOfMonth() {
  const d = new Date(); d.setDate(1);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return istDateISO(d);
}

interface DayRow {
  date: string;
  sub_total: number; gst_amount: number; total_amount: number;
  payments_total: number;
  by_mode: Record<string, number>;
}

function SalesReportPage() {
  const { current, currentId: propertyId } = useCurrentProperty();
  const { methods } = usePaymentMethods(propertyId);
  const brand = useReportBrand(propertyId);
  const [from, setFrom] = useState<string>(firstOfMonth());
  const [to, setTo] = useState<string>(todayIso());
  const [folios, setFolios] = useState<{ created_at: string; sub_total: number; gst_amount: number; total_amount: number; status: string }[]>([]);
  const [pays, setPays] = useState<{ paid_at: string; amount: number; mode: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!propertyId) return;
    const start = new Date(`${from}T00:00:00`).toISOString();
    const endD = new Date(`${to}T00:00:00`); endD.setDate(endD.getDate() + 1);
    const end = endD.toISOString();
    (async () => {
      setLoading(true);
      try {
        const [f, p, scope] = await Promise.all([
          pagedSelect<any>("folios", (a, b) => supabase.from("folios")
            .select("created_at,sub_total,gst_amount,total_amount,status,id,booking_id")
            .eq("property_id", propertyId).neq("status", "void")
            .gte("created_at", start).lt("created_at", end).range(a, b)),
          pagedSelect<any>("payments", (a, b) => supabase.from("payments")
            .select("paid_at,amount,mode,booking_id,folio_id")
            .eq("property_id", propertyId).gte("paid_at", start).lt("paid_at", end).range(a, b)),
          fetchBanquetScope(propertyId),
        ]);
        // Banquet event-block folios/payments are excluded from operational sales.
        setFolios(f.filter(
          (row) => !isBanquetRecord(scope, { booking_id: row.booking_id, folio_id: row.id }),
        ) as typeof folios);
        setPays(p.filter((row) => !isBanquetRecord(scope, row)) as typeof pays);
      } finally {
        setLoading(false);
      }
    })();
  }, [propertyId, from, to]);

  const days = useMemo(() => {
    const map = new Map<string, DayRow>();
    const ensure = (d: string) => {
      if (!map.has(d)) map.set(d, { date: d, sub_total: 0, gst_amount: 0, total_amount: 0, payments_total: 0, by_mode: {} });
      return map.get(d)!;
    };
    for (const f of folios) {
      const d = f.created_at.slice(0, 10);
      const row = ensure(d);
      row.sub_total += Number(f.sub_total ?? 0);
      row.gst_amount += Number(f.gst_amount ?? 0);
      row.total_amount += Number(f.total_amount ?? 0);
    }
    for (const p of pays) {
      const d = p.paid_at.slice(0, 10);
      const row = ensure(d);
      const amt = Number(p.amount ?? 0);
      row.payments_total += amt;
      const key = normaliseModeKey(p.mode);
      row.by_mode[key] = (row.by_mode[key] ?? 0) + amt;
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [folios, pays]);

  const totals = useMemo(() => days.reduce((acc, d) => ({
    sub_total: acc.sub_total + d.sub_total,
    gst_amount: acc.gst_amount + d.gst_amount,
    total_amount: acc.total_amount + d.total_amount,
    payments_total: acc.payments_total + d.payments_total,
  }), { sub_total: 0, gst_amount: 0, total_amount: 0, payments_total: 0 }), [days]);

  // Mode columns follow the property's configured methods plus whatever was
  // actually collected in the range, matched case-insensitively.
  const modeKeys = useMemo(() => {
    const rows: Array<{ key: string; label: string }> = [];
    const seen = new Set<string>();
    for (const m of methods) {
      const key = normaliseModeKey(m.name);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ key, label: formatPaymentMethodLabel(m.name) });
    }
    for (const d of days) {
      for (const key of Object.keys(d.by_mode)) {
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ key, label: formatPaymentMethodLabel(key) });
      }
    }
    return rows;
  }, [methods, days]);

  const columns: ReportColumn<DayRow>[] = useMemo(() => [
    { key: "date", header: "Date", get: (r) => r.date, type: "date", sortValue: (r) => r.date, dateValue: (r) => r.date },
    { key: "sub", header: "Sub Total", get: (r) => r.sub_total, currency: true },
    { key: "gst", header: "GST", get: (r) => r.gst_amount, currency: true },
    { key: "inv", header: "Invoiced", get: (r) => r.total_amount, currency: true },
    { key: "col", header: "Collected", get: (r) => r.payments_total, currency: true },
    ...modeKeys.map((m) => ({
      key: `mode_${m.key}`, header: m.label,
      get: (r: DayRow) => r.by_mode[m.key] ?? 0, currency: true,
    })),
  ], [modeKeys]);

  const meta = { reportName: "Sales Report", propertyName: current?.name ?? "", from, to };
  const sections: ExportSection[] = [{
    title: "Sales by day",
    columns: columns as ReportColumn<any>[],
    rows: days,
    emptyText: "No data in range",
    summary: [
      ["Sub total", fmtINR(totals.sub_total)],
      ["GST", fmtINR(totals.gst_amount)],
      ["Total invoiced", fmtINR(totals.total_amount)],
      ["Total collected", fmtINR(totals.payments_total)],
      ["Days with activity", days.length],
    ] as Array<[string, string | number]>,
  }];

  if (!propertyId) return <AppShell title="Sales Report"><EmptyPropertyState /></AppShell>;

  return (
    <ReportShell
      title="Sales Report"
      disabled={days.length === 0}
      onExcel={() => exportExcelSections(sections, meta)}
      onPdf={() => exportSectionsPdf(sections, meta, brand)}
      filters={<>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" /></div>
      </>}
    >
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Sub</th>
                  <th className="px-3 py-2 text-right">GST</th>
                  <th className="px-3 py-2 text-right">Invoiced</th>
                  <th className="px-3 py-2 text-right">Collected</th>
                  {modeKeys.map((m) => (
                    <th key={m.key} className="px-3 py-2 text-right">{m.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {days.length === 0 && (
                  <tr><td colSpan={5 + modeKeys.length} className="px-3 py-4 text-muted-foreground">No data in range.</td></tr>
                )}
                {days.map((d) => (
                  <tr key={d.date}>
                    <td className="px-3 py-2 font-medium">{d.date}</td>
                    <td className="px-3 py-2 text-right">{inr(d.sub_total)}</td>
                    <td className="px-3 py-2 text-right">{inr(d.gst_amount)}</td>
                    <td className="px-3 py-2 text-right">{inr(d.total_amount)}</td>
                    <td className="px-3 py-2 text-right">{inr(d.payments_total)}</td>
                    {modeKeys.map((m) => (
                      <td key={m.key} className="px-3 py-2 text-right text-muted-foreground">{inr(d.by_mode[m.key] ?? 0)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {days.length > 0 && (
                <tfoot className="bg-muted/30 font-semibold">
                  <tr>
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right">{inr(totals.sub_total)}</td>
                    <td className="px-3 py-2 text-right">{inr(totals.gst_amount)}</td>
                    <td className="px-3 py-2 text-right">{inr(totals.total_amount)}</td>
                    <td className="px-3 py-2 text-right">{inr(totals.payments_total)}</td>
                    <td className="px-3 py-2" colSpan={modeKeys.length}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>
    </ReportShell>
  );
}