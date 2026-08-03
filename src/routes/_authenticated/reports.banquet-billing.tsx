import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { useAuth, hasRole } from "@/hooks/use-auth";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RequirePermission } from "@/components/RequirePermission";
import { ReportDataTable } from "@/components/ReportDataTable";
import { ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR, firstOfMonthIso } from "@/lib/reportExports";

export const Route = createFileRoute("/_authenticated/reports/banquet-billing")({
  head: () => ({
    meta: [
      { title: "Banquet Billing (Owner) — HotelPilot" },
      { name: "description", content: "Owner-only report of banquet event-block folios and food bills." },
      { property: "og:title", content: "Banquet Billing (Owner) — HotelPilot" },
      { property: "og:description", content: "Owner-only report of banquet event-block folios and food bills." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (<RequirePermission module="reports"><Page /></RequirePermission>),
});

interface Row {
  _id: string; bill_no: string; date: string; room_no: string; guest: string;
  source: string; room_charges: number; food_charges: number; other_charges: number;
  sub_total: number; gst_amount: number; net_amount: number; paid: number; status: string;
}

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const { roles, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const isOwner = hasRole(roles, "owner") || hasRole(roles, "superadmin");
  useEffect(() => {
    if (!authLoading && !isOwner) navigate({ to: "/reports" });
  }, [authLoading, isOwner, navigate]);

  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [derived, setDerived] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId || !isOwner) return;
    setLoading(true);
    try {
      const fromIso = `${from}T00:00:00`;
      const toIso = `${to}T23:59:59`;

      // Banquet-origin bookings: rooms blocked for an event and checked in.
      const { data: ebRows } = await supabase
        .from("bookings")
        .select("id,booking_number,guests(name),booking_rooms(rooms!booking_rooms_room_id_fkey(room_number))")
        .eq("property_id", propertyId)
        .eq("source", "event_block");
      const bookings = (ebRows ?? []) as any[];
      const bookingIds = bookings.map((b) => b.id as string);
      const meta = new Map<string, { room: string; guest: string }>();
      for (const b of bookings) {
        meta.set(b.id, {
          room: b.booking_rooms?.[0]?.rooms?.room_number ?? "",
          guest: b.guests?.name ?? "",
        });
      }
      if (bookingIds.length === 0) { setRows([]); return; }

      const [{ data: folios }, { data: segs }] = await Promise.all([
        supabase.from("folios")
          .select("id,booking_id,invoice_number,created_at,sub_total,gst_amount,total_amount,paid_amount,status")
          .in("booking_id", bookingIds)
          .gte("created_at", fromIso).lte("created_at", toIso)
          .order("created_at", { ascending: false }),
        supabase.from("segment_bills")
          .select("id,booking_id,bill_number,segment,created_at,sub_total,gst_amount,total_amount,paid_amount,status")
          .in("booking_id", bookingIds)
          .gte("created_at", fromIso).lte("created_at", toIso)
          .order("created_at", { ascending: false }),
      ]);

      const folioIds = ((folios ?? []) as any[]).map((f) => f.id as string);
      const chargeMap = new Map<string, { room: number; food: number; other: number }>();
      if (folioIds.length) {
        const { data: charges } = await supabase
          .from("folio_charges").select("folio_id,charge_type,amount").in("folio_id", folioIds);
        for (const c of (charges ?? []) as any[]) {
          const m = chargeMap.get(c.folio_id) ?? { room: 0, food: 0, other: 0 };
          const a = Number(c.amount || 0);
          if (c.charge_type === "room") m.room += a;
          else if (c.charge_type === "food" || c.charge_type === "restaurant") m.food += a;
          else m.other += a;
          chargeMap.set(c.folio_id, m);
        }
      }

      const out: Row[] = [];
      for (const f of (folios ?? []) as any[]) {
        const m = chargeMap.get(f.id) ?? { room: 0, food: 0, other: 0 };
        const info = meta.get(f.booking_id) ?? { room: "", guest: "" };
        out.push({
          _id: `f_${f.id}`,
          bill_no: f.invoice_number ?? String(f.id).slice(0, 8),
          date: f.created_at, room_no: info.room, guest: info.guest,
          source: "Lodge (Event Block)",
          room_charges: m.room, food_charges: m.food, other_charges: m.other,
          sub_total: Number(f.sub_total ?? 0), gst_amount: Number(f.gst_amount ?? 0),
          net_amount: Number(f.total_amount ?? 0), paid: Number(f.paid_amount ?? 0),
          status: f.status ?? "open",
        });
      }
      for (const s of (segs ?? []) as any[]) {
        const info = meta.get(s.booking_id) ?? { room: "", guest: "" };
        const seg = String(s.segment ?? "other");
        const total = Number(s.total_amount ?? 0);
        out.push({
          _id: `s_${s.id}`,
          bill_no: s.bill_number ?? String(s.id).slice(0, 8),
          date: s.created_at, room_no: info.room, guest: info.guest,
          source: seg === "food" ? "Food / KOT (Event Block)" : `${seg} (Event Block)`,
          room_charges: 0,
          food_charges: seg === "food" ? Number(s.sub_total ?? total) : 0,
          other_charges: seg === "food" ? 0 : Number(s.sub_total ?? total),
          sub_total: Number(s.sub_total ?? total), gst_amount: Number(s.gst_amount ?? 0),
          net_amount: total, paid: Number(s.paid_amount ?? 0),
          status: s.status ?? "open",
        });
      }
      out.sort((a, b) => (a.date < b.date ? 1 : -1));
      setRows(out);
    } finally {
      setLoading(false);
    }
  }, [propertyId, isOwner, from, to]);

  useEffect(() => { load(); }, [load]);

  const columns: ReportColumn<Row>[] = useMemo(() => [
    { key: "bill_no", header: "Bill No", get: (r) => r.bill_no, type: "text" },
    { key: "date", header: "Date", get: (r) => fmtDate(r.date), type: "date", sortValue: (r) => r.date, dateValue: (r) => r.date },
    { key: "room_no", header: "Room", get: (r) => r.room_no, type: "text" },
    { key: "guest", header: "Guest / Event", get: (r) => r.guest, type: "text" },
    { key: "source", header: "Type", get: (r) => r.source, type: "enum" },
    { key: "room_charges", header: "Room Charges", get: (r) => r.room_charges, currency: true, sortValue: (r) => r.room_charges },
    { key: "food_charges", header: "Food Charges", get: (r) => r.food_charges, currency: true, sortValue: (r) => r.food_charges },
    { key: "other_charges", header: "Other Charges", get: (r) => r.other_charges, currency: true, sortValue: (r) => r.other_charges },
    { key: "gst_amount", header: "GST", get: (r) => r.gst_amount, currency: true, sortValue: (r) => r.gst_amount },
    { key: "net_amount", header: "Total", get: (r) => r.net_amount, currency: true, sortValue: (r) => r.net_amount },
    { key: "paid", header: "Paid", get: (r) => r.paid, currency: true, sortValue: (r) => r.paid },
    { key: "status", header: "Status", get: (r) => r.status, type: "enum" },
  ], []);

  const grand = useMemo(() => derived.reduce((s, r) => s + r.net_amount, 0), [derived]);
  const exportMeta = {
    reportName: "Banquet Billing (Owner)", propertyName: current?.name ?? "Property", from, to,
    totals: [["Total bills", derived.length], ["Grand total", fmtINR(grand)]] as [string, string | number][],
  };

  return (
    <ReportShell
      title="Banquet Billing (Owner)"
      filters={<>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
      </>}
      onExcel={() => exportExcel(derived, columns, exportMeta)}
      onPdf={() => exportPdf(derived, columns, exportMeta)}
      disabled={loading || rows.length === 0}
    >
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground mb-3">
            Folios and food bills raised against banquet event-block rooms. These are
            excluded from all operational reports and appear only here.
          </p>
          <ReportDataTable
            rows={rows}
            columns={columns}
            onDerivedRowsChange={setDerived}
            rowKey={(r) => r._id}
            emptyText={loading ? "Loading…" : "No banquet-linked bills found"}
            renderRow={(r) => (
              <tr key={r._id} className="border-t hover:bg-muted/30">
                {columns.map((c) => (
                  <td key={c.key} className={`px-2 py-1.5 ${c.currency ? "text-right tabular-nums" : ""}`}>
                    {c.currency ? fmtINR(c.get(r) as number) : c.key === "status" ? <Badge variant="outline">{r.status}</Badge> : c.get(r)}
                  </td>
                ))}
              </tr>
            )}
            totalsRow={(d) => (
              <tr>
                <td colSpan={9} className="px-2 py-2 text-right">Grand Total ({d.length} bills)</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtINR(d.reduce((s, r) => s + r.net_amount, 0))}</td>
                <td colSpan={2} />
              </tr>
            )}
          />
        </CardContent>
      </Card>
    </ReportShell>
  );
}
