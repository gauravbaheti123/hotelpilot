import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR, firstOfMonthIso } from "@/lib/reportExports";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/reports/banquet")({
  head: () => ({ meta: [{ title: "Banquet Report — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><Page /></RequirePermission>),
});

interface Row {
  _id: string; bill_no: string; event_name: string; function_type: string;
  hall: string; date: string; host: string; pax: number;
  hall_charge: number; fb_charge: number; room_charge: number;
  total: number; advance: number; balance: number; status: string;
}

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [func, setFunc] = useState("all");
  const [status, setStatus] = useState("all");
  const [rows, setRows] = useState<Row[]>([]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    let q = supabase.from("banquet_bookings").select(`
      id,banquet_number,event_name,function_type,event_date,pax,
      hall_charge,fb_charge,extra_charge,total_amount,advance_amount,balance_amount,
      total_room_charges,status,
      halls(name),guests(name)
    `).eq("property_id", propertyId)
      .gte("event_date", from).lte("event_date", to)
      .order("event_date", { ascending: false });
    if (func !== "all") q = q.eq("function_type", func);
    if (status !== "all") q = q.eq("status", status);
    const { data } = await q;
    const out: Row[] = ((data ?? []) as any[]).map((b) => ({
      _id: b.id, bill_no: b.banquet_number, event_name: b.event_name ?? b.function_type,
      function_type: b.function_type, hall: b.halls?.name ?? "", date: b.event_date,
      host: b.guests?.name ?? "", pax: Number(b.pax || 0),
      hall_charge: Number(b.hall_charge || 0), fb_charge: Number(b.fb_charge || 0),
      room_charge: Number(b.total_room_charges || 0),
      total: Number(b.total_amount || 0), advance: Number(b.advance_amount || 0),
      balance: Number(b.balance_amount || 0), status: b.status,
    }));
    setRows(out);
  }, [propertyId, from, to, func, status]);

  useEffect(() => { load(); }, [load]);

  const grand = useMemo(() => rows.reduce((s, r) => ({
    total: s.total + r.total, adv: s.adv + r.advance, bal: s.bal + r.balance,
  }), { total: 0, adv: 0, bal: 0 }), [rows]);

  const funcs = useMemo(() => Array.from(new Set(rows.map((r) => r.function_type))).filter(Boolean), [rows]);

  const columns: ReportColumn<Row>[] = [
    { key: "bill_no", header: "Event Bill No", get: (r) => r.bill_no },
    { key: "event", header: "Event Name", get: (r) => r.event_name },
    { key: "fn", header: "Function Type", get: (r) => r.function_type },
    { key: "hall", header: "Hall", get: (r) => r.hall },
    { key: "date", header: "Date", get: (r) => fmtDate(r.date) },
    { key: "host", header: "Host Name", get: (r) => r.host },
    { key: "pax", header: "Pax", get: (r) => r.pax, numeric: true },
    { key: "h", header: "Hall Charges", get: (r) => r.hall_charge, currency: true },
    { key: "fb", header: "F&B Charges", get: (r) => r.fb_charge, currency: true },
    { key: "rc", header: "Room Charges", get: (r) => r.room_charge, currency: true },
    { key: "total", header: "Total", get: (r) => r.total, currency: true },
    { key: "adv", header: "Advance", get: (r) => r.advance, currency: true },
    { key: "bal", header: "Balance Due", get: (r) => r.balance, currency: true },
    { key: "status", header: "Status", get: (r) => r.status },
  ];

  const meta = { reportName: "Banquet Report", propertyName: current?.name ?? "Property", from, to,
    totals: [
      ["Total events", rows.length],
      ["Total revenue", fmtINR(grand.total)],
      ["Total advance", fmtINR(grand.adv)],
      ["Total balance", fmtINR(grand.bal)],
    ] as [string, string|number][] };

  return (
    <ReportShell title="Banquet Report"
      filters={<>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <div><Label>Function Type</Label>
          <Select value={func} onValueChange={setFunc}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {funcs.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="reserved">Reserved</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </>}
      onExcel={() => exportExcel(rows, columns, meta)}
      onPdf={() => exportPdf(rows, columns, meta)}
      disabled={rows.length === 0}
    >
      <Card><CardContent className="pt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40"><tr>
            {columns.map((c) => <th key={c.key} className={`px-2 py-2 text-left ${c.currency || c.numeric ? "text-right" : ""}`}>{c.header}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._id} className="border-t">
                {columns.map((c) => (
                  <td key={c.key} className={`px-2 py-1.5 ${c.currency || c.numeric ? "text-right tabular-nums" : ""}`}>
                    {c.currency ? fmtINR(c.get(r) as number) : c.get(r)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={columns.length} className="text-center py-6 text-muted-foreground">No events in range.</td></tr>}
          </tbody>
          <tfoot className="bg-emerald-50 font-semibold">
            <tr>
              <td colSpan={10} className="px-2 py-2 text-right">{rows.length} events · Totals</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand.total)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand.adv)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand.bal)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </CardContent></Card>
    </ReportShell>
  );
}