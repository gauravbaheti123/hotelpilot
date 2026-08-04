import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import {
  fetchDailySummary, fetchOccupancy, todayIso,
  PAYMENT_MODE_LABELS,
  type DailySummary, type OccupancySnapshot,
} from "@/lib/reports";
import { inr } from "@/lib/billing";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/reports/daily")({
  head: () => ({ meta: [{ title: "Daily Report — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><DailyReportPage /></RequirePermission>),
});

function DailyReportPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [date, setDate] = useState<string>(todayIso());
  const [sum, setSum] = useState<DailySummary | null>(null);
  const [occ, setOcc] = useState<OccupancySnapshot | null>(null);

  useEffect(() => {
    if (!propertyId) return;
    let cancel = false;
    (async () => {
      const [s, o] = await Promise.all([
        fetchDailySummary(propertyId, date),
        fetchOccupancy(propertyId, date),
      ]);
      if (!cancel) { setSum(s); setOcc(o); }
    })();
    return () => { cancel = true; };
  }, [propertyId, date]);

  if (!propertyId) return <AppShell title="Daily Report"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Daily Report">
      <div className="flex items-end gap-3 mb-4">
        <div>
          <Label htmlFor="d">Business date</Label>
          <Input id="d" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-48" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <KpiCard title="Occupancy" value={occ ? `${occ.occupancy_pct}%` : "—"}
          hint={occ ? `${occ.rooms_occupied}/${occ.rooms_total} rooms` : ""} />
        <KpiCard title="Revenue (invoiced)" value={sum ? inr(sum.total_amount) : "—"}
          hint={sum ? `${sum.folios_created} folios · ${sum.folios_settled} settled` : ""} />
        <KpiCard title="Collections" value={sum ? inr(sum.payments_total) : "—"}
          hint={sum ? `${sum.payment_count} payments` : ""} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 mt-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Invoice totals</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Sub total" value={inr(sum?.sub_total ?? 0)} />
            <Row label="GST" value={inr(sum?.gst_amount ?? 0)} />
            <Row label="Grand total" value={inr(sum?.total_amount ?? 0)} bold />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Collections by mode</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {Object.keys(PAYMENT_MODE_LABELS).map((m) => (
              <Row key={m} label={PAYMENT_MODE_LABELS[m]} value={inr(sum?.by_mode[m] ?? 0)} />
            ))}
            <Row label="Total collected" value={inr(sum?.payments_total ?? 0)} bold />
          </CardContent>
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Collection Report — Invoices</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">GST Invoice Total</div>
              <div className="text-xl font-semibold mt-1">{inr(sum?.gst_invoice_total ?? 0)}</div>
              <div className="text-xs text-muted-foreground">{sum?.gst_invoice_count ?? 0} invoice(s)</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function KpiCard({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{title}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-semibold pt-2 border-t" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}