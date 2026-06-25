import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { useAuth } from "@/hooks/use-auth";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR, firstOfMonthIso,
} from "@/lib/reportExports";

export const Route = createFileRoute("/_authenticated/reports/mis")({
  head: () => ({ meta: [{ title: "MIS Report — HotelPilot" }] }),
  component: Page,
});

interface Row {
  _id: string; date: string; orig_bill: string; room_no: string;
  guest: string; amount: number; shifted_by: string;
}

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const { roles } = useAuth();
  const isOwner = roles.includes("owner") || roles.includes("superadmin");
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [staffFilter, setStaffFilter] = useState("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [staffList, setStaffList] = useState<Array<{ id: string; name: string }>>([]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    let q = supabase.from("mis_ledger").select(`
      id,shifted_at,source_bill_number,source_room_number,source_guest_name,amount,shifted_by,shifted_by_name
    `).eq("property_id", propertyId).eq("is_deleted", false)
      .gte("shifted_at", `${from}T00:00:00`).lte("shifted_at", `${to}T23:59:59`)
      .order("shifted_at", { ascending: false });
    if (staffFilter !== "all") q = q.eq("shifted_by", staffFilter);
    const { data } = await q;
    const seen = new Map<string, string>();
    const out: Row[] = ((data ?? []) as any[]).map((r) => {
      if (r.shifted_by && !seen.has(r.shifted_by)) seen.set(r.shifted_by, r.shifted_by_name ?? "");
      return {
        _id: r.id, date: r.shifted_at,
        orig_bill: r.source_bill_number ?? "—",
        room_no: r.source_room_number ?? "",
        guest: r.source_guest_name ?? "",
        amount: Number(r.amount || 0),
        shifted_by: r.shifted_by_name ?? "",
      };
    });
    setRows(out);
    setStaffList(Array.from(seen.entries()).map(([id, name]) => ({ id, name })));
  }, [propertyId, from, to, staffFilter]);

  useEffect(() => { load(); }, [load]);

  const grand = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);

  const columns: ReportColumn<Row>[] = [
    { key: "date", header: "Date", get: (r) => fmtDate(r.date) },
    { key: "bill", header: "Original Bill No", get: (r) => r.orig_bill },
    { key: "room", header: "Room No", get: (r) => r.room_no },
    { key: "guest", header: "Guest Name", get: (r) => r.guest },
    { key: "amount", header: "Amount Shifted", get: (r) => r.amount, currency: true },
    { key: "by", header: "Shifted By", get: (r) => r.shifted_by },
  ];

  const meta = { reportName: "MIS Report", propertyName: current?.name ?? "Property", from, to,
    totals: [["Total currently in MIS", fmtINR(grand)]] as [string, string|number][] };

  if (!isOwner) return <Navigate to="/dashboard" />;

  return (
    <ReportShell title="MIS Report"
      description="Only amounts and references are shown here. Full item details available in MIS Account Ledger."
      filters={<>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <div><Label>Staff</Label>
          <Select value={staffFilter} onValueChange={setStaffFilter}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {staffList.map((s) => <SelectItem key={s.id} value={s.id}>{s.name || s.id.slice(0,8)}</SelectItem>)}
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
          <tbody>
            {rows.map((r) => (
              <tr key={r._id} className="border-t">
                {columns.map((c) => (
                  <td key={c.key} className={`px-2 py-1.5 ${c.currency ? "text-right tabular-nums" : ""}`}>
                    {c.currency ? fmtINR(c.get(r) as number) : c.get(r)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={columns.length} className="text-center py-6 text-muted-foreground">No MIS entries in range.</td></tr>}
          </tbody>
          <tfoot className="bg-emerald-50 font-semibold">
            <tr>
              <td colSpan={4} className="px-2 py-2 text-right">Total currently in MIS</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </CardContent></Card>
    </ReportShell>
  );
}