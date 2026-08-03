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
  ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR, firstOfMonthIso,
} from "@/lib/reportExports";

export const Route = createFileRoute("/_authenticated/reports/room-wise")({
  head: () => ({ meta: [{ title: "Room-Wise Report — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><Page /></RequirePermission>),
});

interface Row {
  _id: string; room_no: string; category: string; guest_name: string;
  check_in: string; check_out: string; nights: number; tariff_plan: string;
  rate: number; total_amount: number; payment_status: string;
  checked_in_by_name: string; checked_out_by_name: string;
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
  const [derived, setDerived] = useState<Row[]>([]);

  useEffect(() => {
    if (!propertyId) return;
    supabase.from("room_categories").select("id,name").eq("property_id", propertyId).then(({ data }) => setCats((data ?? []) as any));
    supabase.from("rooms").select("id,room_number").eq("property_id", propertyId).order("room_number").then(({ data }) => setRoomsList((data ?? []) as any));
  }, [propertyId]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    let q = supabase.from("booking_rooms").select(`
      id,rate,check_in,check_out,
      rooms:room_id(id,room_number),
      room_categories(name),
      tariff:tariff_id(name),
      bookings(id,status,total_amount,balance_amount,checked_in_by,checked_out_by,guests(name))
    `).eq("property_id", propertyId)
      .gte("check_in", from).lte("check_in", to);
    if (catId !== "all") q = q.eq("category_id", catId);
    if (roomId !== "all") q = q.eq("room_id", roomId);
    const { data, error } = await q;
    if (error) { console.error("[room-wise] load failed:", error); setRows([]); return; }
    const raw = (data ?? []) as any[];
    const uids = new Set<string>();
    for (const br of raw) {
      const b = br.bookings;
      if (b?.checked_in_by) uids.add(b.checked_in_by);
      if (b?.checked_out_by) uids.add(b.checked_out_by);
    }
    const nameMap = new Map<string, string>();
    if (uids.size) {
      const { data: profs } = await supabase.from("profiles")
        .select("id,name,email").in("id", Array.from(uids));
      for (const p of (profs ?? []) as any[]) {
        nameMap.set(p.id, p.name || p.email || "");
      }
    }
    const out: Row[] = raw.map((br) => {
      const inD = new Date(br.check_in), outD = new Date(br.check_out);
      const nights = Math.max(1, Math.round((+outD - +inD) / 86400000));
      const total = nights * Number(br.rate || 0);
      const bal = Number(br.bookings?.balance_amount ?? 0);
      const cib = br.bookings?.checked_in_by as string | null;
      const cob = br.bookings?.checked_out_by as string | null;
      return {
        _id: br.id, room_no: br.rooms?.room_number ?? "",
        category: br.room_categories?.name ?? "",
        guest_name: br.bookings?.guests?.name ?? "",
        check_in: br.check_in, check_out: br.check_out, nights,
        tariff_plan: br.tariff?.name ?? "Rack",
        rate: Number(br.rate || 0), total_amount: total,
        payment_status: bal > 0 ? "Pending" : "Paid",
        checked_in_by_name: cib ? (nameMap.get(cib) ?? "—") : "—",
        checked_out_by_name: cob ? (nameMap.get(cob) ?? "—") : "—",
      };
    });
    out.sort((a, b) => a.room_no.localeCompare(b.room_no) || a.check_in.localeCompare(b.check_in));
    setRows(out);
  }, [propertyId, from, to, catId, roomId]);

  useEffect(() => { load(); }, [load]);

  const grandDerived = useMemo(() => derived.reduce((s, r) => s + r.total_amount, 0), [derived]);

  const columns: ReportColumn<Row>[] = [
    { key: "room_no", header: "Room No", get: (r) => r.room_no, type: "enum" },
    { key: "category", header: "Category", get: (r) => r.category, type: "enum" },
    { key: "guest", header: "Guest Name", get: (r) => r.guest_name, type: "text" },
    { key: "ci", header: "Check-in", get: (r) => fmtDate(r.check_in), type: "date", sortValue: (r) => r.check_in, dateValue: (r) => r.check_in },
    { key: "co", header: "Checkout", get: (r) => fmtDate(r.check_out), type: "date", sortValue: (r) => r.check_out, dateValue: (r) => r.check_out },
    { key: "nights", header: "Nights", get: (r) => r.nights, numeric: true, sortValue: (r) => r.nights },
    { key: "tariff", header: "Tariff Plan", get: (r) => r.tariff_plan, type: "enum" },
    { key: "rate", header: "Rate/Night", get: (r) => r.rate, currency: true, sortValue: (r) => r.rate },
    { key: "total", header: "Total Amount", get: (r) => r.total_amount, currency: true, sortValue: (r) => r.total_amount },
    { key: "ps", header: "Payment Status", get: (r) => r.payment_status, type: "enum" },
    { key: "cib", header: "Checked-in By", get: (r) => r.checked_in_by_name, type: "enum" },
    { key: "cob", header: "Checked-out By", get: (r) => r.checked_out_by_name, type: "enum" },
  ];

  const meta = { reportName: "Room-Wise Report", propertyName: current?.name ?? "Property", from, to,
    totals: [["All rooms total", fmtINR(grandDerived)]] as [string, string|number][] };

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
          emptyText="No bookings in range."
          totalsRow={(d) => (
            <tr>
              <td colSpan={8} className="px-2 py-2 text-right">All rooms total</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(d.reduce((s, r) => s + r.total_amount, 0))}</td>
              <td />
              <td />
              <td />
            </tr>
          )}
        />
      </CardContent></Card>
    </ReportShell>
  );
}