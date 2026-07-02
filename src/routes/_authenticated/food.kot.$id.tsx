import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { KOT_STATUS_LABEL, KOT_STATUS_TONE, computeKotTotals } from "@/lib/food";
import { fetchPrinterPaperSize, getPrintStyles } from "@/lib/printStyles";
import { useCurrentProperty } from "@/hooks/use-property";
import { DeliveryProof } from "@/components/DeliveryProof";
import { Printer, Check, Ban, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/food/kot/$id")({
  head: () => ({ meta: [{ title: "KOT — HotelPilot" }] }),
  component: KotDetailPage,
});

interface Item {
  id: string; item_name: string; qty: number; rate: number;
  amount: number; gst_rate: number; kot_station: string; notes: string | null; is_void: boolean;
}
interface Kot {
  id: string; kot_number: string; kot_type: string; table_no: string | null;
  guest_name: string | null; status: string;
  sub_total: number; gst_amount: number; total_amount: number;
  notes: string | null; void_reason: string | null; created_at: string;
  printed_at: string | null; served_at: string | null; billed_at: string | null;
  booking_id: string | null;
  delivery_proof_url: string | null;
  delivery_photo_taken_at: string | null;
  delivery_photo_taken_by: string | null;
  rooms: { room_number: string } | null;
  bookings: { booking_number: string } | null;
  kot_items: Item[];
}

function KotDetailPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { current } = useCurrentProperty();
  const [k, setK] = useState<Kot | null>(null);
  const [loading, setLoading] = useState(true);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("kot_orders")
      .select(`id,kot_number,kot_type,table_no,guest_name,status,sub_total,gst_amount,total_amount,
        notes,void_reason,created_at,printed_at,served_at,billed_at,booking_id,
        delivery_proof_url,delivery_photo_taken_at,delivery_photo_taken_by,
        rooms(room_number),bookings(booking_number),
        kot_items(id,item_name,qty,rate,amount,gst_rate,kot_station,notes,is_void)`)
      .eq("id", id).single();
    if (error) toast.error(error.message);
    setK((data ?? null) as unknown as Kot);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function setStatus(next: "printed" | "served" | "billed") {
    if (!k) return;
    const stamp = new Date().toISOString();
    const patch: any = { status: next };
    if (next === "printed") patch.printed_at = stamp;
    if (next === "served") patch.served_at = stamp;
    if (next === "billed") patch.billed_at = stamp;
    const { error } = await supabase.from("kot_orders").update(patch).eq("id", k.id);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${next}`);
    load();
  }

  async function voidKot() {
    if (!k) return;
    if (!voidReason.trim()) return toast.error("Reason required");
    const { error } = await supabase.from("kot_orders").update({
      status: "void", void_reason: voidReason, voided_at: new Date().toISOString(),
    }).eq("id", k.id);
    if (error) return toast.error(error.message);
    toast.success("KOT voided");
    setVoidOpen(false);
    load();
  }

  async function updateQty(itemId: string, qty: number) {
    if (!k) return;
    const it = k.kot_items.find((x) => x.id === itemId);
    if (!it) return;
    const next = Math.max(0, qty);
    if (next === 0) {
      await supabase.from("kot_items").delete().eq("id", itemId);
    } else {
      await supabase.from("kot_items").update({ qty: next, amount: next * Number(it.rate) }).eq("id", itemId);
    }
    const items = k.kot_items
      .map((x) => x.id === itemId ? { ...x, qty: next, amount: next * Number(x.rate) } : x)
      .filter((x) => x.qty > 0);
    const t = computeKotTotals(items);
    await supabase.from("kot_orders").update(t).eq("id", k.id);
    load();
  }

  if (loading) return <AppShell title="KOT"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!k) return <AppShell title="KOT"><p className="text-sm text-muted-foreground">Not found.</p></AppShell>;

  const editable = k.status === "open" || k.status === "printed";
  const stations = Array.from(new Set(k.kot_items.map((i) => i.kot_station)));

  async function printSlip(station?: string) {
    if (!k) return;
    const paperSize = await fetchPrinterPaperSize(current?.id, "kot");
    const esc = (s: unknown) => String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const target = station ? k.kot_items.filter((i) => i.kot_station === station && !i.is_void) : k.kot_items.filter((i) => !i.is_void);
    const html = `
      <html><head><title>${esc(k.kot_number)}</title>
      <style>${getPrintStyles(paperSize)}
      body{font:12px monospace;padding:8px}h2{margin:0 0 4px;font-size:14px}hr{border:none;border-top:1px dashed #999;margin:6px 0}.row{display:flex;justify-content:space-between}</style>
      </head><body>
      <h2>KOT ${esc(k.kot_number)}</h2>
      <div>${new Date(k.created_at).toLocaleString()}</div>
      <div>${k.kot_type === "room" ? `Room ${esc(k.rooms?.room_number ?? "—")}` : `Table ${esc(k.table_no ?? "—")}`}</div>
      ${k.guest_name ? `<div>Guest: ${esc(k.guest_name)}</div>` : ""}
      ${station ? `<div><strong>Station: ${esc(station.toUpperCase())}</strong></div>` : ""}
      <hr/>
      ${target.map((i) => `<div class="row"><span>${i.qty} × ${esc(i.item_name)}</span><span>₹${(i.qty*i.rate).toFixed(0)}</span></div>${i.notes ? `<div style="padding-left:8px;color:#555">- ${esc(i.notes)}</div>` : ""}`).join("")}
      <hr/>
      <div class="row"><span>Total</span><span>₹${Number(k.total_amount).toFixed(2)}</span></div>
      ${k.notes ? `<div><em>${esc(k.notes)}</em></div>` : ""}
      </body></html>`;
    const w = window.open("", "_blank", "width=320,height=600");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <AppShell title={`KOT ${k.kot_number}`}>
      <div className="max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.history.back()}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          <Badge variant="outline" className={KOT_STATUS_TONE[k.status]}>{KOT_STATUS_LABEL[k.status]}</Badge>
          <div className="text-sm text-muted-foreground">
            {k.kot_type === "room" ? `Room ${k.rooms?.room_number ?? "—"}` : `Table ${k.table_no ?? "—"}`}
            {k.bookings ? ` · ${k.bookings.booking_number}` : ""}
            {k.guest_name ? ` · ${k.guest_name}` : ""}
          </div>
          <div className="flex-1" />
          {k.status !== "void" && k.status !== "billed" && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => printSlip()}><Printer className="h-4 w-4 mr-1" /> Print all</Button>
              {stations.map((st) => (
                <Button key={st} size="sm" variant="outline" onClick={() => printSlip(st)}>
                  <Printer className="h-4 w-4 mr-1" /> {st}
                </Button>
              ))}
              {k.status === "open" && <Button size="sm" onClick={() => setStatus("printed")}>Mark printed</Button>}
              {k.status === "printed" && <Button size="sm" onClick={() => setStatus("served")}><Check className="h-4 w-4 mr-1" /> Served</Button>}
              {k.status === "served" && <Button size="sm" onClick={() => setStatus("billed")}>Mark billed</Button>}
              {editable && <Button size="sm" variant="outline" className="text-destructive" onClick={() => setVoidOpen(true)}><Ban className="h-4 w-4 mr-1" /> Void</Button>}
            </div>
          )}
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {k.kot_items.map((it) => (
              <div key={it.id} className="flex items-center gap-2 py-1 border-b last:border-0 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{it.item_name}</div>
                  <div className="text-xs text-muted-foreground">₹{it.rate} · {it.kot_station} · GST {it.gst_rate}%</div>
                </div>
                {editable ? (
                  <Input type="number" min={0} step={1} value={it.qty}
                    onChange={(e) => updateQty(it.id, Number(e.target.value))}
                    className="h-8 w-20" />
                ) : (
                  <div className="w-20 text-right">× {it.qty}</div>
                )}
                <div className="w-24 text-right">₹{Number(it.amount).toLocaleString("en-IN")}</div>
              </div>
            ))}
            <div className="pt-3 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Sub-total</span><span>₹{Number(k.sub_total).toLocaleString("en-IN")}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">GST</span><span>₹{Number(k.gst_amount).toLocaleString("en-IN")}</span></div>
              <div className="flex justify-between font-semibold text-base"><span>Total</span><span>₹{Number(k.total_amount).toLocaleString("en-IN")}</span></div>
            </div>
            {k.notes && <div className="text-xs text-muted-foreground pt-2 border-t">Notes: {k.notes}</div>}
            {k.void_reason && <div className="text-xs text-rose-600 pt-2">Void reason: {k.void_reason}</div>}
          </CardContent>
        </Card>

        {(k.status === "served" || k.status === "billed" || k.delivery_proof_url) && (
          <DeliveryProof
            kotId={k.id}
            propertyId={current?.id}
            kotNumber={k.kot_number}
            proofUrl={k.delivery_proof_url}
            takenAt={k.delivery_photo_taken_at}
            takenBy={k.delivery_photo_taken_by}
            onSaved={load}
          />
        )}

        <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Void KOT</DialogTitle></DialogHeader>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason *</Label>
              <Textarea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setVoidOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={voidKot}>Void</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}