import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchBanquetScope, isBanquetRecord } from "@/lib/banquetScope";
import { useCurrentProperty } from "@/hooks/use-property";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RequirePermission } from "@/components/RequirePermission";
import { ReportDataTable } from "@/components/ReportDataTable";
import {
  ReportColumn, exportExcel, exportPdf, fmtDate, fmtDateTime, fmtINR, firstOfMonthIso,
} from "@/lib/reportExports";
import { istToday } from "@/lib/date";
import { reportQueryError } from "@/lib/queryError";

export const Route = createFileRoute("/_authenticated/reports/cash-collection")({
  head: () => ({ meta: [{ title: "Cash Collection — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><Page /></RequirePermission>),
});

interface Row {
  _id: string; date: string; time: string; bill_no: string; guest_name: string;
  amount: number; mode: string; received_by: string;
}

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const today = istToday();
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [mode, setMode] = useState("all");
  const [staff, setStaff] = useState("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [derived, setDerived] = useState<Row[]>([]);
  const [staffList, setStaffList] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    supabase.from("profiles").select("user_id,full_name,email").limit(200).then(({ data }) => {
      setStaffList(((data ?? []) as any[]).map((p) => ({ id: p.user_id, name: p.full_name ?? p.email ?? p.user_id.slice(0,6) })));
    });
  }, []);

  const load = useCallback(async () => {
    if (!propertyId) return;
    let q = supabase.from("payments").select(`
      id,amount,mode,paid_at,created_by,folio_id,booking_id,
      folios(invoice_number,bookings(guests(name))),
      bookings(guests(name))
    `).eq("property_id", propertyId)
      .gte("paid_at", `${from}T00:00:00`).lte("paid_at", `${to}T23:59:59`)
      .order("paid_at", { ascending: true });
    if (mode !== "all") q = q.eq("mode", mode);
    if (staff !== "all") q = q.eq("created_by", staff);
    const [{ data, error: __qp1 }, scope] = await Promise.all([q, fetchBanquetScope(propertyId)]);
    if (__qp1) reportQueryError("cash collection", __qp1);
    const profileMap = new Map(staffList.map((s) => [s.id, s.name] as const));
    // Banquet event-block collections are excluded (Owner-only Banquet Billing report).
    const out: Row[] = ((data ?? []) as any[])
      .filter((p) => !isBanquetRecord(scope, p))
      .map((p) => ({
      _id: p.id,
      date: p.paid_at, time: p.paid_at,
      bill_no: p.folios?.invoice_number ?? "—",
      guest_name: p.folios?.bookings?.guests?.name ?? p.bookings?.guests?.name ?? "",
      amount: Number(p.amount ?? 0), mode: p.mode ?? "",
      received_by: profileMap.get(p.created_by) ?? "",
    }));
    setRows(out);
  }, [propertyId, from, to, mode, staff, staffList]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const t = { cash: 0, card: 0, upi: 0, other: 0, grand: 0 };
    for (const r of derived) {
      t.grand += r.amount;
      if (r.mode === "cash") t.cash += r.amount;
      else if (r.mode === "card") t.card += r.amount;
      else if (r.mode === "upi") t.upi += r.amount;
      else t.other += r.amount;
    }
    return t;
  }, [derived]);

  const columns: ReportColumn<Row>[] = [
    { key: "date", header: "Date", get: (r) => fmtDate(r.date), type: "date", sortValue: (r) => r.date, dateValue: (r) => r.date },
    { key: "time", header: "Time", get: (r) => new Date(r.time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }), sortValue: (r) => r.time },
    { key: "bill_no", header: "Bill No", get: (r) => r.bill_no, type: "text" },
    { key: "guest_name", header: "Guest Name", get: (r) => r.guest_name, type: "text" },
    { key: "amount", header: "Amount", get: (r) => r.amount, currency: true, sortValue: (r) => r.amount },
    { key: "mode", header: "Payment Mode", get: (r) => r.mode, type: "enum" },
    { key: "received_by", header: "Received By", get: (r) => r.received_by, type: "enum" },
  ];

  const meta = { reportName: "Cash Collection Report", propertyName: current?.name ?? "Property", from, to,
    totals: [
      ["Cash Total", fmtINR(totals.cash)], ["Card Total", fmtINR(totals.card)],
      ["UPI Total", fmtINR(totals.upi)], ["Other", fmtINR(totals.other)],
      ["Grand Total", fmtINR(totals.grand)],
    ] as [string, string|number][] };

  return (
    <ReportShell title="Cash Collection Report"
      filters={<>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <div><Label>Staff</Label>
          <Select value={staff} onValueChange={setStaff}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All staff</SelectItem>
              {staffList.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label>Mode</Label>
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="card">Card</SelectItem>
              <SelectItem value="upi">UPI</SelectItem>
              <SelectItem value="complimentary">Comp</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </>}
      onExcel={() => exportExcel(derived, columns, meta)}
      onPdf={() => exportPdf(derived, columns, meta)}
      disabled={rows.length === 0}
    >
      <Card><CardContent className="pt-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {(["cash","card","upi"] as const).map((k) => (
            <div key={k} className="rounded border p-3">
              <div className="text-xs uppercase text-muted-foreground">{k}</div>
              <div className="text-lg font-semibold">{fmtINR((totals as any)[k])}</div>
            </div>
          ))}
          <div className="rounded border p-3 bg-emerald-50">
            <div className="text-xs uppercase text-muted-foreground">Grand Total</div>
            <div className="text-lg font-bold">{fmtINR(totals.grand)}</div>
          </div>
        </div>
        <ReportDataTable
          rows={rows}
          columns={columns}
          onDerivedRowsChange={setDerived}
          rowKey={(r) => r._id}
          emptyText="No collections in range"
          totalsRow={(d) => (
            <tr>
              <td colSpan={4} className="px-2 py-2 text-right">Totals</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(d.reduce((s, r) => s + r.amount, 0))}</td>
              <td colSpan={2} />
            </tr>
          )}
        />
      </CardContent></Card>
    </ReportShell>
  );
}

// Avoid unused import warning
void fmtDateTime;