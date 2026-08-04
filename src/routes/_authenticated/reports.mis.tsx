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
import { RequirePermission } from "@/components/RequirePermission";
import { ReportDataTable } from "@/components/ReportDataTable";
import {
  ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR, firstOfMonthIso,
} from "@/lib/reportExports";
import { istToday } from "@/lib/date";

export const Route = createFileRoute("/_authenticated/reports/mis")({
  head: () => ({ meta: [{ title: "MIS Report — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><Page /></RequirePermission>),
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
  const today = istToday();
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [staffFilter, setStaffFilter] = useState("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [derived, setDerived] = useState<Row[]>([]);
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

  const columns: ReportColumn<Row>[] = [
    { key: "date", header: "Date", get: (r) => fmtDate(r.date), type: "date", sortValue: (r) => r.date, dateValue: (r) => r.date },
    { key: "bill", header: "Original Bill No", get: (r) => r.orig_bill, type: "text" },
    { key: "room", header: "Room No", get: (r) => r.room_no, type: "text" },
    { key: "guest", header: "Guest Name", get: (r) => r.guest, type: "text" },
    { key: "amount", header: "Amount Shifted", get: (r) => r.amount, currency: true, sortValue: (r) => r.amount },
    { key: "by", header: "Shifted By", get: (r) => r.shifted_by, type: "enum" },
  ];

  const grandDerived = useMemo(() => derived.reduce((s, r) => s + r.amount, 0), [derived]);
  const meta = { reportName: "MIS Report", propertyName: current?.name ?? "Property", from, to,
    totals: [["Total currently in MIS", fmtINR(grandDerived)]] as [string, string|number][] };

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
          emptyText="No MIS entries in range."
          totalsRow={(d) => (
            <tr>
              <td colSpan={4} className="px-2 py-2 text-right">Total currently in MIS</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(d.reduce((s, r) => s + r.amount, 0))}</td>
              <td />
            </tr>
          )}
        />
      </CardContent></Card>
    </ReportShell>
  );
}