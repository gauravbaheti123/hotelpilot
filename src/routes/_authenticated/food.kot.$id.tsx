import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/BackButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastWithUndo } from "@/lib/undoToast";
import { KOT_STATUS_LABEL, KOT_STATUS_TONE, computeKotTotals } from "@/lib/food";
import { buildKotPrintPlan, runKotPrintJobs, type PrinterInfo, type PrintMode } from "@/lib/kotPrint";
import { useCurrentProperty } from "@/hooks/use-property";
import { DeliveryProof } from "@/components/DeliveryProof";
import { Printer, Check, Ban, ArrowLeft } from "lucide-react";

import { RequirePermission } from "@/components/RequirePermission";
import { toastError } from "@/lib/errorMessage";
export const Route = createFileRoute("/_authenticated/food/kot/$id")({
  head: () => ({ meta: [{ title: "KOT — HotelPilot" }] }),
  component: () => (<RequirePermission module="all_kots"><KotDetailPage /></RequirePermission>),
});

interface Item {
  id: string; item_name: string; qty: number; rate: number;
  amount: number; gst_rate: number; kot_station: string; notes: string | null; is_void: boolean;
  menu_items?: {
    kitchen_printer_id: string | null;
    category_id: string | null;
    menu_categories: { kot_printer_id: string | null } | null;
  } | null;
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
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [counterPrinter, setCounterPrinter] = useState<PrinterInfo | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("kot_orders")
      .select(`id,kot_number,kot_type,table_no,guest_name,status,sub_total,gst_amount,total_amount,
        notes,void_reason,created_at,printed_at,served_at,billed_at,booking_id,
        delivery_proof_url,delivery_photo_taken_at,delivery_photo_taken_by,
        rooms(room_number),bookings(booking_number),
        kot_items(id,item_name,qty,rate,amount,gst_rate,kot_station,notes,is_void,
          menu_items(kitchen_printer_id,category_id,menu_categories(kot_printer_id)))`)
      .eq("id", id).single();
    if (error) toastError(error);
    setK((data ?? null) as unknown as Kot);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  useEffect(() => {
    if (!current?.id) return;
    (async () => {
      const [pr, cc] = await Promise.all([
        supabase.from("printers").select("id,name,paper_size,printer_role,type")
          .eq("property_id", current.id).eq("is_active", true).in("type", ["kot", "both"]),
        supabase.from("printers").select("id,name,paper_size,printer_role,type")
          .eq("property_id", current.id).eq("is_active", true).eq("printer_role", "Counter Copy").limit(1),
      ]);
      const ccRow = (cc.data as any[] | null)?.[0] ?? null;
      console.log("[kotPrint] counter copy fetch (detail)", {
        property_id: current.id,
        error: cc.error?.message ?? null,
        rows: cc.data?.length ?? 0,
        row: ccRow,
      });
      setPrinters(((pr.data ?? []) as any[]).map((p) => ({
        id: p.id, name: p.name, paper_size: p.paper_size, printer_role: p.printer_role,
      })));
      setCounterPrinter(ccRow ? {
        id: ccRow.id, name: ccRow.name,
        paper_size: ccRow.paper_size, printer_role: ccRow.printer_role,
      } : null);
    })();
  }, [current?.id]);

  async function setStatus(next: "printed" | "served" | "billed") {
    if (!k) return;
    // Timestamps are forced to server now() by trg_force_server_time_kot.
    const stamp = new Date().toISOString();
    const patch: any = { status: next };
    if (next === "printed") patch.printed_at = stamp;
    if (next === "served") patch.served_at = stamp;
    if (next === "billed") patch.billed_at = stamp;
    const { error } = await supabase.from("kot_orders").update(patch).eq("id", k.id);
    if (error) return toastError(error);
    toast.success(`Marked ${next}`);
    load();
  }

  async function voidKot() {
    if (!k) return;
    if (!voidReason.trim()) return toast.error("Reason required");
    const { error } = await supabase.from("kot_orders").update({
      // voided_at is stamped with server now() by trg_force_server_time_kot
      status: "void", void_reason: voidReason,
    }).eq("id", k.id);
    if (error) return toastError(error);
    const kotId = k.id;
    const priorStatus = k.status;
    const priorReason = (k as any).void_reason ?? null;
    setVoidOpen(false);
    toastWithUndo(
      "KOT voided",
      async () => {
        const { error: undoErr } = await supabase.from("kot_orders").update({
          status: priorStatus === "void" ? "pending" : priorStatus,
          void_reason: priorReason,
        } as any).eq("id", kotId);
        if (undoErr) throw undoErr;
        load();
      },
      { undoneMessage: "KOT restored" },
    );
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

  async function reprint(mode: PrintMode) {
    if (!k) return;
    const planItems = k.kot_items
      .filter((i) => !i.is_void)
      .map((i) => ({
        item_name: i.item_name,
        qty: Number(i.qty),
        rate: Number(i.rate),
        notes: i.notes,
        printer_id:
          i.menu_items?.kitchen_printer_id ??
          i.menu_items?.menu_categories?.kot_printer_id ??
          null,
      }));
    const { jobs, warnings, unroutedItems } = buildKotPrintPlan(planItems, printers, counterPrinter, mode);
    for (const w of warnings) {
      if (unroutedItems.length > 0 && w.includes("no kitchen printer")) toast.error(w, { duration: 15000 });
      else toast.warning(w);
    }
    if (jobs.length === 0) {
      toast.error("Nothing to print.");
      return;
    }
    const names = jobs.map((j) => `${j.printer.name} (${j.badge === "COUNTER COPY" ? "counter" : "kitchen"})`);
    toast.info(`Printing to: ${names.join(", ")}`);
    console.log("[kotPrint] reprint starting", { mode, jobs: jobs.length, targets: names });
    await runKotPrintJobs(
      {
        kot_number: k.kot_number,
        kot_type: k.kot_type,
        table_no: k.table_no,
        room_number: k.rooms?.room_number ?? null,
        guest_name: k.guest_name,
        notes: k.notes,
        created_at: k.created_at,
      },
      jobs,
    );
  }

  return (
    <AppShell title={`KOT ${k.kot_number}`}>
      <div className="max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <BackButton fallbackTo="/restaurant" />
          <Badge variant="outline" className={KOT_STATUS_TONE[k.status]}>{KOT_STATUS_LABEL[k.status]}</Badge>
          <div className="text-sm text-muted-foreground">
            {k.kot_type === "room" ? `Room ${k.rooms?.room_number ?? "—"}` : `Table ${k.table_no ?? "—"}`}
            {k.bookings ? ` · ${k.bookings.booking_number}` : ""}
            {k.guest_name ? ` · ${k.guest_name}` : ""}
          </div>
          <div className="flex-1" />
          {k.status !== "void" && k.status !== "billed" && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => reprint("kitchen+counter")}>
                <Printer className="h-4 w-4 mr-1" /> Reprint All
              </Button>
              <Button size="sm" variant="outline" onClick={() => reprint("kitchen")}>
                <Printer className="h-4 w-4 mr-1" /> Reprint Kitchen Copy
              </Button>
              <Button size="sm" variant="outline" onClick={() => reprint("counter")}>
                <Printer className="h-4 w-4 mr-1" /> Reprint Counter Copy
              </Button>
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