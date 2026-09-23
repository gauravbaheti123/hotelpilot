import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequirePermission } from "@/components/RequirePermission";
import { ReportDataTable } from "@/components/ReportDataTable";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import {
  ReportColumn, exportExcel, exportPdf, fmtDate, fmtDateTime, fmtINR, firstOfMonthIso,
} from "@/lib/reportExports";
import { istToday } from "@/lib/date";
import { pagedSelect, pagedIn } from "@/lib/reportPaging";

export const Route = createFileRoute("/_authenticated/reports/cancelled")({
  head: () => ({ meta: [{ title: "Cancelled Bookings Report — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><Page /></RequirePermission>),
});

interface Row {
  id: string;
  booking_number: string;
  guest: string;
  rooms: string;
  check_in: string;
  check_out: string;
  cancelled_at: string | null;
  cancelled_by: string;
  reason: string;
  advance: number;
  refund: string;
  total: number;
}

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const today = istToday();
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [derived, setDerived] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const fromIso = new Date(`${from}T00:00:00`).toISOString();
      const toD = new Date(`${to}T00:00:00`); toD.setDate(toD.getDate() + 1);
      const toIso = toD.toISOString();
      const bookings = await pagedSelect<any>("cancelled bookings", (f, t) => supabase
        .from("bookings")
        .select(`
          id, booking_number, check_in, check_out, cancelled_at, cancelled_reason,
          advance_amount, total_amount, created_at,
          guests(name, mobile),
          booking_rooms!booking_rooms_booking_id_fkey(rooms!booking_rooms_room_id_fkey(room_number))
        `)
        .eq("property_id", propertyId)
        .eq("status", "cancelled")
        // Cancellation timestamp is the report date; very old rows without one
        // fall back to when the booking was created.
        .or(`and(cancelled_at.gte.${fromIso},cancelled_at.lt.${toIso}),and(cancelled_at.is.null,created_at.gte.${fromIso},created_at.lt.${toIso})`)
        .order("cancelled_at", { ascending: false })
        .range(f, t));

      const ids = bookings.map((b: any) => b.id);
      // Who cancelled: recorded in the activity trail, not on the booking row.
      const actorMap = new Map<string, string>();
      if (ids.length > 0) {
        const logs = await pagedIn<any>("activity log", ids, (chunk, f, t) => supabase
          .from("activity_log")
          .select("reference_id,user_name,action_type,created_at")
          .ilike("action_type", "%CANCEL%")
          .in("reference_id", chunk)
          .order("created_at", { ascending: false })
          .range(f, t));
        for (const l of logs) {
          if (actorMap.has(l.reference_id)) continue;
          const auto = String(l.action_type ?? "").includes("AUTO");
          actorMap.set(l.reference_id, auto ? "System (auto no-show)" : (l.user_name || "—"));
        }
      }
      // Refunds are recorded as negative payment amounts against the booking.
      const refundMap = new Map<string, number>();
      if (ids.length > 0) {
        const pays = await pagedIn<any>("payments", ids, (chunk, f, t) => supabase
          .from("payments").select("booking_id,amount").in("booking_id", chunk).range(f, t));
        for (const p of pays) {
          const amt = Number(p.amount ?? 0);
          if (amt >= 0) continue;
          refundMap.set(p.booking_id, (refundMap.get(p.booking_id) ?? 0) + Math.abs(amt));
        }
      }

      setRows(bookings.map((b: any) => {
        const advance = Number(b.advance_amount ?? 0);
        const refunded = refundMap.get(b.id) ?? 0;
        return {
          id: b.id,
          booking_number: b.booking_number ?? "",
          guest: b.guests?.name ?? "—",
          rooms: Array.from(new Set(
            (b.booking_rooms ?? []).map((br: any) => br.rooms?.room_number).filter(Boolean),
          )).join(", ") || "—",
          check_in: b.check_in,
          check_out: b.check_out,
          cancelled_at: b.cancelled_at ?? b.created_at ?? null,
          cancelled_by: actorMap.get(b.id) ?? "—",
          reason: b.cancelled_reason ?? "—",
          advance,
          refund: refunded > 0
            ? `Refunded ${fmtINR(refunded)}`
            : advance > 0 ? "Refund pending" : "—",
          total: Number(b.total_amount ?? 0),
        };
      }));
    } finally {
      setLoading(false);
    }
  }, [propertyId, from, to]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => ({
    count: derived.length,
    advance: derived.reduce((s, r) => s + r.advance, 0),
    value: derived.reduce((s, r) => s + r.total, 0),
  }), [derived]);

  const columns: ReportColumn<Row>[] = [
    { key: "booking_number", header: "Booking #", get: (r) => r.booking_number, type: "text" },
    { key: "guest", header: "Guest", get: (r) => r.guest, type: "text" },
    { key: "rooms", header: "Room(s)", get: (r) => r.rooms, type: "enum" },
    { key: "check_in", header: "Check-in", get: (r) => fmtDate(r.check_in), type: "date", sortValue: (r) => r.check_in, dateValue: (r) => r.check_in },
    { key: "check_out", header: "Check-out", get: (r) => fmtDate(r.check_out), type: "date", sortValue: (r) => r.check_out, dateValue: (r) => r.check_out },
    { key: "cancelled_at", header: "Cancelled On", get: (r) => r.cancelled_at ? fmtDateTime(r.cancelled_at) : "—", type: "date", sortValue: (r) => r.cancelled_at ?? "", dateValue: (r) => r.cancelled_at ?? "" },
    { key: "cancelled_by", header: "Cancelled By", get: (r) => r.cancelled_by, type: "enum" },
    { key: "reason", header: "Reason", get: (r) => r.reason, type: "text" },
    { key: "advance", header: "Advance", get: (r) => r.advance, currency: true, sortValue: (r) => r.advance },
    { key: "refund", header: "Refund Status", get: (r) => r.refund, type: "enum" },
    { key: "total", header: "Booking Value", get: (r) => r.total, currency: true, sortValue: (r) => r.total },
  ];

  const meta = {
    reportName: "Cancelled Bookings Report",
    propertyName: current?.name ?? "",
    from, to,
    totals: [
      ["Cancelled bookings", totals.count],
      ["Advance collected", fmtINR(totals.advance)],
      ["Cancelled booking value", fmtINR(totals.value)],
    ] as [string, string | number][],
  };
  const exportRows = () => (derived.length ? derived : rows);

  if (!propertyId) return <ReportShell title="Cancelled Bookings" filters={null} hideExports><EmptyPropertyState /></ReportShell>;

  return (
    <ReportShell
      title="Cancelled Bookings"
      description="Bookings cancelled in the selected period, with who cancelled them and the advance / refund position."
      onExcel={() => exportExcel(exportRows(), columns, meta)}
      onPdf={() => exportPdf(exportRows(), columns, meta)}
      disabled={loading || rows.length === 0}
      filters={
        <>
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        </>
      }
    >
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      <div className="grid sm:grid-cols-3 gap-3 mb-3 print:hidden">
        <Summary label="Cancelled bookings" value={String(totals.count)} />
        <Summary label="Advance collected" value={fmtINR(totals.advance)} />
        <Summary label="Cancelled value" value={fmtINR(totals.value)} />
      </div>
      <Card>
        <CardContent className="pt-4">
          <ReportDataTable
            rows={rows}
            columns={columns}
            onDerivedRowsChange={setDerived}
            rowKey={(r) => r.id}
            emptyText={loading ? "Loading…" : "No cancellations in range."}
          />
        </CardContent>
      </Card>
    </ReportShell>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
