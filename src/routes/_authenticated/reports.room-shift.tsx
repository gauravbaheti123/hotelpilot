import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ReportColumn, exportExcel, exportPdf, fmtDate, fmtDateTime, fmtINR, firstOfMonthIso,
} from "@/lib/reportExports";

export const Route = createFileRoute("/_authenticated/reports/room-shift")({
  head: () => ({ meta: [{ title: "Room Shift Report — HotelPilot" }] }),
  component: Page,
});

interface Row {
  id: string;
  booking_number: string;
  guest_name: string;
  from_room: string;
  to_room: string;
  shifted_at: string;
  old_rate: number;
  new_rate: number;
  rate_applied: number;
  rate_type: "original_rate" | "new_rate";
  difference: number;
  total_room_bill: number;
  category: string;
}

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [typeFilter, setTypeFilter] = useState<"all" | "original_rate" | "new_rate">("all");
  const [catFilter, setCatFilter] = useState("all");
  const [cats, setCats] = useState<Array<{ id: string; name: string }>>([]);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!propertyId) return;
    supabase.from("room_categories").select("id,name").eq("property_id", propertyId)
      .then(({ data }) => setCats((data ?? []) as any));
  }, [propertyId]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    const fromIso = new Date(`${from}T00:00:00`).toISOString();
    const toD = new Date(`${to}T00:00:00`); toD.setDate(toD.getDate() + 1);
    const toIso = toD.toISOString();
    const { data } = await supabase
      .from("room_shifts")
      .select(`
        id, shifted_at, old_rate, new_rate, rate_applied, rate_type, tariff_choice,
        from_room:from_room_id(room_number, room_categories(id,name)),
        to_room:to_room_id(room_number, room_categories(id,name)),
        booking_room:booking_room_id(
          rate, check_in, check_out,
          bookings(id, booking_number, total_amount, guests(name))
        )
      `)
      .eq("property_id", propertyId)
      .gte("shifted_at", fromIso)
      .lt("shifted_at", toIso)
      .order("shifted_at", { ascending: false });
    const out: Row[] = ((data ?? []) as any[]).map((s) => {
      const old = Number(s.old_rate ?? 0);
      const nw = Number(s.new_rate ?? 0);
      const applied = Number(s.rate_applied ?? s.new_rate ?? 0);
      const rt = (s.rate_type ?? (s.tariff_choice === "keep" ? "original_rate" : "new_rate")) as Row["rate_type"];
      const br = s.booking_room;
      const bk = br?.bookings;
      return {
        id: s.id,
        booking_number: bk?.booking_number ?? "",
        guest_name: bk?.guests?.name ?? "—",
        from_room: s.from_room?.room_number ?? "—",
        to_room: s.to_room?.room_number ?? "—",
        shifted_at: s.shifted_at,
        old_rate: old,
        new_rate: nw,
        rate_applied: applied,
        rate_type: rt,
        difference: applied - old,
        total_room_bill: Number(bk?.total_amount ?? 0),
        category: s.to_room?.room_categories?.name ?? "",
      };
    });
    setRows(out);
  }, [propertyId, from, to]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (typeFilter !== "all" && r.rate_type !== typeFilter) return false;
    if (catFilter !== "all" && r.category !== cats.find((c) => c.id === catFilter)?.name) return false;
    return true;
  }), [rows, typeFilter, catFilter, cats]);

  const totals = useMemo(() => {
    const kept = filtered.filter((r) => r.rate_type === "original_rate").length;
    const newApp = filtered.filter((r) => r.rate_type === "new_rate").length;
    const diff = filtered.reduce((s, r) => s + r.difference, 0);
    return { total: filtered.length, kept, newApp, diff };
  }, [filtered]);

  const columns: ReportColumn<Row>[] = [
    { key: "booking_number", header: "Booking #", get: (r) => r.booking_number },
    { key: "guest_name", header: "Guest", get: (r) => r.guest_name },
    { key: "from_room", header: "Original Room", get: (r) => r.from_room },
    { key: "to_room", header: "New Room", get: (r) => r.to_room },
    { key: "shifted_at", header: "Shift Date", get: (r) => fmtDateTime(r.shifted_at) },
    { key: "old_rate", header: "Original Rate", get: (r) => r.old_rate, currency: true },
    { key: "new_rate", header: "New Room Rate", get: (r) => r.new_rate, currency: true },
    { key: "rate_applied", header: "Rate Applied", get: (r) => r.rate_applied, currency: true },
    { key: "rate_type", header: "Rate Type", get: (r) => r.rate_type === "original_rate" ? "Original Rate Kept" : "New Room Rate Applied" },
    { key: "difference", header: "Difference", get: (r) => r.difference, currency: true },
    { key: "total_room_bill", header: "Total Room Bill", get: (r) => r.total_room_bill, currency: true },
  ];

  function doExcel() {
    exportExcel(filtered, columns, {
      reportName: "Room Shift Billing Report",
      propertyName: current?.name ?? "",
      from, to,
      totals: [
        ["Total shifts", totals.total],
        ["Original rate kept", totals.kept],
        ["New rate applied", totals.newApp],
        ["Revenue difference", fmtINR(totals.diff)],
      ],
    });
  }
  function doPdf() {
    exportPdf(filtered, columns, {
      reportName: "Room Shift Billing Report",
      propertyName: current?.name ?? "",
      from, to,
      totals: [
        ["Total shifts", totals.total],
        ["Original rate kept", totals.kept],
        ["New rate applied", totals.newApp],
        ["Revenue difference", fmtINR(totals.diff)],
      ],
    });
  }

  return (
    <ReportShell
      title="Room Shift Billing Report"
      onExcel={doExcel}
      onPdf={doPdf}
      filters={
        <>
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="min-w-[180px]">
            <Label className="text-xs">Rate Type</Label>
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="original_rate">Kept Original</SelectItem>
                <SelectItem value="new_rate">New Rate Applied</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px]">
            <Label className="text-xs">Room Category</Label>
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </>
      }
    >
      <div className="grid sm:grid-cols-4 gap-3 mb-3 print:hidden">
        <Summary label="Total shifts" value={totals.total.toString()} />
        <Summary label="Kept original rate" value={`${totals.kept} bookings`} />
        <Summary label="Applied new rate" value={`${totals.newApp} bookings`} />
        <Summary label="Revenue difference" value={fmtINR(totals.diff)} tone={totals.diff >= 0 ? "pos" : "neg"} />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Booking #</TableHead>
                <TableHead>Guest</TableHead>
                <TableHead>From → To</TableHead>
                <TableHead>Shift Date</TableHead>
                <TableHead className="text-right">Original Rate</TableHead>
                <TableHead className="text-right">New Room Rate</TableHead>
                <TableHead className="text-right">Applied</TableHead>
                <TableHead>Rate Type</TableHead>
                <TableHead className="text-right">Diff</TableHead>
                <TableHead className="text-right">Total Bill</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-6">No shifts in range.</TableCell></TableRow>
              )}
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.booking_number}</TableCell>
                  <TableCell>{r.guest_name}</TableCell>
                  <TableCell>{r.from_room} → {r.to_room}</TableCell>
                  <TableCell className="text-xs">{fmtDate(r.shifted_at)}</TableCell>
                  <TableCell className="text-right">{fmtINR(r.old_rate)}</TableCell>
                  <TableCell className="text-right">{fmtINR(r.new_rate)}</TableCell>
                  <TableCell className="text-right font-medium">{fmtINR(r.rate_applied)}</TableCell>
                  <TableCell>
                    {r.rate_type === "original_rate"
                      ? <Badge className="bg-amber-100 text-amber-800 border-amber-300" variant="outline">Original Rate Kept</Badge>
                      : <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300" variant="outline">New Room Rate Applied</Badge>}
                  </TableCell>
                  <TableCell className={`text-right ${r.difference > 0 ? "text-emerald-700" : r.difference < 0 ? "text-rose-700" : ""}`}>
                    {r.difference > 0 ? "+" : ""}{fmtINR(r.difference)}
                  </TableCell>
                  <TableCell className="text-right">{fmtINR(r.total_room_bill)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ReportShell>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  const c = tone === "pos" ? "text-emerald-700" : tone === "neg" ? "text-rose-700" : "";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold mt-1 ${c}`}>{value}</div>
      </CardContent>
    </Card>
  );
}