import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { ReportShell } from "@/components/ReportShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR, firstOfMonthIso,
} from "@/lib/reportExports";

export const Route = createFileRoute("/_authenticated/reports/food-kot")({
  head: () => ({ meta: [{ title: "Food / KOT Report — HotelPilot" }] }),
  component: Page,
});

interface KotRow {
  _id: string; kot_no: string; date: string; room_no: string; guest: string;
  items_count: number; total: number; kitchen: string; status: string;
}
interface ItemRow {
  _id: string; item: string; category: string; kitchen: string;
  qty: number; rate: number; total: number;
}

function Page() {
  const { current } = useCurrentProperty();
  const propertyId = current?.id ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(firstOfMonthIso());
  const [to, setTo] = useState(today);
  const [kitchen, setKitchen] = useState("all");
  const [catId, setCatId] = useState("all");
  const [cats, setCats] = useState<Array<{ id: string; name: string }>>([]);
  const [kots, setKots] = useState<KotRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);

  useEffect(() => {
    if (!propertyId) return;
    supabase.from("menu_categories" as any).select("id,name").eq("property_id", propertyId)
      .then(({ data }) => setCats((data ?? []) as any));
  }, [propertyId]);

  const load = useCallback(async () => {
    if (!propertyId) return;
    const fromIso = `${from}T00:00:00`;
    const toIso = `${to}T23:59:59`;
    const { data: kotData } = await supabase.from("kot_orders").select(`
      id,kot_number,created_at,total_amount,status,
      rooms(room_number),bookings(guests(name)),
      kot_items(id,item_name,qty,rate,amount,menu_items(category_id,kitchen_type,menu_categories(name)))
    `).eq("property_id", propertyId).gte("created_at", fromIso).lte("created_at", toIso)
      .order("created_at", { ascending: false });
    const kr: KotRow[] = []; const ir: ItemRow[] = [];
    const itemAgg = new Map<string, ItemRow>();
    for (const k of (kotData ?? []) as any[]) {
      const kitchens = new Set<string>();
      for (const it of (k.kot_items ?? [])) {
        const kt = it.menu_items?.kitchen_type ?? "hotel";
        const cid = it.menu_items?.category_id ?? "";
        const cname = it.menu_items?.menu_categories?.name ?? "";
        kitchens.add(kt);
        if (kitchen !== "all" && kt !== kitchen) continue;
        if (catId !== "all" && cid !== catId) continue;
        const key = `${it.item_name}__${kt}`;
        const ex = itemAgg.get(key) ?? { _id: key, item: it.item_name, category: cname, kitchen: kt, qty: 0, rate: Number(it.rate || 0), total: 0 };
        ex.qty += Number(it.qty || 0);
        ex.total += Number(it.amount || 0);
        itemAgg.set(key, ex);
      }
      const kk = Array.from(kitchens).join(", ") || "—";
      if (kitchen !== "all" && !kitchens.has(kitchen)) continue;
      kr.push({
        _id: k.id, kot_no: k.kot_number, date: k.created_at,
        room_no: k.rooms?.room_number ?? "",
        guest: k.bookings?.guests?.name ?? k.guest_name ?? "",
        items_count: (k.kot_items ?? []).length,
        total: Number(k.total_amount || 0), kitchen: kk, status: k.status,
      });
    }
    for (const v of itemAgg.values()) ir.push(v);
    ir.sort((a, b) => b.total - a.total);
    setKots(kr); setItems(ir);
  }, [propertyId, from, to, kitchen, catId]);

  useEffect(() => { load(); }, [load]);

  const grandRev = useMemo(() => kots.reduce((s, r) => s + r.total, 0), [kots]);

  const kotCols: ReportColumn<KotRow>[] = [
    { key: "kot_no", header: "KOT No", get: (r) => r.kot_no },
    { key: "date", header: "Date", get: (r) => fmtDate(r.date) },
    { key: "room", header: "Room", get: (r) => r.room_no },
    { key: "guest", header: "Guest", get: (r) => r.guest },
    { key: "items", header: "Items", get: (r) => r.items_count },
    { key: "total", header: "Total Amount", get: (r) => r.total, currency: true },
    { key: "kitchen", header: "Kitchen", get: (r) => r.kitchen },
    { key: "status", header: "Status", get: (r) => r.status },
  ];
  const itemCols: ReportColumn<ItemRow>[] = [
    { key: "item", header: "Item Name", get: (r) => r.item },
    { key: "cat", header: "Category", get: (r) => r.category },
    { key: "kit", header: "Kitchen", get: (r) => r.kitchen },
    { key: "qty", header: "Qty Sold", get: (r) => r.qty, numeric: true },
    { key: "rate", header: "Rate", get: (r) => r.rate, currency: true },
    { key: "total", header: "Total Amount", get: (r) => r.total, currency: true },
  ];

  const [tab, setTab] = useState("summary");
  const meta = (name: string) => ({
    reportName: name, propertyName: current?.name ?? "Property", from, to,
    totals: [["Total KOTs", kots.length], ["Total Food Revenue", fmtINR(grandRev)]] as [string, string|number][],
  });

  return (
    <ReportShell title="Food / KOT Report"
      filters={<>
        <div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        <div><Label>Kitchen</Label>
          <Select value={kitchen} onValueChange={setKitchen}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="hotel">Hotel</SelectItem>
              <SelectItem value="restaurant">Restaurant</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>Category</Label>
          <Select value={catId} onValueChange={setCatId}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </>}
      onExcel={() => tab === "summary" ? exportExcel(kots, kotCols, meta("KOT Summary")) : exportExcel(items, itemCols, meta("Item-wise Sales"))}
      onPdf={() => tab === "summary" ? exportPdf(kots, kotCols, meta("KOT Summary")) : exportPdf(items, itemCols, meta("Item-wise Sales"))}
      disabled={(tab === "summary" ? kots : items).length === 0}
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="summary">KOT Summary</TabsTrigger><TabsTrigger value="items">Item-wise Sales</TabsTrigger></TabsList>
        <TabsContent value="summary">
          <Card><CardContent className="pt-4 overflow-x-auto">
            <SimpleTable rows={kots} columns={kotCols} totalsRow={["Totals", "", "", "", kots.length, fmtINR(grandRev), "", ""]} />
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="items">
          <Card><CardContent className="pt-4 overflow-x-auto">
            <SimpleTable rows={items} columns={itemCols} totalsRow={["Totals","","", items.reduce((s,r)=>s+r.qty,0), "", fmtINR(items.reduce((s,r)=>s+r.total,0))]} />
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </ReportShell>
  );
}

function SimpleTable<T>({ rows, columns, totalsRow }: { rows: T[]; columns: ReportColumn<T>[]; totalsRow: (string | number)[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="bg-muted/40"><tr>
        {columns.map((c) => <th key={c.key} className={`px-2 py-2 text-left ${c.currency || c.numeric ? "text-right" : ""}`}>{c.header}</th>)}
      </tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t">
            {columns.map((c) => (
              <td key={c.key} className={`px-2 py-1.5 ${c.currency || c.numeric ? "text-right tabular-nums" : ""}`}>
                {c.currency ? fmtINR(c.get(r) as number) : c.get(r)}
              </td>
            ))}
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={columns.length} className="text-center py-6 text-muted-foreground">No data.</td></tr>}
      </tbody>
      <tfoot className="bg-emerald-50 font-semibold">
        <tr>{totalsRow.map((v, i) => <td key={i} className={`px-2 py-2 ${columns[i]?.currency || columns[i]?.numeric ? "text-right tabular-nums" : ""}`}>{v}</td>)}</tr>
      </tfoot>
    </table>
  );
}