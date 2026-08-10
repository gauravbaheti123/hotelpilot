import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequirePermission } from "@/components/RequirePermission";
import { ReportDataTable } from "@/components/ReportDataTable";
import { ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR } from "@/lib/reportExports";
import { reportQueryError } from "@/lib/queryError";
import { billNo } from "@/lib/billNumber";
import { istToday } from "@/lib/date";

export const Route = createFileRoute("/_authenticated/reports/dues")({
  head: () => ({
    meta: [
      { title: "Dues / Pending Payments — HotelPilot" },
      { name: "description", content: "Outstanding guest bills with real payments received and balance still due." },
      { property: "og:title", content: "Dues / Pending Payments — HotelPilot" },
      { property: "og:description", content: "Outstanding guest bills with real payments received and balance still due." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (<RequirePermission module="reports"><Page /></RequirePermission>),
});

interface Row {
  _id: string;
  booking_id: string | null;
  guest_name: string;
  invoice_number: string;
  bill_date: string;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  days_outstanding: number;
}

function daysBetween(iso: string): number {
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00Z").getTime();
  const today = new Date(istToday() + "T00:00:00Z").getTime();
  if (!Number.isFinite(d)) return 0;
  return Math.max(0, Math.round((today - d) / 86400000));
}

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [derived, setDerived] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("folios")
      .select("id,booking_id,invoice_number,status,total_amount,paid_amount,balance_amount,settled_at,created_at,is_deleted,bookings(guests(name))")
      .eq("property_id", propertyId)
      .eq("status", "due")
      .order("settled_at", { ascending: true });
    if (error) reportQueryError("due folios", error);
    const out: Row[] = ((data ?? []) as any[])
      .filter((f) => !f.is_deleted)
      .map((f) => {
        const billDate = String(f.settled_at ?? f.created_at ?? "").slice(0, 10);
        return {
          _id: f.id,
          booking_id: f.booking_id ?? null,
          guest_name: f.bookings?.guests?.name ?? "—",
          invoice_number: billNo(f.invoice_number),
          bill_date: billDate,
          total_amount: Number(f.total_amount ?? 0),
          paid_amount: Number(f.paid_amount ?? 0),
          balance_amount: Number(f.balance_amount ?? 0),
          days_outstanding: daysBetween(billDate),
        };
      })
      .sort((a, b) => b.days_outstanding - a.days_outstanding);
    setRows(out);
    setLoading(false);
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.guest_name.toLowerCase().includes(q) || r.invoice_number.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const columns: ReportColumn<Row>[] = useMemo(() => [
    { key: "guest_name", header: "Guest", get: (r) => r.guest_name, type: "text" },
    { key: "invoice_number", header: "Invoice No", get: (r) => r.invoice_number, type: "text" },
    { key: "bill_date", header: "Bill Date", get: (r) => fmtDate(r.bill_date), type: "date", sortValue: (r) => r.bill_date, dateValue: (r) => r.bill_date },
    { key: "total_amount", header: "Total", get: (r) => r.total_amount, currency: true, sortValue: (r) => r.total_amount },
    { key: "paid_amount", header: "Paid (real)", get: (r) => r.paid_amount, currency: true, sortValue: (r) => r.paid_amount },
    { key: "balance_amount", header: "Balance Due", get: (r) => r.balance_amount, currency: true, sortValue: (r) => r.balance_amount },
    { key: "days_outstanding", header: "Days Outstanding", get: (r) => r.days_outstanding, sortValue: (r) => r.days_outstanding },
  ], []);

  const totalDue = useMemo(() => derived.reduce((s, r) => s + r.balance_amount, 0), [derived]);
  const meta = {
    reportName: "Dues / Pending Payments",
    propertyName: current?.name ?? "Property",
    from: "",
    to: istToday(),
    totals: [["Open bills", derived.length], ["Total outstanding", fmtINR(totalDue)]] as [string, string | number][],
  };

  return (
    <ReportShell
      title="Dues / Pending Payments"
      description="Every checked-out bill still carrying a balance. 'Paid (real)' excludes any Bill On Hold marker — only money actually collected counts."
      filters={
        <div>
          <Label>Search</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Guest or invoice no"
            className="w-56"
          />
        </div>
      }
      onExcel={() => exportExcel(derived, columns, meta)}
      onPdf={() => exportPdf(derived, columns, meta)}
      disabled={loading || filtered.length === 0}
    >
      <Card>
        <CardContent className="pt-4">
          <ReportDataTable
            rows={filtered}
            columns={columns}
            onDerivedRowsChange={setDerived}
            rowKey={(r) => r._id}
            emptyText={loading ? "Loading…" : "No pending dues"}
            renderRow={(r) => (
              <tr key={r._id} className="border-t hover:bg-muted/30">
                <td className="px-2 py-1.5">
                  {r.booking_id ? (
                    <Link
                      to="/billing/folio/$bookingId"
                      params={{ bookingId: r.booking_id }}
                      className="text-primary hover:underline"
                    >
                      {r.guest_name}
                    </Link>
                  ) : r.guest_name}
                </td>
                <td className="px-2 py-1.5">{r.invoice_number}</td>
                <td className="px-2 py-1.5">{fmtDate(r.bill_date)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtINR(r.total_amount)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmtINR(r.paid_amount)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-destructive">{fmtINR(r.balance_amount)}</td>
                <td className="px-2 py-1.5">
                  <Badge variant={r.days_outstanding > 30 ? "destructive" : "outline"}>
                    {r.days_outstanding} d
                  </Badge>
                </td>
              </tr>
            )}
            totalsRow={(d) => (
              <tr>
                <td colSpan={5} className="px-2 py-2 text-right">Total outstanding ({d.length} bills)</td>
                <td className="px-2 py-2 text-right tabular-nums font-semibold">
                  {fmtINR(d.reduce((s, r) => s + r.balance_amount, 0))}
                </td>
                <td />
              </tr>
            )}
          />
        </CardContent>
      </Card>
    </ReportShell>
  );
}