// Plan-wise report — room revenue broken down by meal plan (EP/CP/MAP/AP),
// optionally split into Daily / Weekly / Monthly sub-sections. Reuses the
// shared report shell, table and section export utilities.
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchBanquetScope, isBanquetRecord } from "@/lib/banquetScope";
import { useCurrentProperty } from "@/hooks/use-property";
import { useReportBrand } from "@/hooks/use-report-brand";
import { ReportShell } from "@/components/ReportShell";
import { ReportDataTable } from "@/components/ReportDataTable";
import { RequirePermission } from "@/components/RequirePermission";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  exportExcelSections, exportSectionsPdf, fmtINR, type ExportSection, type ReportColumn,
} from "@/lib/reportExports";
import { istDaysAgo, istMonthStart, istToday } from "@/lib/date";

export const Route = createFileRoute("/_authenticated/reports/plan-wise")({
  head: () => ({ meta: [{ title: "Plan-Wise Report — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><Page /></RequirePermission>),
});

type Grouping = "none" | "daily" | "weekly" | "monthly";

/** Fixed display order; anything else (incl. missing) lands in "Unspecified". */
const PLAN_ORDER = ["EP", "CP", "MAP", "AP", "Unspecified"] as const;
const PLAN_LABEL: Record<string, string> = {
  EP: "EP — Room only",
  CP: "CP — Room + breakfast",
  MAP: "MAP — Room + breakfast + 1 meal",
  AP: "AP — Room + all meals",
  Unspecified: "Unspecified",
};

interface PlanRow {
  plan: string;
  label: string;
  nights: number;
  bookings: number;
  revenue: number;
  gst: number;
  total: number;
  avgRate: number;
  isTotal?: boolean;
}

interface RawCharge {
  date: string;
  plan: string;
  bookingId: string | null;
  nights: number;
  amount: number;
  gst: number;
  roomNumber: string;
  category: string;
  guest: string;
  rate: number;
}

/** One room-level line inside a date + plan group. */
interface DetailRow {
  key: string;
  date: string;
  plan: string;
  planLabel: string;
  roomNumber: string;
  category: string;
  guest: string;
  nights: number;
  rate: number;
  amount: number;
  gst: number;
  total: number;
}

interface CategoryRow {
  key: string;
  date: string;
  category: string;
  nights: number;
  amount: number;
  gst: number;
  total: number;
}

function normalisePlan(v: unknown): string {
  const p = String(v ?? "").trim().toUpperCase();
  return (PLAN_ORDER as readonly string[]).includes(p) && p !== "Unspecified" ? p : "Unspecified";
}

/** Period bucket key + human label for a charge date. */
function periodOf(iso: string, grouping: Grouping): { key: string; label: string } {
  if (grouping === "monthly") {
    const d = new Date(`${iso}T00:00:00`);
    const key = iso.slice(0, 7);
    return { key, label: d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) };
  }
  if (grouping === "weekly") {
    const d = new Date(`${iso}T00:00:00`);
    const dow = (d.getDay() + 6) % 7; // Monday-start weeks
    const start = new Date(d); start.setDate(d.getDate() - dow);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    const s = start.toISOString().slice(0, 10);
    const e = end.toISOString().slice(0, 10);
    return { key: s, label: `Week of ${s} → ${e}` };
  }
  return { key: iso, label: iso };
}

function buildRows(items: RawCharge[]): PlanRow[] {
  const map = new Map<string, { nights: number; revenue: number; gst: number; bookings: Set<string> }>();
  for (const it of items) {
    const cur = map.get(it.plan) ?? { nights: 0, revenue: 0, gst: 0, bookings: new Set<string>() };
    cur.nights += it.nights;
    cur.revenue += it.amount;
    cur.gst += it.gst;
    if (it.bookingId) cur.bookings.add(it.bookingId);
    map.set(it.plan, cur);
  }
  const rows: PlanRow[] = [];
  for (const plan of PLAN_ORDER) {
    const v = map.get(plan);
    if (!v) continue;
    rows.push({
      plan,
      label: PLAN_LABEL[plan] ?? plan,
      nights: v.nights,
      bookings: v.bookings.size,
      revenue: v.revenue,
      gst: v.gst,
      total: v.revenue + v.gst,
      avgRate: v.nights > 0 ? v.revenue / v.nights : 0,
    });
  }
  if (rows.length === 0) return rows;
  const g = rows.reduce(
    (a, r) => ({ nights: a.nights + r.nights, bookings: a.bookings + r.bookings, revenue: a.revenue + r.revenue, gst: a.gst + r.gst }),
    { nights: 0, bookings: 0, revenue: 0, gst: 0 },
  );
  rows.push({
    plan: "__total",
    label: "Grand Total",
    nights: g.nights,
    bookings: g.bookings,
    revenue: g.revenue,
    gst: g.gst,
    total: g.revenue + g.gst,
    avgRate: g.nights > 0 ? g.revenue / g.nights : 0,
    isTotal: true,
  });
  return rows;
}

const columns: ReportColumn<PlanRow>[] = [
  { key: "label", header: "Plan Type", get: (r) => r.label, sortValue: (r) => r.label },
  { key: "nights", header: "Room Nights", get: (r) => r.nights, numeric: true, sortValue: (r) => r.nights },
  { key: "bookings", header: "Bookings", get: (r) => r.bookings, numeric: true, sortValue: (r) => r.bookings },
  { key: "revenue", header: "Room Revenue (pre-tax)", get: (r) => r.revenue, currency: true, sortValue: (r) => r.revenue },
  { key: "gst", header: "GST", get: (r) => r.gst, currency: true, sortValue: (r) => r.gst },
  { key: "total", header: "Total Revenue", get: (r) => r.total, currency: true, sortValue: (r) => r.total },
  { key: "avgRate", header: "Avg Rate / Night", get: (r) => r.avgRate, currency: true, sortValue: (r) => r.avgRate },
];

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const brand = useReportBrand(propertyId);

  const yesterday = istDaysAgo(1);
  const [from, setFrom] = useState(yesterday);
  const [to, setTo] = useState(yesterday);
  const [grouping, setGrouping] = useState<Grouping>("none");
  const [items, setItems] = useState<RawCharge[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const [chargeRes, scope] = await Promise.all([
        supabase.from("folio_charges")
          .select("amount,gst_amount,qty,charged_on,folio_id,source_table,source_id,folios!inner(property_id,booking_id,status)")
          .eq("charge_type", "room")
          .eq("folios.property_id", propertyId)
          .gte("charged_on", from).lte("charged_on", to),
        fetchBanquetScope(propertyId),
      ]);
      const charges = ((chargeRes.data ?? []) as any[]).filter(
        (c) => c.folios?.status !== "voided"
          && !isBanquetRecord(scope, { folio_id: c.folio_id, booking_id: c.folios?.booking_id }),
      );
      const brIds = Array.from(new Set(
        charges.filter((c) => c.source_table === "booking_rooms" && c.source_id).map((c) => c.source_id as string),
      ));
      const planById = new Map<string, string>();
      // Chunked so a long range never blows past the URL length limit.
      for (let i = 0; i < brIds.length; i += 200) {
        const { data } = await supabase.from("booking_rooms")
          .select("id,meal_plan").in("id", brIds.slice(i, i + 200));
        for (const r of (data ?? []) as any[]) planById.set(r.id, normalisePlan(r.meal_plan));
      }
      setItems(charges.map((c) => ({
        date: String(c.charged_on).slice(0, 10),
        plan: c.source_table === "booking_rooms" ? (planById.get(c.source_id) ?? "Unspecified") : "Unspecified",
        bookingId: c.folios?.booking_id ?? null,
        nights: Number(c.qty || 0) || 1,
        amount: Number(c.amount || 0),
        gst: Number(c.gst_amount || 0),
      })));
    } finally {
      setLoading(false);
    }
  }, [propertyId, from, to]);

  useEffect(() => { void load(); }, [load]);

  const sections = useMemo(() => {
    if (grouping === "none") {
      return [{ key: "all", title: `Plan-wise breakdown (${from} → ${to})`, rows: buildRows(items) }];
    }
    const buckets = new Map<string, { label: string; items: RawCharge[] }>();
    for (const it of items) {
      const { key, label } = periodOf(it.date, grouping);
      const b = buckets.get(key) ?? { label, items: [] };
      b.items.push(it);
      buckets.set(key, b);
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, b]) => ({ key, title: b.label, rows: buildRows(b.items) }));
  }, [items, grouping, from, to]);

  const summaryFor = (rows: PlanRow[]): Array<[string, string | number]> => {
    const t = rows.find((r) => r.isTotal);
    if (!t) return [];
    return [
      ["Room Nights", t.nights],
      ["Room Revenue (pre-tax)", fmtINR(t.revenue)],
      ["GST", fmtINR(t.gst)],
      ["Total Revenue", fmtINR(t.total)],
      ["Avg Rate / Night", fmtINR(t.avgRate)],
    ];
  };

  const meta = { reportName: "Plan-Wise Report", propertyName: current?.name ?? "", from, to };
  const exportSections: ExportSection[] = sections.map((s) => ({
    title: s.title,
    columns,
    rows: s.rows,
    summary: summaryFor(s.rows),
    emptyText: "No room charges in this period",
  }));

  if (!propertyId) return <AppShell title="Plan-Wise Report"><EmptyPropertyState /></AppShell>;

  return (
    <ReportShell
      title="Plan-Wise Report"
      description="Room revenue by meal plan (EP / CP / MAP / AP). Defaults to yesterday; choose a grouping to split the range into periods."
      disabled={loading}
      onExcel={() => exportExcelSections(exportSections, meta)}
      onPdf={() => exportSectionsPdf(exportSections, meta, brand)}
      filters={
        <>
          <div>
            <Label htmlFor="from">From</Label>
            <Input id="from" type="date" className="w-44" value={from}
              onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} />
          </div>
          <div>
            <Label htmlFor="to">To</Label>
            <Input id="to" type="date" className="w-44" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label>Grouping</Label>
            <Select value={grouping} onValueChange={(v) => setGrouping(v as Grouping)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No grouping</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => { setFrom(yesterday); setTo(yesterday); }}>Yesterday</Button>
            <Button size="sm" variant="secondary" onClick={() => { setFrom(istToday()); setTo(istToday()); }}>Today</Button>
            <Button size="sm" variant="secondary" onClick={() => { setFrom(istMonthStart()); setTo(istToday()); }}>This month</Button>
          </div>
        </>
      }
    >
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {sections.map((s) => (
        <Card key={s.key} className="print:break-before-page">
          <CardHeader className="pb-2"><CardTitle className="text-base">{s.title}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <ReportDataTable
              rows={s.rows}
              columns={columns}
              emptyText="No room charges in this period"
              rowKey={(r: PlanRow) => r.plan}
            />
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              {summaryFor(s.rows).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 rounded-md border px-3 py-1.5">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium">{v}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </ReportShell>
  );
}
