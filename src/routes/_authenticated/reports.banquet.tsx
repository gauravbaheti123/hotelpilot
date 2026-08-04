import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentProperty } from "@/hooks/use-property";
import { listEventBookings } from "@/lib/banquetEvent";
import { billNo } from "@/lib/billNumber";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR, firstOfMonthIso } from "@/lib/reportExports";

import { RequirePermission } from "@/components/RequirePermission";
import { ReportDataTable } from "@/components/ReportDataTable";
import { istToday } from "@/lib/date";
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
  const today = istToday();
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [func, setFunc] = useState("all");
  const [status, setStatus] = useState("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [derived, setDerived] = useState<Row[]>([]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    const events = await listEventBookings(propertyId, {
      from, to,
      functionType: func !== "all" ? func : undefined,
      status: status !== "all" ? status : undefined,
    });
    const out: Row[] = events.map((b) => ({
      _id: b.booking_id, bill_no: billNo(b.banquet_number), event_name: b.event_name ?? b.function_type,
      function_type: b.function_type, hall: b.hall_name, date: b.event_date,
      host: b.guest_name ?? b.host_name ?? "", pax: b.pax,
      hall_charge: b.hall_charge, fb_charge: b.fb_charge,
      room_charge: b.total_room_charges,
      total: b.total_amount, advance: b.advance_amount,
      balance: b.balance_amount, status: b.status,
    }));
    setRows(out);
  }, [propertyId, from, to, func, status]);

  useEffect(() => { load(); }, [load]);

  const grand = useMemo(() => derived.reduce((s, r) => ({
    total: s.total + r.total, adv: s.adv + r.advance, bal: s.bal + r.balance,
  }), { total: 0, adv: 0, bal: 0 }), [derived]);

  const funcs = useMemo(() => Array.from(new Set(rows.map((r) => r.function_type))).filter(Boolean), [rows]);

  const columns: ReportColumn<Row>[] = [
    { key: "bill_no", header: "Event Bill No", get: (r) => r.bill_no, type: "text" },
    { key: "event", header: "Event Name", get: (r) => r.event_name, type: "text" },
    { key: "fn", header: "Function Type", get: (r) => r.function_type, type: "enum" },
    { key: "hall", header: "Hall", get: (r) => r.hall, type: "enum" },
    { key: "date", header: "Date", get: (r) => fmtDate(r.date), type: "date", sortValue: (r) => r.date, dateValue: (r) => r.date },
    { key: "host", header: "Host Name", get: (r) => r.host, type: "text" },
    { key: "pax", header: "Pax", get: (r) => r.pax, numeric: true, sortValue: (r) => r.pax },
    { key: "h", header: "Hall Charges", get: (r) => r.hall_charge, currency: true, sortValue: (r) => r.hall_charge },
    { key: "fb", header: "F&B Charges", get: (r) => r.fb_charge, currency: true, sortValue: (r) => r.fb_charge },
    { key: "rc", header: "Room Charges", get: (r) => r.room_charge, currency: true, sortValue: (r) => r.room_charge },
    { key: "total", header: "Total", get: (r) => r.total, currency: true, sortValue: (r) => r.total },
    { key: "adv", header: "Advance", get: (r) => r.advance, currency: true, sortValue: (r) => r.advance },
    { key: "bal", header: "Balance Due", get: (r) => r.balance, currency: true, sortValue: (r) => r.balance },
    { key: "status", header: "Status", get: (r) => r.status, type: "enum" },
  ];

  const meta = { reportName: "Banquet Report", propertyName: current?.name ?? "Property", from, to,
    totals: [
      ["Total events", derived.length],
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
      onExcel={() => exportExcel(derived, columns, meta)}
      onPdf={() => exportPdf(derived, columns, meta)}
      disabled={rows.length === 0}
    >
      <Card><CardContent className="pt-4">
        <ReportDataTable
          rows={rows}
          columns={columns}
          onDerivedRowsChange={setDerived}
          rowKey={(r) => r._id}
          emptyText="No events in range."
          totalsRow={(d) => (
            <tr>
              <td colSpan={10} className="px-2 py-2 text-right">{d.length} events · Totals</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(d.reduce((s, r) => s + r.total, 0))}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(d.reduce((s, r) => s + r.advance, 0))}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(d.reduce((s, r) => s + r.balance, 0))}</td>
              <td />
            </tr>
          )}
        />
      </CardContent></Card>
    </ReportShell>
  );
}