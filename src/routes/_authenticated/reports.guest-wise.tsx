import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR, firstOfMonthIso } from "@/lib/reportExports";
import { ChevronRight, ChevronDown } from "lucide-react";

export const Route = createFileRoute("/_authenticated/reports/guest-wise")({
  head: () => ({ meta: [{ title: "Guest-Wise Report — HotelPilot" }] }),
  component: Page,
});

interface BookingLite {
  id: string; booking_number: string; check_in: string; check_out: string;
  total: number; balance: number; status: string;
}
interface GuestRow {
  _id: string; name: string; mobile: string;
  visits: number; nights: number; spending: number;
  last_visit: string; outstanding: number;
  bookings: BookingLite[];
}

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<GuestRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!propertyId) return;
    const { data } = await supabase.from("bookings").select(`
      id,booking_number,check_in,check_out,total_amount,balance_amount,status,guest_id,
      guests(name,mobile)
    `).eq("property_id", propertyId)
      .gte("check_in", from).lte("check_in", to);

    const m = new Map<string, GuestRow>();
    for (const b of (data ?? []) as any[]) {
      const gid = b.guest_id; if (!gid) continue;
      const inD = new Date(b.check_in), outD = new Date(b.check_out);
      const nights = Math.max(1, Math.round((+outD - +inD) / 86400000));
      const ex = m.get(gid) ?? {
        _id: gid, name: b.guests?.name ?? "—", mobile: b.guests?.mobile ?? "",
        visits: 0, nights: 0, spending: 0, last_visit: b.check_in, outstanding: 0, bookings: [],
      };
      ex.visits += 1; ex.nights += nights;
      ex.spending += Number(b.total_amount || 0);
      ex.outstanding += Number(b.balance_amount || 0);
      if (new Date(b.check_in) > new Date(ex.last_visit)) ex.last_visit = b.check_in;
      ex.bookings.push({
        id: b.id, booking_number: b.booking_number, check_in: b.check_in, check_out: b.check_out,
        total: Number(b.total_amount || 0), balance: Number(b.balance_amount || 0), status: b.status,
      });
      m.set(gid, ex);
    }
    let out = Array.from(m.values()).sort((a, b) => b.spending - a.spending);
    if (search) {
      const q = search.toLowerCase();
      out = out.filter((g) => g.name.toLowerCase().includes(q) || g.mobile.includes(q));
    }
    setRows(out);
  }, [propertyId, from, to, search]);

  useEffect(() => { load(); }, [load]);

  const grand = useMemo(() => rows.reduce((s, r) => ({
    spending: s.spending + r.spending, outstanding: s.outstanding + r.outstanding,
  }), { spending: 0, outstanding: 0 }), [rows]);

  const columns: ReportColumn<GuestRow>[] = [
    { key: "name", header: "Guest Name", get: (r) => r.name },
    { key: "mobile", header: "Mobile", get: (r) => r.mobile },
    { key: "visits", header: "Total Visits", get: (r) => r.visits, numeric: true },
    { key: "nights", header: "Total Nights", get: (r) => r.nights, numeric: true },
    { key: "spending", header: "Total Spending", get: (r) => r.spending, currency: true },
    { key: "last", header: "Last Visit", get: (r) => fmtDate(r.last_visit) },
    { key: "out", header: "Outstanding", get: (r) => r.outstanding, currency: true },
  ];

  const meta = { reportName: "Guest-Wise Report", propertyName: current?.name ?? "Property", from, to,
    totals: [
      ["Total guests", rows.length],
      ["Total spending", fmtINR(grand.spending)],
      ["Total outstanding", fmtINR(grand.outstanding)],
    ] as [string, string|number][] };

  return (
    <ReportShell title="Guest-Wise Report"
      filters={<>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <div><Label>Search</Label><Input placeholder="Name or mobile" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" /></div>
      </>}
      onExcel={() => exportExcel(rows, columns, meta)}
      onPdf={() => exportPdf(rows, columns, meta)}
      disabled={rows.length === 0}
    >
      <Card><CardContent className="pt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40"><tr>
            <th className="w-8" />
            {columns.map((c) => <th key={c.key} className={`px-2 py-2 text-left ${c.currency || c.numeric ? "text-right" : ""}`}>{c.header}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const open = !!expanded[r._id];
              return (
                <>
                  <tr key={r._id} className="border-t cursor-pointer hover:bg-muted/30"
                    onClick={() => setExpanded((s) => ({ ...s, [r._id]: !open }))}>
                    <td className="px-2 py-1.5">{open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}</td>
                    {columns.map((c) => (
                      <td key={c.key} className={`px-2 py-1.5 ${c.currency || c.numeric ? "text-right tabular-nums" : ""}`}>
                        {c.currency ? fmtINR(c.get(r) as number) : c.get(r)}
                      </td>
                    ))}
                  </tr>
                  {open && (
                    <tr key={`${r._id}-d`} className="bg-muted/10">
                      <td />
                      <td colSpan={columns.length} className="px-3 py-2">
                        <div className="text-xs font-semibold mb-1">All bookings ({r.bookings.length})</div>
                        <table className="w-full text-xs">
                          <thead className="text-muted-foreground"><tr>
                            <th className="text-left py-1">Booking #</th>
                            <th className="text-left py-1">Check-in</th>
                            <th className="text-left py-1">Checkout</th>
                            <th className="text-right py-1">Total</th>
                            <th className="text-right py-1">Balance</th>
                            <th className="text-left py-1">Status</th>
                          </tr></thead>
                          <tbody>
                            {r.bookings.map((b) => (
                              <tr key={b.id}>
                                <td>{b.booking_number}</td>
                                <td>{fmtDate(b.check_in)}</td>
                                <td>{fmtDate(b.check_out)}</td>
                                <td className="text-right tabular-nums">{fmtINR(b.total)}</td>
                                <td className="text-right tabular-nums">{fmtINR(b.balance)}</td>
                                <td>{b.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={columns.length + 1} className="text-center py-6 text-muted-foreground">No guests in range.</td></tr>}
          </tbody>
          <tfoot className="bg-emerald-50 font-semibold">
            <tr>
              <td colSpan={5} className="px-2 py-2 text-right">{rows.length} guests</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand.spending)}</td>
              <td />
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand.outstanding)}</td>
            </tr>
          </tfoot>
        </table>
      </CardContent></Card>
    </ReportShell>
  );
}