import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { supabase } from "@/integrations/supabase/client";
import { inr } from "@/lib/billing";
import { todayIso, PAYMENT_MODE_LABELS } from "@/lib/reports";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/reports/sales")({
  head: () => ({ meta: [{ title: "Sales Report — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><SalesReportPage /></RequirePermission>),
});

function firstOfMonth() {
  const d = new Date(); d.setDate(1);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

interface DayRow {
  date: string;
  sub_total: number; gst_amount: number; total_amount: number;
  payments_total: number;
  by_mode: Record<string, number>;
}

function SalesReportPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const [from, setFrom] = useState<string>(firstOfMonth());
  const [to, setTo] = useState<string>(todayIso());
  const [folios, setFolios] = useState<{ created_at: string; sub_total: number; gst_amount: number; total_amount: number; status: string }[]>([]);
  const [pays, setPays] = useState<{ paid_at: string; amount: number; mode: string }[]>([]);

  useEffect(() => {
    if (!propertyId) return;
    const start = new Date(`${from}T00:00:00`).toISOString();
    const endD = new Date(`${to}T00:00:00`); endD.setDate(endD.getDate() + 1);
    const end = endD.toISOString();
    (async () => {
      const [{ data: f }, { data: p }] = await Promise.all([
        supabase.from("folios").select("created_at,sub_total,gst_amount,total_amount,status")
          .eq("property_id", propertyId).neq("status", "void").gte("created_at", start).lt("created_at", end),
        supabase.from("payments").select("paid_at,amount,mode")
          .eq("property_id", propertyId).gte("paid_at", start).lt("paid_at", end),
      ]);
      setFolios((f ?? []) as typeof folios);
      setPays((p ?? []) as typeof pays);
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
      row.by_mode[p.mode] = (row.by_mode[p.mode] ?? 0) + amt;
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [folios, pays]);

  const totals = useMemo(() => days.reduce((acc, d) => ({
    sub_total: acc.sub_total + d.sub_total,
    gst_amount: acc.gst_amount + d.gst_amount,
    total_amount: acc.total_amount + d.total_amount,
    payments_total: acc.payments_total + d.payments_total,
  }), { sub_total: 0, gst_amount: 0, total_amount: 0, payments_total: 0 }), [days]);

  if (!propertyId) return <AppShell title="Sales Report"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Sales Report">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" /></div>
      </div>

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
                  {Object.keys(PAYMENT_MODE_LABELS).map((m) => (
                    <th key={m} className="px-3 py-2 text-right">{PAYMENT_MODE_LABELS[m]}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {days.length === 0 && (
                  <tr><td colSpan={11} className="px-3 py-4 text-muted-foreground">No data in range.</td></tr>
                )}
                {days.map((d) => (
                  <tr key={d.date}>
                    <td className="px-3 py-2 font-medium">{d.date}</td>
                    <td className="px-3 py-2 text-right">{inr(d.sub_total)}</td>
                    <td className="px-3 py-2 text-right">{inr(d.gst_amount)}</td>
                    <td className="px-3 py-2 text-right">{inr(d.total_amount)}</td>
                    <td className="px-3 py-2 text-right">{inr(d.payments_total)}</td>
                    {Object.keys(PAYMENT_MODE_LABELS).map((m) => (
                      <td key={m} className="px-3 py-2 text-right text-muted-foreground">{inr(d.by_mode[m] ?? 0)}</td>
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
                    <td className="px-3 py-2" colSpan={6}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}