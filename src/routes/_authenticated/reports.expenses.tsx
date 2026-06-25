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
  buildTallyPaymentXml, downloadXml, buildFileName,
} from "@/lib/reportExports";

export const Route = createFileRoute("/_authenticated/reports/expenses")({
  head: () => ({ meta: [{ title: "Expense Report — HotelPilot" }] }),
  component: Page,
});

interface Row {
  _id: string; date: string; category: string; description: string;
  vendor: string; amount: number; mode: string; approved_by: string;
}

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [catId, setCatId] = useState("all");
  const [mode, setMode] = useState("all");
  const [cats, setCats] = useState<Array<{ id: string; name: string }>>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!propertyId) return;
    supabase.from("expense_categories").select("id,name").eq("property_id", propertyId).then(({ data }) => setCats((data ?? []) as any));
    supabase.from("profiles").select("user_id,full_name,email").limit(200).then(({ data }) => {
      const m = new Map<string, string>();
      for (const p of (data ?? []) as any[]) m.set(p.user_id, p.full_name ?? p.email ?? "");
      setProfiles(m);
    });
  }, [propertyId]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    let q = supabase.from("expenses").select(`
      id,expense_date,amount,payment_mode,reference,description,created_by,category_id,vendor_id,
      expense_categories(name),vendors(name)
    `).eq("property_id", propertyId)
      .gte("expense_date", from).lte("expense_date", to)
      .order("expense_date", { ascending: false });
    if (catId !== "all") q = q.eq("category_id", catId);
    if (mode !== "all") q = q.eq("payment_mode", mode);
    const { data } = await q;
    const out: Row[] = ((data ?? []) as any[]).map((e) => ({
      _id: e.id, date: e.expense_date,
      category: e.expense_categories?.name ?? "Uncategorized",
      description: e.description ?? "", vendor: e.vendors?.name ?? "",
      amount: Number(e.amount || 0), mode: e.payment_mode ?? "",
      approved_by: profiles.get(e.created_by) ?? "",
    }));
    setRows(out);
  }, [propertyId, from, to, catId, mode, profiles]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const a = m.get(r.category) ?? []; a.push(r); m.set(r.category, a);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);
  const grand = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows]);

  const columns: ReportColumn<Row>[] = [
    { key: "date", header: "Date", get: (r) => fmtDate(r.date) },
    { key: "cat", header: "Category", get: (r) => r.category },
    { key: "desc", header: "Description", get: (r) => r.description },
    { key: "vendor", header: "Vendor", get: (r) => r.vendor },
    { key: "amount", header: "Amount", get: (r) => r.amount, currency: true },
    { key: "mode", header: "Payment Mode", get: (r) => r.mode },
    { key: "approved", header: "Approved By", get: (r) => r.approved_by },
  ];

  const meta = {
    reportName: "Expense Report", propertyName: current?.name ?? "Property", from, to,
    totals: [
      ...grouped.map(([cat, items]) => [cat, fmtINR(items.reduce((s, r) => s + r.amount, 0))] as [string, string]),
      ["Grand Total", fmtINR(grand)] as [string, string],
    ],
  };

  function tallyXml() {
    const xml = buildTallyPaymentXml(rows.map((r, i) => ({
      date: r.date, voucher_number: `EXP-${(i + 1).toString().padStart(5, "0")}`,
      category: r.category, amount: r.amount,
    })));
    downloadXml(xml, buildFileName({ ...meta, reportName: "Expenses_Tally" }, "xml"));
  }

  return (
    <ReportShell title="Expense Report"
      filters={<>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <div><Label>Category</Label>
          <Select value={catId} onValueChange={setCatId}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label>Mode</Label>
          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="card">Card</SelectItem>
              <SelectItem value="upi">UPI</SelectItem>
              <SelectItem value="bank">Bank</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </>}
      onExcel={() => exportExcel(rows, columns, meta)}
      onPdf={() => exportPdf(rows, columns, meta)}
      onTally={tallyXml}
      tallyLabel="Export for Tally"
      disabled={rows.length === 0}
    >
      <Card><CardContent className="pt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/40"><tr>
            {columns.map((c) => <th key={c.key} className={`px-2 py-2 text-left ${c.currency ? "text-right" : ""}`}>{c.header}</th>)}
          </tr></thead>
          {grouped.map(([cat, items]) => {
            const sub = items.reduce((s, r) => s + r.amount, 0);
            return (
              <tbody key={cat}>
                <tr className="bg-muted/20 font-semibold">
                  <td colSpan={columns.length} className="px-2 py-1.5">{cat}</td>
                </tr>
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
                  <td colSpan={4} className="px-2 py-1.5 text-right">{cat} Subtotal</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtINR(sub)}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            );
          })}
          <tfoot className="bg-emerald-100 font-bold">
            <tr>
              <td colSpan={4} className="px-2 py-2 text-right">Grand Total</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtINR(grand)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
        {rows.length === 0 && <p className="text-center py-6 text-muted-foreground text-sm">No expenses in range.</p>}
      </CardContent></Card>
    </ReportShell>
  );
}