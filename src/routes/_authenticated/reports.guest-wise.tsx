import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchBanquetScope, isBanquetRecord } from "@/lib/banquetScope";
import { useCurrentProperty } from "@/hooks/use-property";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR, firstOfMonthIso } from "@/lib/reportExports";
import { ChevronRight, ChevronDown } from "lucide-react";

import { RequirePermission } from "@/components/RequirePermission";
import { ReportDataTable } from "@/components/ReportDataTable";
import { Fragment } from "react";
export const Route = createFileRoute("/_authenticated/reports/guest-wise")({
  head: () => ({ meta: [{ title: "Guest-Wise Report — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><Page /></RequirePermission>),
});

interface BookingLite {
  id: string; booking_number: string; check_in: string; check_out: string;
  total: number; balance: number; status: string;
  checked_in_by_name: string; checked_out_by_name: string;
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
  const [derived, setDerived] = useState<GuestRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!propertyId) return;
    const { data } = await supabase.from("bookings").select(`
      id,booking_number,check_in,check_out,total_amount,balance_amount,status,guest_id,source,
      checked_in_by,checked_out_by,
      guests(name,mobile)
    `).eq("property_id", propertyId)
      .gte("check_in", from).lte("check_in", to);

    // Banquet event-block stays remain visible for 48h after the event ends.
    const scope = await fetchBanquetScope(propertyId);
    const raw = ((data ?? []) as any[]).filter(
      (b) => !isBanquetRecord(scope, { booking_id: b.id }),
    );
    const uids = new Set<string>();
    for (const b of raw) {
      if (b.checked_in_by) uids.add(b.checked_in_by);
      if (b.checked_out_by) uids.add(b.checked_out_by);
    }
    const nameMap = new Map<string, string>();
    if (uids.size) {
      const { data: profs } = await supabase.from("profiles")
        .select("id,name,email").in("id", Array.from(uids));
      for (const p of (profs ?? []) as any[]) nameMap.set(p.id, p.name || p.email || "");
    }

    const m = new Map<string, GuestRow>();
    for (const b of raw) {
      const gid = b.guest_id; if (!gid) continue;
      const inD = new Date(b.check_in), outD = new Date(b.check_out);
      const nights = Math.max(1, Math.round((+outD - +inD) / 86400000));
      const ex: GuestRow = m.get(gid) ?? {
        _id: gid, name: b.guests?.name ?? "—", mobile: b.guests?.mobile ?? "",
        visits: 0, nights: 0, spending: 0, last_visit: b.check_in, outstanding: 0,
        bookings: [] as BookingLite[],
      };
      ex.visits += 1; ex.nights += nights;
      ex.spending += Number(b.total_amount || 0);
      ex.outstanding += Number(b.balance_amount || 0);
      if (new Date(b.check_in) > new Date(ex.last_visit)) ex.last_visit = b.check_in;
      ex.bookings.push({
        id: b.id, booking_number: b.booking_number, check_in: b.check_in, check_out: b.check_out,
        total: Number(b.total_amount || 0), balance: Number(b.balance_amount || 0), status: b.status,
        checked_in_by_name: b.checked_in_by ? (nameMap.get(b.checked_in_by) ?? "—") : "—",
        checked_out_by_name: b.checked_out_by ? (nameMap.get(b.checked_out_by) ?? "—") : "—",
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

  const grandDerived = useMemo(() => derived.reduce((s, r) => ({
    spending: s.spending + r.spending, outstanding: s.outstanding + r.outstanding,
  }), { spending: 0, outstanding: 0 }), [derived]);

  const columns: ReportColumn<GuestRow>[] = [
    { key: "name", header: "Guest Name", get: (r) => r.name, type: "text" },
    { key: "mobile", header: "Mobile", get: (r) => r.mobile, type: "text" },
    { key: "visits", header: "Total Visits", get: (r) => r.visits, numeric: true, sortValue: (r) => r.visits },
    { key: "nights", header: "Total Nights", get: (r) => r.nights, numeric: true, sortValue: (r) => r.nights },
    { key: "spending", header: "Total Spending", get: (r) => r.spending, currency: true, sortValue: (r) => r.spending },
    { key: "last", header: "Last Visit", get: (r) => fmtDate(r.last_visit), type: "date", sortValue: (r) => r.last_visit, dateValue: (r) => r.last_visit },
    { key: "out", header: "Outstanding", get: (r) => r.outstanding, currency: true, sortValue: (r) => r.outstanding },
  ];

  const meta = { reportName: "Guest-Wise Report", propertyName: current?.name ?? "Property", from, to,
    totals: [
      ["Total guests", derived.length],
      ["Total spending", fmtINR(grandDerived.spending)],
      ["Total outstanding", fmtINR(grandDerived.outstanding)],
    ] as [string, string|number][] };

  return (
    <ReportShell title="Guest-Wise Report"
      filters={<>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <div><Label>Search</Label><Input placeholder="Name or mobile" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" /></div>
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
          emptyText="No guests in range."
          renderRow={(r) => {
            const open = !!expanded[r._id];
            return (
              <Fragment key={r._id}>
                <tr className="border-t cursor-pointer hover:bg-muted/30"
                  onClick={() => setExpanded((s) => ({ ...s, [r._id]: !open }))}>
                  {columns.map((c, ci) => (
                    <td key={c.key} className={`px-2 py-1.5 ${c.currency || c.numeric ? "text-right tabular-nums" : ""}`}>
                      {ci === 0 && (open ? <ChevronDown className="h-3 w-3 inline mr-1" /> : <ChevronRight className="h-3 w-3 inline mr-1" />)}
                      {c.currency ? fmtINR(c.get(r) as number) : c.get(r)}
                    </td>
                  ))}
                </tr>
                {open && (
                  <tr className="bg-muted/10">
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
                          <th className="text-left py-1">Checked-in By</th>
                          <th className="text-left py-1">Checked-out By</th>
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
                              <td>{b.checked_in_by_name}</td>
                              <td>{b.checked_out_by_name}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          }}
          totalsRow={(d) => (
            <tr>
              <td colSpan={4} className="px-2 py-2 text-right">{d.length} guests</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(d.reduce((s, r) => s + r.spending, 0))}</td>
              <td />
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(d.reduce((s, r) => s + r.outstanding, 0))}</td>
            </tr>
          )}
        />
      </CardContent></Card>
    </ReportShell>
  );
}