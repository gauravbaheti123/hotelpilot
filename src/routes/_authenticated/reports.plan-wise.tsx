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

const detailColumns: ReportColumn<DetailRow>[] = [
  { key: "date", header: "Date", get: (r) => r.date, type: "date", sortValue: (r) => r.date },
  { key: "plan", header: "Plan", get: (r) => r.planLabel, sortValue: (r) => r.plan },
  { key: "room", header: "Room", get: (r) => r.roomNumber, sortValue: (r) => r.roomNumber },
  { key: "category", header: "Category", get: (r) => r.category, sortValue: (r) => r.category },
  { key: "guest", header: "Guest", get: (r) => r.guest, sortValue: (r) => r.guest },
  { key: "nights", header: "Nights", get: (r) => r.nights, numeric: true, sortValue: (r) => r.nights },
  { key: "rate", header: "Rate", get: (r) => r.rate, currency: true, sortValue: (r) => r.rate },
  { key: "amount", header: "Amount", get: (r) => r.amount, currency: true, sortValue: (r) => r.amount },
  { key: "gst", header: "GST", get: (r) => r.gst, currency: true, sortValue: (r) => r.gst },
  { key: "total", header: "Total", get: (r) => r.total, currency: true, sortValue: (r) => r.total },
];

const categoryColumns: ReportColumn<CategoryRow>[] = [
  { key: "date", header: "Date", get: (r) => r.date, type: "date", sortValue: (r) => r.date },
  { key: "category", header: "Room Category", get: (r) => r.category, sortValue: (r) => r.category },
  { key: "nights", header: "Room Nights", get: (r) => r.nights, numeric: true, sortValue: (r) => r.nights },
  { key: "amount", header: "Revenue (pre-tax)", get: (r) => r.amount, currency: true, sortValue: (r) => r.amount },
  { key: "gst", header: "GST", get: (r) => r.gst, currency: true, sortValue: (r) => r.gst },
  { key: "total", header: "Total", get: (r) => r.total, currency: true, sortValue: (r) => r.total },
];

interface DateGroup {
  date: string;
  plans: Array<{ plan: string; label: string; rows: DetailRow[]; amount: number; gst: number; total: number; nights: number }>;
  categories: CategoryRow[];
  amount: number;
  gst: number;
  total: number;
  nights: number;
}

/** date → plan → room-level rows, plus a per-date category rollup. */
function buildDetail(items: RawCharge[]): DateGroup[] {
  const byDate = new Map<string, RawCharge[]>();
  for (const it of items) {
    const arr = byDate.get(it.date) ?? [];
    arr.push(it);
    byDate.set(it.date, arr);
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => {
      const planMap = new Map<string, Map<string, DetailRow>>();
      const catMap = new Map<string, CategoryRow>();
      for (const it of list) {
        const rows = planMap.get(it.plan) ?? new Map<string, DetailRow>();
        const rk = `${it.roomNumber}|${it.bookingId ?? ""}|${it.rate}`;
        const cur = rows.get(rk) ?? {
          key: `${date}|${it.plan}|${rk}`,
          date, plan: it.plan, planLabel: PLAN_LABEL[it.plan] ?? it.plan,
          roomNumber: it.roomNumber, category: it.category, guest: it.guest,
          nights: 0, rate: it.rate, amount: 0, gst: 0, total: 0,
        };
        cur.nights += it.nights;
        cur.amount += it.amount;
        cur.gst += it.gst;
        cur.total = cur.amount + cur.gst;
        rows.set(rk, cur);
        planMap.set(it.plan, rows);

        const c = catMap.get(it.category) ?? {
          key: `${date}|${it.category}`, date, category: it.category, nights: 0, amount: 0, gst: 0, total: 0,
        };
        c.nights += it.nights; c.amount += it.amount; c.gst += it.gst; c.total = c.amount + c.gst;
        catMap.set(it.category, c);
      }
      const plans = PLAN_ORDER
        .filter((p) => planMap.has(p))
        .map((p) => {
          const rows = Array.from(planMap.get(p)!.values())
            .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
          return {
            plan: p as string,
            label: PLAN_LABEL[p] ?? p,
            rows,
            nights: rows.reduce((s, r) => s + r.nights, 0),
            amount: rows.reduce((s, r) => s + r.amount, 0),
            gst: rows.reduce((s, r) => s + r.gst, 0),
            total: rows.reduce((s, r) => s + r.total, 0),
          };
        });
      const categories = Array.from(catMap.values()).sort((a, b) => a.category.localeCompare(b.category));
      return {
        date,
        plans,
        categories,
        nights: plans.reduce((s, p) => s + p.nights, 0),
        amount: plans.reduce((s, p) => s + p.amount, 0),
        gst: plans.reduce((s, p) => s + p.gst, 0),
        total: plans.reduce((s, p) => s + p.total, 0),
      };
    });
}

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
  const [openDates, setOpenDates] = useState<Record<string, boolean>>({});

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
      const brMeta = new Map<string, { rate: number; roomId: string | null; categoryId: string | null }>();
      // Chunked so a long range never blows past the URL length limit.
      for (let i = 0; i < brIds.length; i += 200) {
        const { data } = await supabase.from("booking_rooms")
          .select("id,meal_plan,rate,room_id,category_id").in("id", brIds.slice(i, i + 200));
        for (const r of (data ?? []) as any[]) {
          planById.set(r.id, normalisePlan(r.meal_plan));
          brMeta.set(r.id, { rate: Number(r.rate || 0), roomId: r.room_id ?? null, categoryId: r.category_id ?? null });
        }
      }

      // Room numbers + categories (separate queries — booking_rooms has two FKs to rooms).
      const roomIds = Array.from(new Set(Array.from(brMeta.values()).map((m) => m.roomId).filter(Boolean) as string[]));
      const roomById = new Map<string, { number: string; categoryId: string | null }>();
      for (let i = 0; i < roomIds.length; i += 200) {
        const { data } = await supabase.from("rooms")
          .select("id,room_number,category_id").in("id", roomIds.slice(i, i + 200));
        for (const r of (data ?? []) as any[]) roomById.set(r.id, { number: r.room_number, categoryId: r.category_id ?? null });
      }
      const catById = new Map<string, string>();
      {
        const { data } = await supabase.from("room_categories")
          .select("id,name").eq("property_id", propertyId);
        for (const r of (data ?? []) as any[]) catById.set(r.id, r.name);
      }

      // Guest names per booking.
      const bookingIds = Array.from(new Set(
        charges.map((c) => c.folios?.booking_id).filter(Boolean) as string[],
      ));
      const guestByBooking = new Map<string, string>();
      const guestIdByBooking = new Map<string, string>();
      for (let i = 0; i < bookingIds.length; i += 200) {
        const { data } = await supabase.from("bookings")
          .select("id,guest_id").in("id", bookingIds.slice(i, i + 200));
        for (const b of (data ?? []) as any[]) if (b.guest_id) guestIdByBooking.set(b.id, b.guest_id);
      }
      const guestIds = Array.from(new Set(guestIdByBooking.values()));
      const nameByGuest = new Map<string, string>();
      for (let i = 0; i < guestIds.length; i += 200) {
        const { data } = await supabase.from("guests")
          .select("id,name").in("id", guestIds.slice(i, i + 200));
        for (const g of (data ?? []) as any[]) nameByGuest.set(g.id, g.name ?? "");
      }
      for (const [bid, gid] of guestIdByBooking) guestByBooking.set(bid, nameByGuest.get(gid) ?? "");

      setItems(charges.map((c) => {
        const isBr = c.source_table === "booking_rooms" && c.source_id;
        const meta = isBr ? brMeta.get(c.source_id as string) : undefined;
        const room = meta?.roomId ? roomById.get(meta.roomId) : undefined;
        const catId = meta?.categoryId ?? room?.categoryId ?? null;
        const nights = Number(c.qty || 0) || 1;
        const amount = Number(c.amount || 0);
        const bookingId = c.folios?.booking_id ?? null;
        return {
          date: String(c.charged_on).slice(0, 10),
          plan: isBr ? (planById.get(c.source_id) ?? "Unspecified") : "Unspecified",
          bookingId,
          nights,
          amount,
          gst: Number(c.gst_amount || 0),
          roomNumber: room?.number ?? "—",
          category: (catId ? catById.get(catId) : null) ?? "Uncategorised",
          guest: (bookingId ? guestByBooking.get(bookingId) : "") || "—",
          rate: meta?.rate ?? (nights > 0 ? amount / nights : amount),
        };
      }));
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
  const detail = useMemo(() => buildDetail(items), [items]);
  const detailRows = useMemo(() => detail.flatMap((d) => d.plans.flatMap((p) => p.rows)), [detail]);
  const categoryRows = useMemo(() => detail.flatMap((d) => d.categories), [detail]);

  const exportSections: ExportSection[] = [
    ...sections.map((s) => ({
      title: s.title,
      columns,
      rows: s.rows,
      summary: summaryFor(s.rows),
      emptyText: "No room charges in this period",
    })),
    {
      title: "Detail — Date / Plan / Room",
      columns: detailColumns,
      rows: detailRows,
      summary: [
        ["Rows", detailRows.length],
        ["Room Nights", detailRows.reduce((s, r) => s + r.nights, 0)],
        ["Revenue (pre-tax)", fmtINR(detailRows.reduce((s, r) => s + r.amount, 0))],
        ["GST", fmtINR(detailRows.reduce((s, r) => s + r.gst, 0))],
        ["Total", fmtINR(detailRows.reduce((s, r) => s + r.total, 0))],
      ],
      emptyText: "No room charges in this period",
    },
    {
      title: "Category Rollup (per date)",
      columns: categoryColumns,
      rows: categoryRows,
      summary: [
        ["Total", fmtINR(categoryRows.reduce((s, r) => s + r.total, 0))],
      ],
      emptyText: "No room charges in this period",
    },
  ];

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

      {detail.length > 0 && (
        <Card className="print:break-before-page">
          <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
            <CardTitle className="text-base">Detailed Breakdown — date → plan → room</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary"
                onClick={() => setOpenDates(Object.fromEntries(detail.map((d) => [d.date, true])))}>
                Expand all
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setOpenDates({})}>Collapse all</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {detail.map((d) => {
              const open = !!openDates[d.date];
              return (
                <Collapsible key={d.date} open={open}
                  onOpenChange={(v) => setOpenDates((s) => ({ ...s, [d.date]: v }))}>
                  <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
                    <span className="flex items-center gap-2 font-medium">
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      {d.date}
                    </span>
                    <span className="text-muted-foreground">
                      {d.nights} night(s) · {fmtINR(d.amount)} + GST {fmtINR(d.gst)} = <span className="font-medium text-foreground">{fmtINR(d.total)}</span>
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 px-1 py-3">
                    {d.plans.map((p) => (
                      <div key={p.plan} className="space-y-1">
                        <div className="flex justify-between text-sm font-medium">
                          <span>Plan: {p.label}</span>
                          <span>{fmtINR(p.total)}</span>
                        </div>
                        <ReportDataTable
                          rows={p.rows}
                          columns={detailColumns.filter((c) => c.key !== "date" && c.key !== "plan")}
                          emptyText="No rows"
                          rowKey={(r: DetailRow) => r.key}
                        />
                      </div>
                    ))}
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Category rollup for {d.date}</div>
                      <ReportDataTable
                        rows={d.categories}
                        columns={categoryColumns.filter((c) => c.key !== "date")}
                        emptyText="No rows"
                        rowKey={(r: CategoryRow) => r.key}
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </CardContent>
        </Card>
      )}
    </ReportShell>
  );
}
