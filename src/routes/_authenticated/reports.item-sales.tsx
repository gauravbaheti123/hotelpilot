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
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import {
  ReportColumn, exportExcel, exportPdf, fmtINR, firstOfMonthIso,
} from "@/lib/reportExports";
import { istToday } from "@/lib/date";
import { guardQuery } from "@/lib/queryError";
import { pagedSelect } from "@/lib/reportPaging";

export const Route = createFileRoute("/_authenticated/reports/item-sales")({
  head: () => ({ meta: [{ title: "Item Sales Report — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><Page /></RequirePermission>),
});

interface ItemRow {
  _id: string; item: string; category: string; kitchen: string;
  qty: number; rate: number; total: number;
}

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const today = istToday();
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [kitchen, setKitchen] = useState("all");
  const [catId, setCatId] = useState("all");
  const [cats, setCats] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [derived, setDerived] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!propertyId) return;
    supabase.from("menu_categories" as any).select("id,name").eq("property_id", propertyId)
      .then(guardQuery("menu categories")).then(({ data }) => setCats((data ?? []) as any));
  }, [propertyId]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    setLoading(true);
    try {
      const bills = await pagedSelect<any>("food bills", (f, t) => supabase.from("segment_bills").select(`
        id,created_at,booking_id,segment,
        segment_bill_items(id,description,qty,rate,amount)
      `).eq("property_id", propertyId)
        .in("segment", ["food", "laundry"])
        .gte("created_at", `${from}T00:00:00`).lte("created_at", `${to}T23:59:59`)
        .range(f, t));
      // Banquet event-block bills stay out of the operational item report.
      const scope = await fetchBanquetScope(propertyId);
      const rows = bills.filter((b) => !isBanquetRecord(scope, { booking_id: b.booking_id }));
      // Bill items carry no menu_item_id, so kitchen/category are recovered by
      // matching the item description against the menu master.
      const menuRows = await pagedSelect<any>("menu items", (f, t) => supabase.from("menu_items")
        .select("name,kitchen_type,menu_categories(id,name)")
        .eq("property_id", propertyId).range(f, t));
      const menuMap = new Map<string, { kitchen: string; catId: string; catName: string }>();
      for (const m of menuRows) {
        menuMap.set(String(m.name ?? "").trim().toLowerCase(), {
          kitchen: m.kitchen_type ?? "hotel",
          catId: m.menu_categories?.id ?? "",
          catName: m.menu_categories?.name ?? "",
        });
      }
      const agg = new Map<string, ItemRow>();
      for (const b of rows) {
        for (const it of (b.segment_bill_items ?? [])) {
          const match = menuMap.get(String(it.description ?? "").trim().toLowerCase());
          const kt = match?.kitchen ?? "hotel";
          const cid = match?.catId ?? "";
          const cname = match?.catName ?? "—";
          if (kitchen !== "all" && kt !== kitchen) continue;
          if (catId !== "all" && cid !== catId) continue;
          const key = `${it.description}__${kt}`;
          const ex = agg.get(key) ?? {
            _id: key, item: it.description ?? "", category: cname, kitchen: kt,
            qty: 0, rate: Number(it.rate || 0), total: 0,
          };
          ex.qty += Number(it.qty || 0);
          ex.total += Number(it.amount || 0);
          agg.set(key, ex);
        }
      }
      const out = Array.from(agg.values()).sort((a, b2) => b2.total - a.total);
      setItems(out);
    } finally {
      setLoading(false);
    }
  }, [propertyId, from, to, kitchen, catId]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => ({
    items: derived.length,
    qty: derived.reduce((s, r) => s + r.qty, 0),
    revenue: derived.reduce((s, r) => s + r.total, 0),
  }), [derived]);

  const columns: ReportColumn<ItemRow>[] = [
    { key: "item", header: "Item Name", get: (r) => r.item, type: "text" },
    { key: "cat", header: "Category", get: (r) => r.category, type: "enum" },
    { key: "kit", header: "Kitchen", get: (r) => r.kitchen === "restaurant" ? "Restaurant" : "Hotel", type: "enum" },
    { key: "qty", header: "Qty Sold", get: (r) => r.qty, numeric: true, sortValue: (r) => r.qty },
    { key: "rate", header: "Rate", get: (r) => r.rate, currency: true, sortValue: (r) => r.rate },
    { key: "total", header: "Total Revenue", get: (r) => r.total, currency: true, sortValue: (r) => r.total },
  ];

  const meta = {
    reportName: "Item Sales Report",
    propertyName: current?.name ?? "",
    from, to,
    totals: [
      ["Items sold", totals.items],
      ["Total quantity", totals.qty],
      ["Total revenue", fmtINR(totals.revenue)],
    ] as [string, string | number][],
  };
  const exportRows = () => (derived.length ? derived : items);

  if (!propertyId) return <ReportShell title="Item Sales" filters={null} hideExports><EmptyPropertyState /></ReportShell>;

  return (
    <ReportShell
      title="Item Sales"
      description="Item-wise quantity sold and revenue across food and laundry bills."
      onExcel={() => exportExcel(exportRows(), columns, meta)}
      onPdf={() => exportPdf(exportRows(), columns, meta)}
      disabled={loading || items.length === 0}
      filters={
        <>
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
          <div><Label className="text-xs">Kitchen</Label>
            <Select value={kitchen} onValueChange={setKitchen}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="hotel">Hotel</SelectItem>
                <SelectItem value="restaurant">Restaurant</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Category</Label>
            <Select value={catId} onValueChange={setCatId}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </>
      }
    >
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      <div className="grid sm:grid-cols-3 gap-3 mb-3 print:hidden">
        <Summary label="Items sold" value={String(totals.items)} />
        <Summary label="Total quantity" value={String(totals.qty)} />
        <Summary label="Total revenue" value={fmtINR(totals.revenue)} />
      </div>
      <Card>
        <CardContent className="pt-4">
          <ReportDataTable
            rows={items}
            columns={columns}
            onDerivedRowsChange={setDerived}
            rowKey={(r) => r._id}
            emptyText={loading ? "Loading…" : "No item sales in range."}
            totalsRow={(d) => (
              <tr>
                <td colSpan={3} className="px-2 py-2 text-right">Totals</td>
                <td className="px-2 py-2 text-right tabular-nums">{d.reduce((s, r) => s + r.qty, 0)}</td>
                <td />
                <td className="px-2 py-2 text-right tabular-nums">{fmtINR(d.reduce((s, r) => s + r.total, 0))}</td>
              </tr>
            )}
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
