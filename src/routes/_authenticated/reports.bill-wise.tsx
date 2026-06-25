import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR, firstOfMonthIso,
  buildTallySalesXml, downloadXml, buildFileName,
} from "@/lib/reportExports";

export const Route = createFileRoute("/_authenticated/reports/bill-wise")({
  head: () => ({ meta: [{ title: "Bill-Wise Report — HotelPilot" }] }),
  component: Page,
});

interface Row {
  bill_no: string; date: string; guest_name: string; room_no: string;
  room_charges: number; food_charges: number; other_charges: number;
  total_amount: number; discount: number; net_amount: number;
  payment_mode: string; bill_type: string; status: string;
  gst_amount: number; sub_total: number;
  _id: string;
}

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [billType, setBillType] = useState<string>("all");
  const [payMode, setPayMode] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    const fromIso = `${from}T00:00:00`;
    const toIso = `${to}T23:59:59`;
    let q = supabase.from("folios").select(`
      id,invoice_number,created_at,sub_total,gst_amount,discount_amount,total_amount,bill_type,status,
      bookings(booking_rooms(rooms(room_number)),guests(name))
    `).eq("property_id", propertyId).gte("created_at", fromIso).lte("created_at", toIso)
      .order("created_at", { ascending: false });
    if (billType !== "all") q = q.eq("bill_type", billType);
    if (status !== "all") q = q.eq("status", status === "active" ? "settled" : "voided");
    const { data: folios } = await q;
    const ids = (folios ?? []).map((f: any) => f.id);
    const [{ data: charges }, { data: pays }] = await Promise.all([
      ids.length ? supabase.from("folio_charges").select("folio_id,charge_type,amount").in("folio_id", ids) : Promise.resolve({ data: [] as any[] }),
      ids.length ? supabase.from("payments").select("folio_id,mode,paid_at").in("folio_id", ids) : Promise.resolve({ data: [] as any[] }),
    ]);
    const chargeMap = new Map<string, { room: number; food: number; other: number }>();
    for (const c of (charges ?? []) as any[]) {
      const m = chargeMap.get(c.folio_id) ?? { room: 0, food: 0, other: 0 };
      const a = Number(c.amount || 0);
      if (c.charge_type === "room") m.room += a;
      else if (c.charge_type === "food" || c.charge_type === "restaurant") m.food += a;
      else m.other += a;
      chargeMap.set(c.folio_id, m);
    }
    const payMap = new Map<string, string>();
    for (const p of (pays ?? []) as any[]) {
      if (!payMap.has(p.folio_id)) payMap.set(p.folio_id, p.mode ?? "");
    }
    let out: Row[] = (folios ?? []).map((f: any) => {
      const room = f.bookings?.booking_rooms?.[0]?.rooms?.room_number ?? "";
      const guest = f.bookings?.guests?.name ?? "";
      const m = chargeMap.get(f.id) ?? { room: 0, food: 0, other: 0 };
      return {
        _id: f.id,
        bill_no: f.invoice_number ?? f.id.slice(0, 8),
        date: f.created_at,
        guest_name: guest, room_no: room,
        room_charges: m.room, food_charges: m.food, other_charges: m.other,
        total_amount: Number(f.sub_total ?? 0), discount: Number(f.discount_amount ?? 0),
        net_amount: Number(f.total_amount ?? 0),
        payment_mode: payMap.get(f.id) ?? "",
        bill_type: f.bill_type ?? "cash_bill", status: f.status,
        gst_amount: Number(f.gst_amount ?? 0),
        sub_total: Number(f.sub_total ?? 0),
      };
    });
    if (payMode !== "all") out = out.filter((r) => r.payment_mode === payMode);
    setRows(out);
    setLoading(false);
  }, [propertyId, from, to, billType, payMode, status]);

  useEffect(() => { load(); }, [load]);

  const grand = useMemo(() => rows.reduce((s, r) => s + r.net_amount, 0), [rows]);

  const columns: ReportColumn<Row>[] = useMemo(() => [
    { key: "bill_no", header: "Bill No", get: (r) => r.bill_no },
    { key: "date", header: "Date", get: (r) => fmtDate(r.date) },
    { key: "guest_name", header: "Guest Name", get: (r) => r.guest_name },
    { key: "room_no", header: "Room", get: (r) => r.room_no },
    { key: "room_charges", header: "Room Charges", get: (r) => r.room_charges, currency: true },
    { key: "food_charges", header: "Food Charges", get: (r) => r.food_charges, currency: true },
    { key: "other_charges", header: "Other Charges", get: (r) => r.other_charges, currency: true },
    { key: "total_amount", header: "Total Amount", get: (r) => r.total_amount, currency: true },
    { key: "discount", header: "Discount", get: (r) => r.discount, currency: true },
    { key: "net_amount", header: "Net Amount", get: (r) => r.net_amount, currency: true },
    { key: "payment_mode", header: "Payment Mode", get: (r) => r.payment_mode },
    { key: "bill_type", header: "Bill Type", get: (r) => r.bill_type === "gst_invoice" ? "GST Invoice" : "Cash Bill" },
    { key: "status", header: "Status", get: (r) => r.status },
  ], []);

  const meta = { reportName: "Bill-Wise Report", propertyName: current?.name ?? "Property", from, to,
    totals: [["Total bills", rows.length], ["Grand total", fmtINR(grand)]] as [string, string|number][] };

  function tallyXml() {
    const gstOnly = rows.filter((r) => r.bill_type === "gst_invoice");
    const xml = buildTallySalesXml(gstOnly.map((r) => ({
      date: r.date, voucher_number: r.bill_no, guest_name: r.guest_name,
      taxable_amount: r.sub_total - r.discount,
      cgst_amount: r.gst_amount / 2, sgst_amount: r.gst_amount / 2, total_amount: r.net_amount,
    })));
    downloadXml(xml, buildFileName({ ...meta, reportName: "BillWise_Tally" }, "xml"));
  }

  return (
    <ReportShell
      title="Bill-Wise Report"
      filters={<Filters {...{ from, to, setFrom, setTo, billType, setBillType, payMode, setPayMode, status, setStatus }} />}
      onExcel={() => exportExcel(rows, columns, meta)}
      onPdf={() => exportPdf(rows, columns, meta)}
      onTally={tallyXml}
      tallyLabel="Export for Tally"
      disabled={loading || rows.length === 0}
    >
      <Card>
        <CardContent className="pt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr>{columns.map((c) => <th key={c.key} className={`px-2 py-2 text-left whitespace-nowrap ${c.currency ? "text-right" : ""}`}>{c.header}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} className="border-t hover:bg-muted/30">
                  {columns.map((c) => (
                    <td key={c.key} className={`px-2 py-1.5 ${c.currency ? "text-right tabular-nums" : ""}`}>
                      {c.currency ? fmtINR(c.get(r) as number) : c.key === "status" ? <Badge variant="outline">{r.status}</Badge> : c.get(r)}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={columns.length} className="text-center py-6 text-muted-foreground">{loading ? "Loading…" : "No bills found"}</td></tr>}
            </tbody>
            <tfoot className="bg-emerald-50 font-semibold">
              <tr>
                <td colSpan={9} className="px-2 py-2 text-right">Grand Total ({rows.length} bills)</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>
    </ReportShell>
  );
}

function Filters(p: {
  from: string; to: string; setFrom: (v: string)=>void; setTo: (v: string)=>void;
  billType: string; setBillType: (v: string)=>void;
  payMode: string; setPayMode: (v: string)=>void;
  status: string; setStatus: (v: string)=>void;
}) {
  return (<>
    <div><Label>From</Label><Input type="date" value={p.from} onChange={(e) => p.setFrom(e.target.value)} className="w-40" /></div>
    <div><Label>To</Label><Input type="date" value={p.to} onChange={(e) => p.setTo(e.target.value)} className="w-40" /></div>
    <div><Label>Bill Type</Label>
      <Select value={p.billType} onValueChange={p.setBillType}>
        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="gst_invoice">GST Invoice</SelectItem>
          <SelectItem value="cash_bill">Cash Bill</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div><Label>Payment Mode</Label>
      <Select value={p.payMode} onValueChange={p.setPayMode}>
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
    <div><Label>Status</Label>
      <Select value={p.status} onValueChange={p.setStatus}>
        <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="void">Void</SelectItem>
        </SelectContent>
      </Select>
    </div>
  </>);
}