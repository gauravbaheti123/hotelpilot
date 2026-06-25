import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { Download, MessageCircle, FileSpreadsheet, AlertTriangle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/restaurant/")({
  head: () => ({ meta: [{ title: "Restaurant Billing — HotelPilot" }] }),
  component: RestaurantPage,
});

interface CreditRow {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  is_settled: boolean;
  kot_order_id: string | null;
  booking_id: string | null;
  room_id: string | null;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function RestaurantPage() {
  const { current } = useCurrentProperty();
  const [credits, setCredits] = useState<CreditRow[]>([]);
  const [enriched, setEnriched] = useState<Record<string, { kot_number?: string; room_no?: string; guest_name?: string; items?: string }>>({});
  const [loading, setLoading] = useState(false);

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [restInvoice, setRestInvoice] = useState<number | "">("");
  const [settling, setSettling] = useState(false);
  const [waNumber, setWaNumber] = useState("");

  async function load() {
    if (!current) return;
    setLoading(true);
    // Backfill: ensure every restaurant_copy KOT (not void/wiped) has a credit row.
    // The DB trigger only fires when status flips to 'billed'; we want all restaurant
    // KOTs visible immediately, including those still 'open' / 'printed' / 'served'.
    const { data: rKots } = await supabase
      .from("kot_orders")
      .select("id,property_id,booking_id,room_id,total_amount,kot_number,created_at,status")
      .eq("property_id", current.id)
      .eq("kot_copy", "restaurant_copy")
      .eq("is_wiped", false)
      .neq("status", "void");
    if (rKots && rKots.length > 0) {
      const ids = rKots.map((k: any) => k.id);
      const { data: existing } = await supabase
        .from("restaurant_credits")
        .select("kot_order_id")
        .in("kot_order_id", ids);
      const have = new Set((existing ?? []).map((x: any) => x.kot_order_id));
      const missing = rKots.filter((k: any) => !have.has(k.id));
      if (missing.length > 0) {
        await supabase.from("restaurant_credits").insert(
          missing.map((k: any) => ({
            property_id: k.property_id,
            booking_id: k.booking_id,
            room_id: k.room_id,
            kot_order_id: k.id,
            amount: Number(k.total_amount ?? 0),
            date: (k.created_at ?? new Date().toISOString()).slice(0, 10),
            description: `Auto-credit from KOT ${k.kot_number ?? k.id}`,
          })) as any,
        );
      }
    }
    const { data, error } = await supabase
      .from("restaurant_credits")
      .select("id,date,amount,description,is_settled,kot_order_id,booking_id,room_id")
      .eq("property_id", current.id)
      .order("date", { ascending: false });
    if (error) toast.error(error.message);
    const rows = (data ?? []) as CreditRow[];
    setCredits(rows);

    // Enrich
    const kotIds = Array.from(new Set(rows.map((r) => r.kot_order_id).filter(Boolean))) as string[];
    const roomIds = Array.from(new Set(rows.map((r) => r.room_id).filter(Boolean))) as string[];
    const bookIds = Array.from(new Set(rows.map((r) => r.booking_id).filter(Boolean))) as string[];
    const [koRes, rmRes, bkRes, itemRes] = await Promise.all([
      kotIds.length ? supabase.from("kot_orders").select("id,kot_number").in("id", kotIds) : Promise.resolve({ data: [] as any }),
      roomIds.length ? supabase.from("rooms").select("id,room_number").in("id", roomIds) : Promise.resolve({ data: [] as any }),
      bookIds.length ? supabase.from("bookings").select("id,guests(name)").in("id", bookIds) : Promise.resolve({ data: [] as any }),
      kotIds.length ? supabase.from("kot_items").select("kot_id,item_name,qty").in("kot_id", kotIds) : Promise.resolve({ data: [] as any }),
    ]);
    const koMap = new Map((koRes.data ?? []).map((x: any) => [x.id, x.kot_number]));
    const rmMap = new Map((rmRes.data ?? []).map((x: any) => [x.id, x.room_number]));
    const bkMap = new Map((bkRes.data ?? []).map((x: any) => [x.id, x.guests?.name]));
    const itemMap = new Map<string, string[]>();
    for (const it of (itemRes.data ?? []) as any[]) {
      const arr = itemMap.get(it.kot_id) ?? [];
      arr.push(`${it.item_name} x${it.qty}`);
      itemMap.set(it.kot_id, arr);
    }
    const e: typeof enriched = {};
    for (const r of rows) {
      e[r.id] = {
        kot_number: r.kot_order_id ? koMap.get(r.kot_order_id) as string | undefined : undefined,
        room_no: r.room_id ? rmMap.get(r.room_id) as string | undefined : undefined,
        guest_name: r.booking_id ? bkMap.get(r.booking_id) as string | undefined : undefined,
        items: r.kot_order_id ? (itemMap.get(r.kot_order_id) ?? []).join(", ") : undefined,
      };
    }
    setEnriched(e);
    setLoading(false);
  }

  useEffect(() => { if (current) load(); /* eslint-disable-next-line */ }, [current?.id]);

  // Tab 1 — active credits (unsettled only) for current month
  const monthRows = useMemo(() => {
    return credits.filter((c) => {
      const d = new Date(c.date);
      return d.getMonth() + 1 === month && d.getFullYear() === year;
    });
  }, [credits, month, year]);

  const activeRows = useMemo(() => monthRows.filter((c) => !c.is_settled), [monthRows]);
  const totalActive = useMemo(() => activeRows.reduce((s, r) => s + Number(r.amount), 0), [activeRows]);
  const totalMonth = useMemo(() => monthRows.reduce((s, r) => s + Number(r.amount), 0), [monthRows]);

  const restInvoiceNum = typeof restInvoice === "number" ? restInvoice : Number(restInvoice || 0);
  const difference = restInvoiceNum - totalActive;

  async function settle() {
    if (!current) return;
    if (activeRows.length === 0) return toast.error("No outstanding credits to settle");
    setSettling(true);
    try {
      const ins = await (supabase as any).from("restaurant_settlements").insert({
        property_id: current.id,
        month,
        year,
        total_amount: totalActive,
        settled_amount: restInvoiceNum || totalActive,
        payment_mode: "bank_transfer",
        notes: difference !== 0 ? `Mismatch: hotel ₹${totalActive} vs restaurant ₹${restInvoiceNum} (Δ ${difference})` : null,
      }).select("id").single();
      if (ins.error) throw ins.error;
      const settlementId = ins.data.id;
      const ids = activeRows.map((r) => r.id);
      const upd = await supabase.from("restaurant_credits")
        .update({ is_settled: true, settlement_id: settlementId } as any)
        .in("id", ids);
      if (upd.error) throw upd.error;
      toast.success(`Settled ${ids.length} credits`);
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Settlement failed");
    } finally { setSettling(false); }
  }

  async function exportPdf() {
    const { default: jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`Restaurant Statement — ${MONTHS[month - 1]} ${year}`, 14, 18);
    doc.setFontSize(10);
    doc.text(`${current?.name ?? ""}`, 14, 25);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 31);
    autoTable(doc, {
      startY: 38,
      head: [["Date", "Room", "Guest", "KOT", "Items", "Amount"]],
      body: monthRows.map((r) => {
        const e = enriched[r.id] ?? {};
        return [
          r.date,
          e.room_no ?? "-",
          e.guest_name ?? "-",
          e.kot_number ?? "-",
          (e.items ?? "").slice(0, 60),
          `Rs ${Number(r.amount).toFixed(2)}`,
        ];
      }),
      styles: { fontSize: 8 },
    });
    const finalY = (doc as any).lastAutoTable.finalY + 8;
    doc.setFontSize(11);
    doc.text(`Total: Rs ${totalMonth.toFixed(2)}`, 14, finalY);
    doc.save(`restaurant-${year}-${String(month).padStart(2, "0")}.pdf`);
  }

  async function sendWhatsApp() {
    if (!current) return;
    if (!waNumber.trim()) return toast.error("Enter restaurant WhatsApp number");
    const msg = [
      `*Restaurant Statement — ${MONTHS[month - 1]} ${year}*`,
      `Hotel: ${current.name}`,
      `Outstanding: ₹${totalActive.toFixed(2)}`,
      `Total entries: ${monthRows.length}`,
      `Please confirm reconciliation.`,
    ].join("\n");
    const url = `https://wa.me/${waNumber.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  }

  if (!current) return <AppShell title="Restaurant"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Restaurant Billing">
      <div className="p-4 space-y-4 max-w-6xl">
        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">Active Credits</TabsTrigger>
            <TabsTrigger value="settle">Month-end Settlement</TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Active Restaurant Credits ({MONTHS[month - 1]} {year})</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    Total outstanding this month: <span className="font-semibold text-foreground">₹{totalActive.toLocaleString()}</span>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Guest</TableHead>
                      <TableHead>KOT Ref</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && (
                      <TableRow><TableCell colSpan={7} className="text-center py-6 text-sm text-muted-foreground">Loading…</TableCell></TableRow>
                    )}
                    {!loading && monthRows.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="text-center py-6 text-sm text-muted-foreground">No restaurant credits this month</TableCell></TableRow>
                    )}
                    {monthRows.map((r) => {
                      const e = enriched[r.id] ?? {};
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs">{r.date}</TableCell>
                          <TableCell>{e.room_no ?? "—"}</TableCell>
                          <TableCell>{e.guest_name ?? "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{e.kot_number ?? "—"}</TableCell>
                          <TableCell className="text-xs max-w-[280px] truncate">{e.items ?? "—"}</TableCell>
                          <TableCell className="text-right font-medium">₹{Number(r.amount).toFixed(2)}</TableCell>
                          <TableCell>
                            {r.is_settled
                              ? <Badge variant="secondary">Settled</Badge>
                              : <Badge variant="default">Open</Badge>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settle" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Month-end Settlement</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <Label>Month</Label>
                    <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Year</Label>
                    <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
                  </div>
                  <div className="md:col-span-2 flex items-end gap-2">
                    <Button variant="outline" onClick={exportPdf}>
                      <Download className="h-4 w-4 mr-1" /> Export PDF
                    </Button>
                    <Input placeholder="Restaurant WhatsApp #" value={waNumber} onChange={(e) => setWaNumber(e.target.value)} className="max-w-[180px]" />
                    <Button variant="outline" onClick={sendWhatsApp}>
                      <MessageCircle className="h-4 w-4 mr-1" /> Send WA
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Card><CardContent className="pt-4">
                    <div className="text-xs text-muted-foreground">Hotel Total (unsettled)</div>
                    <div className="text-2xl font-semibold">₹{totalActive.toLocaleString()}</div>
                  </CardContent></Card>
                  <Card><CardContent className="pt-4">
                    <Label className="text-xs">Restaurant invoice amount</Label>
                    <Input type="number" placeholder="0" value={restInvoice}
                      onChange={(e) => setRestInvoice(e.target.value === "" ? "" : Number(e.target.value))} />
                  </CardContent></Card>
                  <Card><CardContent className="pt-4">
                    <div className="text-xs text-muted-foreground">Difference</div>
                    <div className={`text-2xl font-semibold ${difference === 0 ? "" : "text-destructive"}`}>
                      ₹{difference.toLocaleString()}
                    </div>
                    {difference !== 0 && restInvoice !== "" && (
                      <div className="flex items-center text-xs text-destructive mt-1">
                        <AlertTriangle className="h-3 w-3 mr-1" /> Mismatch — please reconcile
                      </div>
                    )}
                    {difference === 0 && restInvoice !== "" && (
                      <div className="flex items-center text-xs text-emerald-600 mt-1">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Matches
                      </div>
                    )}
                  </CardContent></Card>
                </div>

                <div>
                  <div className="text-sm font-medium mb-2 flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4" /> KOT-wise breakup
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>KOT</TableHead>
                        <TableHead>Room</TableHead>
                        <TableHead>Guest</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {monthRows.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center py-4 text-sm text-muted-foreground">No data</TableCell></TableRow>
                      )}
                      {monthRows.map((r) => {
                        const e = enriched[r.id] ?? {};
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="text-xs">{r.date}</TableCell>
                            <TableCell className="text-xs font-mono">{e.kot_number ?? "—"}</TableCell>
                            <TableCell>{e.room_no ?? "—"}</TableCell>
                            <TableCell>{e.guest_name ?? "—"}</TableCell>
                            <TableCell className="text-right">₹{Number(r.amount).toFixed(2)}</TableCell>
                            <TableCell>{r.is_settled ? <Badge variant="secondary">Settled</Badge> : <Badge>Open</Badge>}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <Button onClick={settle} disabled={settling || activeRows.length === 0} className="w-full">
                  {settling ? "Settling…" : `Mark ${activeRows.length} credits settled`}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}