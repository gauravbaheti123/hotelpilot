import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchBanquetScope, isBanquetRecord } from "@/lib/banquetScope";
import { fetchEventRevenue } from "@/lib/banquetEvent";
import { useCurrentProperty } from "@/hooks/use-property";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { RequirePermission } from "@/components/RequirePermission";
import { ReportDataTable } from "@/components/ReportDataTable";
import {
  ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR, firstOfMonthIso,
} from "@/lib/reportExports";
import { istDateISO, istToday } from "@/lib/date";

export const Route = createFileRoute("/_authenticated/reports/date-wise-revenue")({
  head: () => ({ meta: [{ title: "Date-Wise Revenue — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><Page /></RequirePermission>),
});

interface DayRow {
  date: string; rooms: number; food: number; banquet: number; other: number;
  total: number; collections: number; outstanding: number;
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const a = new Date(from), b = new Date(to);
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
    out.push(istDateISO(d));
  }
  return out;
}

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const today = istToday();
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<DayRow[]>([]);
  const [derived, setDerived] = useState<DayRow[]>([]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    const fromIso = `${from}T00:00:00`;
    const toIso = `${to}T23:59:59`;
    const [charges, banquetRows, payRes, folioRes, scope] = await Promise.all([
      supabase.from("folio_charges")
        .select("charge_type,amount,charged_on,folio_id,folios!inner(property_id,booking_id)")
        .gte("charged_on", from).lte("charged_on", to)
        .eq("folios.property_id", propertyId),
      fetchEventRevenue(propertyId, from, to),
      supabase.from("payments").select("amount,paid_at,booking_id,folio_id").eq("property_id", propertyId)
        .gte("paid_at", fromIso).lte("paid_at", toIso),
      supabase.from("folios").select("id,booking_id,total_amount,paid_amount,created_at").eq("property_id", propertyId)
        .gte("created_at", fromIso).lte("created_at", toIso).neq("status", "voided"),
      fetchBanquetScope(propertyId),
    ]);

    const map = new Map<string, DayRow>();
    for (const d of eachDay(from, to)) {
      map.set(d, { date: d, rooms: 0, food: 0, banquet: 0, other: 0, total: 0, collections: 0, outstanding: 0 });
    }
    for (const c of (charges.data ?? []) as any[]) {
      // Skip charges on banquet event-block folios.
      if (isBanquetRecord(scope, { folio_id: c.folio_id, booking_id: c.folios?.booking_id })) continue;
      const key = (c.charged_on as string).slice(0, 10);
      const r = map.get(key); if (!r) continue;
      const a = Number(c.amount || 0);
      if (c.charge_type === "room") r.rooms += a;
      else if (c.charge_type === "food" || c.charge_type === "laundry") r.food += a;
      else r.other += a;
    }
    for (const b of banquetRows) {
      const r = map.get((b.event_date as string).slice(0, 10)); if (!r) continue;
      r.banquet += Number(b.total_amount || 0);
    }
    for (const p of (payRes.data ?? []) as any[]) {
      if (isBanquetRecord(scope, p)) continue;
      const r = map.get((p.paid_at as string).slice(0, 10)); if (!r) continue;
      r.collections += Number(p.amount || 0);
    }
    for (const f of (folioRes.data ?? []) as any[]) {
      if (isBanquetRecord(scope, { booking_id: f.booking_id, folio_id: f.id })) continue;
      const r = map.get((f.created_at as string).slice(0, 10)); if (!r) continue;
      r.outstanding += Math.max(0, Number(f.total_amount || 0) - Number(f.paid_amount || 0));
    }
    for (const r of map.values()) r.total = r.rooms + r.food + r.banquet + r.other;
    setRows(Array.from(map.values()));
  }, [propertyId, from, to]);

  useEffect(() => { load(); }, [load]);

  const grand = useMemo(() => derived.reduce((g, r) => ({
    rooms: g.rooms + r.rooms, food: g.food + r.food, banquet: g.banquet + r.banquet, other: g.other + r.other,
    total: g.total + r.total, collections: g.collections + r.collections, outstanding: g.outstanding + r.outstanding,
  }), { rooms: 0, food: 0, banquet: 0, other: 0, total: 0, collections: 0, outstanding: 0 }), [derived]);

  const columns: ReportColumn<DayRow>[] = [
    { key: "date", header: "Date", get: (r) => fmtDate(r.date), type: "date", sortValue: (r) => r.date, dateValue: (r) => r.date },
    { key: "rooms", header: "Rooms Revenue", get: (r) => r.rooms, currency: true, sortValue: (r) => r.rooms },
    { key: "food", header: "Food Revenue", get: (r) => r.food, currency: true, sortValue: (r) => r.food },
    { key: "banquet", header: "Banquet Revenue", get: (r) => r.banquet, currency: true, sortValue: (r) => r.banquet },
    { key: "other", header: "Other Revenue", get: (r) => r.other, currency: true, sortValue: (r) => r.other },
    { key: "total", header: "Total Revenue", get: (r) => r.total, currency: true, sortValue: (r) => r.total },
    { key: "collections", header: "Collections", get: (r) => r.collections, currency: true, sortValue: (r) => r.collections },
    { key: "outstanding", header: "Outstanding", get: (r) => r.outstanding, currency: true, sortValue: (r) => r.outstanding },
  ];

  const meta = { reportName: "Date-Wise Revenue", propertyName: current?.name ?? "Property", from, to,
    totals: [
      ["Total Revenue", fmtINR(grand.total)],
      ["Total Collections", fmtINR(grand.collections)],
      ["Outstanding", fmtINR(grand.outstanding)],
    ] as [string, string|number][] };

  return (
    <ReportShell title="Date-Wise Revenue"
      filters={<>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
      </>}
      onExcel={() => exportExcel(derived, columns, meta)}
      onPdf={() => exportPdf(derived, columns, meta)}
      disabled={rows.length === 0}
    >
      <Card><CardContent className="pt-4">
        <div className="h-64 mb-6">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={derived.map((r) => ({ name: fmtDate(r.date), total: r.total }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: any) => fmtINR(Number(v))} />
              <Bar dataKey="total" fill="#0F6E56" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <ReportDataTable
          rows={rows}
          columns={columns}
          onDerivedRowsChange={setDerived}
          rowKey={(r) => r.date}
          totalsRow={() => (
            <tr>
              <td className="px-2 py-2">Grand Total</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand.rooms)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand.food)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand.banquet)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand.other)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand.total)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand.collections)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand.outstanding)}</td>
            </tr>
          )}
        />
      </CardContent></Card>
    </ReportShell>
  );
}