import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Printer } from "lucide-react";
import { inr } from "@/lib/billing";
import { usePaymentMethods, formatPaymentMethodLabel } from "@/hooks/use-payment-methods";
import { useAuth } from "@/hooks/use-auth";
import { ItemPickerCombobox, type PickerItem } from "@/components/ItemPickerCombobox";
import { buildKotPrintPlan, runKotPrintJobs, type PrinterInfo, type KotItemForPrint } from "@/lib/kotPrint";

export type SegmentKind = "food" | "laundry";

interface Line {
  key: string;
  description: string;
  qty: number;
  rate: number;
  gst_rate: number;
  menu_item_id?: string | null;
  master_id?: string | null;
  printer_id?: string | null;
}


interface Props {
  open: boolean;
  onClose: () => void;
  segment: SegmentKind;
  propertyId: string;
  propertyName?: string;
  bookingId?: string | null;
  roomId?: string | null;
  roomNumber?: string | null;
  guestName?: string | null;
  onSaved?: () => void;
}

function uid() { return Math.random().toString(36).slice(2, 10); }

export function PunchChargeDialog({
  open, onClose, segment, propertyId, propertyName,
  bookingId, roomId, roomNumber, guestName, onSaved,
}: Props) {
  const { user } = useAuth();
  const { methods: paymentMethods } = usePaymentMethods(propertyId);
  const [lines, setLines] = useState<Line[]>([]);
  const [pickerItems, setPickerItems] = useState<PickerItem[]>([]);
  const [walkin, setWalkin] = useState(!bookingId);
  const [walkinGuest, setWalkinGuest] = useState("");
  const [payMode, setPayMode] = useState<string>("cash");
  const [saving, setSaving] = useState(false);
  const [defaultGst, setDefaultGst] = useState<number>(segment === "food" ? 5 : 5);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printerByItem, setPrinterByItem] = useState<Map<string, string | null>>(new Map());

  useEffect(() => {
    if (!open) return;
    setLines([{ key: uid(), description: "", qty: 1, rate: 0, gst_rate: segment === "food" ? 5 : 5 }]);
    setWalkin(!bookingId);
    setWalkinGuest("");
  }, [open, segment, bookingId]);

  useEffect(() => {
    if (!open || !propertyId) return;
    let cancelled = false;
    if (segment === "food") {
      supabase.from("menu_items")
        .select("id,name,price,gst_rate,short_code,is_available,kitchen_printer_id")
        .eq("property_id", propertyId)
        .eq("is_available", true)
        .order("name")
        .then(({ data }) => {
          if (cancelled) return;
          setPickerItems((data ?? []).map((m: any) => ({
            id: m.id, name: m.name, rate: Number(m.price ?? 0),
            gst_rate: m.gst_rate, short_code: m.short_code, category: null,
          })));
          setPrinterByItem(new Map((data ?? []).map((m: any) => [m.id, m.kitchen_printer_id ?? null])));
        });
    } else {
      supabase.from("sundry_items")
        .select("id,name,rate,gst_rate,short_code,sku,category,is_active")
        .eq("property_id", propertyId)
        .eq("is_active", true)
        .order("name")
        .then(({ data }) => {
          if (cancelled) return;
          setPickerItems((data ?? []).map((s: any) => ({
            id: s.id, name: s.name, rate: Number(s.rate ?? 0),
            gst_rate: s.gst_rate, short_code: s.short_code ?? s.sku, category: s.category,
          })));
        });
    }
    return () => { cancelled = true; };
  }, [open, segment, propertyId]);

  // Printers for kitchen ticket routing (food only)
  useEffect(() => {
    if (!open || segment !== "food" || !propertyId) return;
    let cancelled = false;
    supabase.from("printers")
      .select("id,name,paper_size,printer_role,type,is_active")
      .eq("property_id", propertyId)
      .eq("is_active", true)
      .then(({ data }) => {
        if (cancelled) return;
        setPrinters((data ?? []).map((p: any) => ({
          id: p.id, name: p.name, paper_size: p.paper_size, printer_role: p.printer_role,
        })));
      });
    return () => { cancelled = true; };
  }, [open, segment, propertyId]);

  // Fetch first active GST slab as sensible default for laundry
  useEffect(() => {
    if (!open || segment !== "laundry" || !propertyId) return;
    supabase.rpc("get_gst_rate", { p_property_id: propertyId, p_category: "sundry", p_amount: 100 })
      .then(({ data }) => { if (typeof data === "number") setDefaultGst(data); });
  }, [open, segment, propertyId]);

  const totals = useMemo(() => {
    let sub = 0, gst = 0;
    for (const l of lines) {
      const amt = Number(l.qty || 0) * Number(l.rate || 0);
      sub += amt;
      gst += amt * Number(l.gst_rate || 0) / 100;
    }
    return { sub: Math.round(sub * 100) / 100, gst: Math.round(gst * 100) / 100, total: Math.round((sub + gst) * 100) / 100 };
  }, [lines]);

  function addLine() {
    setLines((prev) => [...prev, { key: uid(), description: "", qty: 1, rate: 0, gst_rate: defaultGst }]);
  }
  function removeLine(k: string) {
    setLines((prev) => prev.length === 1 ? prev : prev.filter((l) => l.key !== k));
  }
  function updateLine(k: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => l.key === k ? { ...l, ...patch } : l));
  }
  function pickItem(k: string, it: PickerItem) {
    updateLine(k, {
      master_id: it.id,
      menu_item_id: segment === "food" ? it.id : null,
      description: it.name,
      rate: Number(it.rate ?? 0),
      gst_rate: Number(it.gst_rate ?? defaultGst),
      printer_id: segment === "food" ? (printerByItem.get(it.id) ?? null) : null,
    });
  }

  /** Kitchen ticket + counter copy, matching the removed legacy New KOT flow. */
  async function printKitchenTicket(billNumber: string, clean: Line[]) {
    if (segment !== "food") return;
    const items: KotItemForPrint[] = clean.map((l) => ({
      item_name: l.description.trim(),
      qty: Number(l.qty),
      rate: Number(l.rate),
      printer_id: l.printer_id ?? null,
    }));
    const counter = printers.find((p) => (p.printer_role ?? "").toLowerCase() === "counter copy") ?? null;
    const { jobs, warnings } = buildKotPrintPlan(items, printers, counter, "kitchen+counter");
    warnings.forEach((w) => toast.warning(w));
    if (jobs.length === 0) return;
    await runKotPrintJobs({
      kot_number: billNumber,
      kot_type: roomNumber && !walkin ? "room" : "table",
      room_number: walkin ? null : (roomNumber ?? null),
      guest_name: walkin ? walkinGuest.trim() : (guestName ?? null),
      created_at: new Date().toISOString(),
    }, jobs);
  }

  async function ensureFolio(): Promise<string | null> {
    if (!bookingId) return null;
    const { data, error } = await supabase.rpc("get_or_create_folio", { _booking_id: bookingId });
    if (error) {
      toast.error(error.message);
      return null;
    }
    return (data as string) ?? null;
  }

  async function save() {
    const clean = lines.filter((l) => l.description.trim() && Number(l.qty) > 0 && Number(l.rate) >= 0);
    if (clean.length === 0) { toast.error("Add at least one item"); return; }
    if (walkin && !walkinGuest.trim()) { toast.error("Enter walk-in customer name"); return; }
    setSaving(true);
    try {
      const folioId = walkin ? null : await ensureFolio();
      const insertBill = {
        property_id: propertyId,
        segment,
        booking_id: walkin ? null : bookingId,
        folio_id: walkin ? null : folioId,
        room_id: walkin ? null : roomId,
        is_walkin: walkin,
        guest_name: walkin ? walkinGuest.trim() : (guestName ?? null),
        total_amount: totals.total,
        gst_amount: totals.gst,
        paid_amount: walkin ? totals.total : 0,
        payment_mode: walkin ? payMode : null,
        status: walkin ? "settled" : "open",
        settled_at: walkin ? new Date().toISOString() : null,
        created_by: user?.id ?? null,
      };
      const { data: bill, error: bErr } = await supabase
        .from("segment_bills").insert(insertBill as any).select("id,bill_number").single();
      if (bErr) throw bErr;
      const billNumber = (bill as any).bill_number as string;
      const billId = (bill as any).id as string;

      const items = clean.map((l) => {
        const amt = Number(l.qty) * Number(l.rate);
        const gAmt = amt * Number(l.gst_rate || 0) / 100;
        return {
          segment_bill_id: billId,
          description: l.description.trim(),
          qty: l.qty,
          rate: l.rate,
          amount: Math.round(amt * 100) / 100,
          gst_rate: l.gst_rate,
          gst_amount: Math.round(gAmt * 100) / 100,
        };
      });
      const { error: iErr } = await supabase.from("segment_bill_items").insert(items as any);
      if (iErr) throw iErr;

      // Post to folio if linked to a booking
      if (!walkin && folioId) {
        const chargeType = segment === "food" ? "food" : "laundry";
        const rows = clean.map((l) => {
          const amt = Number(l.qty) * Number(l.rate);
          const gAmt = amt * Number(l.gst_rate || 0) / 100;
          return {
            folio_id: folioId,
            charge_type: chargeType,
            description: `${l.description.trim()} (${billNumber})`,
            qty: l.qty,
            rate: l.rate,
            amount: Math.round(amt * 100) / 100,
            gst_rate: l.gst_rate,
            gst_amount: Math.round(gAmt * 100) / 100,
            source_table: "segment_bills",
            source_id: billId,
            segment_bill_ref: billNumber,
            created_by: user?.id ?? null,
          };
        });
        const { error: fcErr } = await supabase.from("folio_charges").insert(rows as any);
        if (fcErr) throw fcErr;
      }

      toast.success(`${segment === "food" ? "Food" : "Laundry"} bill ${billNumber} created`);
      try {
        await printKitchenTicket(billNumber, clean);
      } catch (pe: any) {
        toast.error(pe?.message ?? "Kitchen print failed");
      }
      printSegmentBill({
        billNumber, segment, propertyName: propertyName ?? "",
        guestName: walkin ? walkinGuest.trim() : (guestName ?? "Guest"),
        roomNumber: walkin ? null : (roomNumber ?? null),
        items: clean.map((l) => ({
          description: l.description.trim(), qty: l.qty, rate: l.rate,
          amount: Number(l.qty) * Number(l.rate), gst_rate: l.gst_rate,
        })),
        sub: totals.sub, gst: totals.gst, total: totals.total,
        isWalkin: walkin, paymentMode: walkin ? payMode : null,
      });
      onSaved?.();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  const title = segment === "food" ? "Punch Food Charge" : "Punch Laundry Charge";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {title}
            {roomNumber && !walkin ? <Badge variant="secondary">Room {roomNumber}</Badge> : null}
            {walkin ? <Badge>Walk-in / Counter Sale</Badge> : null}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
          <div className="text-sm">
            {walkin ? (
              <span className="text-muted-foreground">No folio — settled at counter</span>
            ) : (
              <span>Posts to folio for <b>{guestName ?? "Guest"}</b></span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="walkin-toggle" className="text-xs">Walk-in</Label>
            <Switch
              id="walkin-toggle"
              checked={walkin}
              onCheckedChange={(v) => { if (bookingId || !v) setWalkin(v); }}
              disabled={!bookingId}
            />
          </div>
        </div>

        {walkin && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Customer name</Label>
              <Input value={walkinGuest} onChange={(e) => setWalkinGuest(e.target.value)} placeholder="Walk-in customer" />
            </div>
            <div>
              <Label>Payment mode</Label>
              <Select value={payMode} onValueChange={setPayMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((m) => (
                    <SelectItem key={m.id} value={m.name}>{formatPaymentMethodLabel(m.name)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {lines.map((l, idx) => (
            <div key={l.key} className="grid gap-2 items-end" style={{ gridTemplateColumns: segment === "food" ? "1fr 80px 100px 80px 36px" : "1fr 80px 100px 80px 36px" }}>
              <div>
                {idx === 0 && <Label className="text-xs">Item</Label>}
                <ItemPickerCombobox
                  items={pickerItems}
                  value={l.description}
                  selectedId={l.master_id ?? null}
                  onSelect={(it) => pickItem(l.key, it)}
                  placeholder={segment === "food" ? "Search food item…" : "Search laundry / sundry item…"}
                />
              </div>
              <div>
                {idx === 0 && <Label className="text-xs">Qty</Label>}
                <Input type="number" min={0} step="0.5" value={l.qty}
                  onChange={(e) => updateLine(l.key, { qty: Number(e.target.value || 0) })} />
              </div>
              <div>
                {idx === 0 && <Label className="text-xs">Rate</Label>}
                <Input type="number" min={0} step="0.01" value={l.rate}
                  onChange={(e) => updateLine(l.key, { rate: Number(e.target.value || 0) })} />
              </div>
              <div>
                {idx === 0 && <Label className="text-xs">GST%</Label>}
                <Input type="number" min={0} step="0.01" value={l.gst_rate}
                  onChange={(e) => updateLine(l.key, { gst_rate: Number(e.target.value || 0) })} />
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(l.key)} disabled={lines.length === 1}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button type="button" size="sm" variant="outline" onClick={addLine}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add line
          </Button>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
          <div className="flex justify-between"><span>Subtotal</span><span>{inr(totals.sub)}</span></div>
          <div className="flex justify-between"><span>GST</span><span>{inr(totals.gst)}</span></div>
          <div className="flex justify-between font-semibold text-base border-t pt-1"><span>Total</span><span>{inr(totals.total)}</span></div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            <Printer className="h-4 w-4 mr-1.5" />
            {saving ? "Saving..." : walkin ? "Save & Print" : "Post to Folio & Print"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --- Standalone segment bill print (window.print in hidden iframe) --- */
export function printSegmentBill(opts: {
  billNumber: string;
  segment: SegmentKind;
  propertyName: string;
  guestName: string;
  roomNumber: string | null;
  items: { description: string; qty: number; rate: number; amount: number; gst_rate: number }[];
  sub: number; gst: number; total: number;
  isWalkin: boolean;
  paymentMode: string | null;
}) {
  const rowsHtml = opts.items.map((it) => `
    <tr>
      <td>${escape(it.description)}</td>
      <td class="r">${it.qty}</td>
      <td class="r">${it.rate.toFixed(2)}</td>
      <td class="r">${it.gst_rate}%</td>
      <td class="r">${it.amount.toFixed(2)}</td>
    </tr>`).join("");
  const now = new Date();
  const dt = now.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  const heading = opts.segment === "food" ? "Food Bill" : "Laundry Bill";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${opts.billNumber}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; color: #000; }
  body { width: 76mm; font-size: 11px; }
  h1 { font-size: 13px; margin: 0 0 2px; text-align: center; }
  .prop { text-align: center; font-weight: bold; font-size: 12px; }
  .meta { display: flex; justify-content: space-between; font-size: 10px; margin: 4px 0; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 2px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 2px 0; text-align: left; font-size: 10px; }
  th { border-bottom: 1px solid #000; }
  td.r, th.r { text-align: right; }
  tfoot td { border-top: 1px dashed #000; }
  .total { font-weight: bold; font-size: 12px; border-top: 1px solid #000; padding-top: 3px; margin-top: 3px; display: flex; justify-content: space-between; }
  .foot { text-align: center; margin-top: 6px; font-size: 10px; }
</style></head>
<body>
  <div class="prop">${escape(opts.propertyName)}</div>
  <h1>${heading}</h1>
  <div class="meta">
    <span>${escape(opts.billNumber)}</span>
    <span>${escape(dt)}</span>
  </div>
  <div style="font-size:10px;">Guest: <b>${escape(opts.guestName)}</b>${opts.roomNumber ? ` · Room ${escape(opts.roomNumber)}` : ""}${opts.isWalkin ? " · Walk-in" : ""}</div>
  <table>
    <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">GST</th><th class="r">Amt</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div style="display:flex; justify-content:space-between; margin-top:4px; font-size:10px;"><span>Subtotal</span><span>${opts.sub.toFixed(2)}</span></div>
  <div style="display:flex; justify-content:space-between; font-size:10px;"><span>GST</span><span>${opts.gst.toFixed(2)}</span></div>
  <div class="total"><span>Total</span><span>₹${opts.total.toFixed(2)}</span></div>
  ${opts.isWalkin && opts.paymentMode ? `<div style="margin-top:3px; font-size:10px;">Paid via ${escape(opts.paymentMode.toUpperCase())}</div>` : ""}
  <div class="foot">Thank you!</div>
</body></html>`;
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open(); doc.write(html); doc.close();
  const win = iframe.contentWindow!;
  setTimeout(() => {
    try { win.focus(); win.print(); } catch { /* ignore */ }
    setTimeout(() => { document.body.removeChild(iframe); }, 1000);
  }, 200);
}

function escape(s: string) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}