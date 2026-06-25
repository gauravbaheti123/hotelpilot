import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR, firstOfMonthIso,
} from "@/lib/reportExports";

export const Route = createFileRoute("/_authenticated/reports/room-wise")({
  head: () => ({ meta: [{ title: "Room-Wise Report — HotelPilot" }] }),
  component: Page,
});

interface Row {
  _id: string; room_no: string; category: string; guest_name: string;
  check_in: string; check_out: string; nights: number; tariff_plan: string;
  rate: number; total_amount: number; payment_status: string;
}

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [catId, setCatId] = useState("all");
  const [roomId, setRoomId] = useState("all");
  const [cats, setCats] = useState<Array<{ id: string; name: string }>>([]);
  const [roomsList, setRoomsList] = useState<Array<{ id: string; room_number: string }>>([]);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!propertyId) return;
    supabase.from("room_categories").select("id,name").eq("property_id", propertyId).then(({ data }) => setCats((data ?? []) as any));
    supabase.from("rooms").select("id,room_number").eq("property_id", propertyId).order("room_number").then(({ data }) => setRoomsList((data ?? []) as any));
  }, [propertyId]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    let q = supabase.from("booking_rooms").select(`
      id,rate,check_in,check_out,
      rooms!inner(id,room_number,property_id),
      room_categories(name),
      tariff:tariff_id(name),
      bookings(id,status,total_amount,balance_amount,guests(name))
    `).eq("rooms.property_id", propertyId)
      .gte("check_in", from).lte("check_in", to);
    if (catId !== "all") q = q.eq("category_id", catId);
    if (roomId !== "all") q = q.eq("room_id", roomId);
    const { data } = await q;
    const out: Row[] = ((data ?? []) as any[]).map((br) => {
      const inD = new Date(br.check_in), outD = new Date(br.check_out);
      const nights = Math.max(1, Math.round((+outD - +inD) / 86400000));
      const total = nights * Number(br.rate || 0);
      const bal = Number(br.bookings?.balance_amount ?? 0);
      return {
        _id: br.id, room_no: br.rooms?.room_number ?? "",
        category: br.room_categories?.name ?? "",
        guest_name: br.bookings?.guests?.name ?? "",
        check_in: br.check_in, check_out: br.check_out, nights,
        tariff_plan: br.tariff?.name ?? "Rack",
        rate: Number(br.rate || 0), total_amount: total,
        payment_status: bal > 0 ? "Pending" : "Paid",
      };
    });
    out.sort((a, b) => a.room_no.localeCompare(b.room_no) || a.check_in.localeCompare(b.check_in));
    setRows(out);
  }, [propertyId, from, to, catId, roomId]);

  useEffect(() => { load(); }, [load]);

  const grand = useMemo(() => rows.reduce((s, r) => s + r.total_amount, 0), [rows]);

  const grouped = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const a = m.get(r.room_no) ?? []; a.push(r); m.set(r.room_no, a);
    }
    return Array.from(m.entries());
  }, [rows]);

  const columns: ReportColumn<Row>[] = [
    { key: "room_no", header: "Room No", get: (r) => r.room_no },
    { key: "category", header: "Category", get: (r) => r.category },
    { key: "guest", header: "Guest Name", get: (r) => r.guest_name },
    { key: "ci", header: "Check-in", get: (r) => fmtDate(r.check_in) },
    { key: "co", header: "Checkout", get: (r) => fmtDate(r.check_out) },
    { key: "nights", header: "Nights", get: (r) => r.nights },
    { key: "tariff", header: "Tariff Plan", get: (r) => r.tariff_plan },
    { key: "rate", header: "Rate/Night", get: (r) => r.rate, currency: true },
    { key: "total", header: "Total Amount", get: (r) => r.total_amount, currency: true },
    { key: "ps", header: "Payment Status", get: (r) => r.payment_status },
  ];

  const meta = { reportName: "Room-Wise Report", propertyName: current?.name ?? "Property", from, to,
    totals: [["All rooms total", fmtINR(grand)]] as [string, string|number][] };

  return (
    <ReportShell title="Room-Wise Report"
      filters={<>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <div><Label>Category</Label>
          <Select value={catId} onValueChange={setCatId}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label>Room</Label>
          <Select value={roomId} onValueChange={setRoomId}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {roomsList.map((r) => <SelectItem key={r.id} value={r.id}>{r.room_number}</SelectItem>)}
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
            {columns.map((c) => <th key={c.key} className={`px-2 py-2 text-left ${c.currency ? "text-right" : ""}`}>{c.header}</th>)}
          </tr></thead>
          {grouped.map(([rno, items]) => {
            const subN = items.reduce((s, r) => s + r.nights, 0);
            const subA = items.reduce((s, r) => s + r.total_amount, 0);
            return (
              <tbody key={rno}>
                {items.map((r) => (
                  <tr key={r._id} className="border-t">
                    {columns.map((c) => (
                      <td key={c.key} className={`px-2 py-1.5 ${c.currency ? "text-right tabular-nums" : ""}`}>
                        {c.currency ? fmtINR(c.get(r) as number) : c.get(r)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-emerald-50 font-semibold">
                  <td colSpan={5} className="px-2 py-1.5 text-right">Room {rno} Subtotal</td>
                  <td className="px-2 py-1.5 text-right">{subN}</td>
                  <td colSpan={2} />
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtINR(subA)}</td>
                  <td />
                </tr>
              </tbody>
            );
          })}
          <tfoot className="bg-emerald-100 font-bold">
            <tr>
              <td colSpan={8} className="px-2 py-2 text-right">All rooms total</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        {rows.length === 0 && <p className="text-center py-6 text-muted-foreground text-sm">No bookings in range.</p>}
      </CardContent></Card>
    </ReportShell>
  );
}