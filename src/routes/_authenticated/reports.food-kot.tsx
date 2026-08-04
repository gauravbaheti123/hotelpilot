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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RequirePermission } from "@/components/RequirePermission";
import { ReportDataTable } from "@/components/ReportDataTable";
import {
  ReportColumn, exportExcel, exportPdf, fmtDate, fmtINR, firstOfMonthIso,
} from "@/lib/reportExports";
import { istToday } from "@/lib/date";

export const Route = createFileRoute("/_authenticated/reports/food-kot")({
  head: () => ({ meta: [{ title: "Food / KOT Report — HotelPilot" }] }),
  component: () => (<RequirePermission module="reports"><Page /></RequirePermission>),
});

interface KotRow {
  _id: string; kot_no: string; date: string; room_no: string; guest: string;
  items_count: number; total: number; kitchen: string; status: string; food_bill: string;
}
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
  const [kots, setKots] = useState<KotRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [derivedKots, setDerivedKots] = useState<KotRow[]>([]);
  const [derivedItems, setDerivedItems] = useState<ItemRow[]>([]);

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
      id,kot_number,created_at,total_amount,status,booking_id,
      rooms(room_number),bookings(guests(name)),
      kot_items(id,item_name,qty,rate,amount,menu_items(category_id,kitchen_type,menu_categories(name)))
    `).eq("property_id", propertyId).gte("created_at", fromIso).lte("created_at", toIso)
      .order("created_at", { ascending: false });
    // KOTs raised against banquet event-block rooms are excluded from the
    // operational food report (Owner-only Banquet Billing report shows them).
    const scope = await fetchBanquetScope(propertyId);
    const kotRows = ((kotData ?? []) as any[]).filter((k) => !isBanquetRecord(scope, { booking_id: k.booking_id }));
    // Fetch food bill numbers for the bookings involved in this window.
    const bookingIds = Array.from(new Set(kotRows.map((k) => k.booking_id).filter(Boolean)));
    const fbMap = new Map<string, string>();
    if (bookingIds.length > 0) {
      const { data: fbs } = await supabase
        .from("food_bills" as any)
        .select("booking_id,food_bill_number")
        .in("booking_id", bookingIds);
      for (const row of (fbs ?? []) as any[]) fbMap.set(row.booking_id, row.food_bill_number);
    }
    const kr: KotRow[] = []; const ir: ItemRow[] = [];
    const itemAgg = new Map<string, ItemRow>();
    for (const k of kotRows) {
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
        food_bill: k.booking_id ? (fbMap.get(k.booking_id) ?? "") : "",
      });
    }
    for (const v of itemAgg.values()) ir.push(v);
    ir.sort((a, b) => b.total - a.total);
    setKots(kr); setItems(ir);
  }, [propertyId, from, to, kitchen, catId]);

  useEffect(() => { load(); }, [load]);

  const kotCols: ReportColumn<KotRow>[] = [
    { key: "kot_no", header: "KOT No", get: (r) => r.kot_no, type: "text" },
    { key: "food_bill", header: "Food Bill", get: (r) => r.food_bill, type: "text" },
    { key: "date", header: "Date", get: (r) => fmtDate(r.date), type: "date", sortValue: (r) => r.date, dateValue: (r) => r.date },
    { key: "room", header: "Room", get: (r) => r.room_no, type: "text" },
    { key: "guest", header: "Guest", get: (r) => r.guest, type: "text" },
    { key: "items", header: "Items", get: (r) => r.items_count, numeric: true, sortValue: (r) => r.items_count },
    { key: "total", header: "Total Amount", get: (r) => r.total, currency: true, sortValue: (r) => r.total },
    { key: "kitchen", header: "Kitchen", get: (r) => r.kitchen, type: "enum" },
    { key: "status", header: "Status", get: (r) => r.status, type: "enum" },
  ];
  const itemCols: ReportColumn<ItemRow>[] = [
    { key: "item", header: "Item Name", get: (r) => r.item, type: "text" },
    { key: "cat", header: "Category", get: (r) => r.category, type: "enum" },
    { key: "kit", header: "Kitchen", get: (r) => r.kitchen, type: "enum" },
    { key: "qty", header: "Qty Sold", get: (r) => r.qty, numeric: true, sortValue: (r) => r.qty },
    { key: "rate", header: "Rate", get: (r) => r.rate, currency: true, sortValue: (r) => r.rate },
    { key: "total", header: "Total Amount", get: (r) => r.total, currency: true, sortValue: (r) => r.total },
  ];

  const [tab, setTab] = useState("summary");
  const meta = (name: string) => ({
    reportName: name, propertyName: current?.name ?? "Property", from, to,
    totals: [
      ["Total KOTs", derivedKots.length],
      ["Total Food Revenue", fmtINR(derivedKots.reduce((s, r) => s + r.total, 0))],
    ] as [string, string|number][],
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
      onExcel={() => tab === "summary" ? exportExcel(derivedKots, kotCols, meta("KOT Summary")) : exportExcel(derivedItems, itemCols, meta("Item-wise Sales"))}
      onPdf={() => tab === "summary" ? exportPdf(derivedKots, kotCols, meta("KOT Summary")) : exportPdf(derivedItems, itemCols, meta("Item-wise Sales"))}
      disabled={(tab === "summary" ? kots : items).length === 0}
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="summary">KOT Summary</TabsTrigger><TabsTrigger value="items">Item-wise Sales</TabsTrigger></TabsList>
        <TabsContent value="summary">
          <Card><CardContent className="pt-4">
            <ReportDataTable
              rows={kots}
              columns={kotCols}
              onDerivedRowsChange={setDerivedKots}
              rowKey={(r) => r._id}
              emptyText="No KOTs in range."
              totalsRow={(d) => (
                <tr>
                  <td colSpan={5} className="px-2 py-2 text-right">Totals</td>
                  <td className="px-2 py-2 text-right tabular-nums">{d.length}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{fmtINR(d.reduce((s, r) => s + r.total, 0))}</td>
                  <td colSpan={2} />
                </tr>
              )}
            />
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="items">
          <Card><CardContent className="pt-4">
            <ReportDataTable
              rows={items}
              columns={itemCols}
              onDerivedRowsChange={setDerivedItems}
              rowKey={(r) => r._id}
              emptyText="No items in range."
              totalsRow={(d) => (
                <tr>
                  <td colSpan={3} className="px-2 py-2 text-right">Totals</td>
                  <td className="px-2 py-2 text-right tabular-nums">{d.reduce((s, r) => s + r.qty, 0)}</td>
                  <td />
                  <td className="px-2 py-2 text-right tabular-nums">{fmtINR(d.reduce((s, r) => s + r.total, 0))}</td>
                </tr>
              )}
            />
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </ReportShell>
  );
}

