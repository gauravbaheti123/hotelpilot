/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 62 — owner-level Edit / Delete for a whole Food/Laundry segment bill,
// surfaced from the Invoices list. Reuses the same audit pattern as Phase 47's
// View KOT list (log_owner_override + activity_log) and keeps every dependent
// total in sync: bill totals, mirrored folio_charges and the folio balance.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Trash2, AlertTriangle } from "lucide-react";
import { inr } from "@/lib/billing";
import { useAuth } from "@/hooks/use-auth";
import { logActivity, userDisplayName } from "@/lib/activityLog";

export interface SegmentBillTarget {
  id: string;
  bill_number: string;
  segment: string;
  status: string;
  total_amount: number;
  paid_amount: number;
  folio_id?: string | null;
  booking_id?: string | null;
}

interface ItemRow {
  id: string;
  description: string;
  qty: number;
  rate: number;
  amount: number;
  gst_rate: number;
  gst_amount: number;
  note: string | null;
}

/** A bill is "locked" once it has been settled / posted — deletes then need a reason. */
export function isLockedSegmentBill(b: { status: string; paid_amount?: number }) {
  const s = (b.status ?? "").toLowerCase();
  return s === "settled" || s === "paid" || s === "closed" || Number(b.paid_amount ?? 0) > 0;
}

async function recalcSegmentBill(billId: string) {
  const { data: items, error } = await supabase
    .from("segment_bill_items" as any)
    .select("amount,gst_amount")
    .eq("segment_bill_id", billId);
  if (error) throw error;
  const sub = (items ?? []).reduce((s: number, i: any) => s + Number(i.amount || 0), 0);
  const gst = (items ?? []).reduce((s: number, i: any) => s + Number(i.gst_amount || 0), 0);
  const { error: uErr } = await supabase
    .from("segment_bills" as any)
    .update({
      total_amount: Math.round((sub + gst) * 100) / 100,
      gst_amount: Math.round(gst * 100) / 100,
    })
    .eq("id", billId);
  if (uErr) throw uErr;
}

/** Keep the folio mirror of this bill in step, then re-sync the folio balance. */
async function syncFolioMirror(bill: SegmentBillTarget, items: ItemRow[], mode: "replace" | "remove") {
  const { data: existing } = await supabase
    .from("folio_charges")
    .select("id,folio_id")
    .eq("source_table", "segment_bills")
    .eq("source_id", bill.id);
  const mirrored = (existing ?? []) as any[];
  const folioId = mirrored[0]?.folio_id ?? bill.folio_id ?? null;
  if (mirrored.length > 0) {
    const { error } = await supabase.from("folio_charges").delete().in("id", mirrored.map((r) => r.id));
    if (error) throw error;
  }
  if (mode === "replace" && folioId && items.length > 0) {
    const chargeType = bill.segment === "food" ? "food" : "laundry";
    const rows = items.map((i) => ({
      folio_id: folioId,
      charge_type: chargeType,
      description: `${i.description} (${bill.bill_number})`,
      qty: i.qty,
      rate: i.rate,
      amount: i.amount,
      gst_rate: i.gst_rate,
      gst_amount: i.gst_amount,
      source_table: "segment_bills",
      source_id: bill.id,
      segment_bill_ref: bill.bill_number,
    }));
    const { error } = await supabase.from("folio_charges").insert(rows as any);
    if (error) throw error;
  }
  if (folioId) {
    await supabase.rpc("recompute_folio_totals" as any, { _folio_id: folioId } as any);
  }
}

export function SegmentBillEditDialog({
  bill, propertyId, open, onClose, onSaved,
}: {
  bill: SegmentBillTarget | null;
  propertyId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [items, setItems] = useState<ItemRow[]>([]);
  const [original, setOriginal] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open || !bill) return;
    setReason("");
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("segment_bill_items" as any)
        .select("id,description,qty,rate,amount,gst_rate,gst_amount,note")
        .eq("segment_bill_id", bill.id)
        .order("created_at", { ascending: true });
      setLoading(false);
      if (error) return toast.error(error.message);
      const rows = (data ?? []) as any as ItemRow[];
      setItems(rows.map((r) => ({ ...r })));
      setOriginal(rows.map((r) => ({ ...r })));
    })();
  }, [open, bill?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function patch(id: string, p: Partial<ItemRow>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));
  }

  const sub = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.rate) || 0), 0);
  const gst = items.reduce(
    (s, i) => s + ((Number(i.qty) || 0) * (Number(i.rate) || 0) * Number(i.gst_rate || 0)) / 100, 0);

  async function save() {
    if (!bill) return;
    const locked = isLockedSegmentBill(bill);
    if (locked && !reason.trim()) return toast.error("A reason is required to edit a settled bill");
    setBusy(true);
    try {
      const finalItems: ItemRow[] = [];
      for (const row of items) {
        const desc = row.description.trim();
        const qty = Number(row.qty) || 0;
        const rate = Number(row.rate) || 0;
        if (!desc || qty <= 0) { toast.error("Item name and quantity are required"); setBusy(false); return; }
        const amount = Math.round(qty * rate * 100) / 100;
        const gstAmount = Math.round((amount * Number(row.gst_rate || 0)) / 100 * 100) / 100;
        const next = { ...row, description: desc, qty, rate, amount, gst_amount: gstAmount };
        finalItems.push(next);
        const { error } = await supabase
          .from("segment_bill_items" as any)
          .update({
            description: desc, qty, rate, amount, gst_amount: gstAmount,
            note: (row.note ?? "").trim() || null,
          })
          .eq("id", row.id);
        if (error) throw error;
      }
      await recalcSegmentBill(bill.id);
      await syncFolioMirror(bill, finalItems, "replace");
      await supabase.rpc("log_owner_override" as any, {
        _property_id: propertyId,
        _table_name: "segment_bills",
        _record_id: bill.id,
        _action: "SEGMENT_BILL_EDITED",
        _old: { bill_number: bill.bill_number, total: bill.total_amount, items: original },
        _new: { items: finalItems },
        _reason: reason.trim() || "Bill edited from Invoices list",
      } as any);
      await logActivity({
        property_id: propertyId,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "SEGMENT_BILL_EDITED",
        module: "Billing",
        reference_id: bill.id,
        reference_label: bill.bill_number,
        details: {
          segment: bill.segment,
          reason: reason.trim() || null,
          old_total: Number(bill.total_amount),
          new_total: Math.round((sub + gst) * 100) / 100,
        },
      });
      toast.success(`Bill ${bill.bill_number} updated`);
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    } finally {
      setBusy(false);
    }
  }

  const locked = bill ? isLockedSegmentBill(bill) : false;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit bill {bill?.bill_number}
            {locked && <Badge variant="outline" className="text-[10px] uppercase">Settled</Badge>}
          </DialogTitle>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">Loading items…</p>}
        {!loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">This bill has no line items.</p>
        )}
        {!loading && items.length > 0 && (
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <div className="col-span-5">Item</div>
              <div className="col-span-2">Qty</div>
              <div className="col-span-2">Rate</div>
              <div className="col-span-3">Note</div>
            </div>
            {items.map((i) => (
              <div key={i.id} className="grid grid-cols-12 gap-2 items-center">
                <Input className="col-span-5 h-8" value={i.description}
                  onChange={(e) => patch(i.id, { description: e.target.value })} />
                <Input className="col-span-2 h-8" type="number" min={0} value={i.qty}
                  onChange={(e) => patch(i.id, { qty: Number(e.target.value) })} />
                <Input className="col-span-2 h-8" type="number" min={0} value={i.rate}
                  onChange={(e) => patch(i.id, { rate: Number(e.target.value) })} />
                <Input className="col-span-3 h-8" value={i.note ?? ""}
                  onChange={(e) => patch(i.id, { note: e.target.value })} placeholder="—" />
              </div>
            ))}
            <div className="text-right text-sm pt-2 border-t">
              Sub {inr(sub)} · GST {inr(gst)} · <b>Total {inr(sub + gst)}</b>
            </div>
          </div>
        )}
        <div>
          <Label className="text-xs">Reason {locked ? "(required — settled bill)" : "(optional)"}</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this bill being changed?" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || loading || items.length === 0}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SegmentBillDeleteDialog({
  bill, propertyId, open, onClose, onDeleted,
}: {
  bill: SegmentBillTarget | null;
  propertyId: string;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { user } = useAuth();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setReason(""); }, [open]);
  const locked = bill ? isLockedSegmentBill(bill) : false;

  async function confirm() {
    if (!bill) return;
    if (locked && !reason.trim()) return toast.error("A reason is required to delete a settled bill");
    setBusy(true);
    try {
      const { data: items } = await supabase
        .from("segment_bill_items" as any)
        .select("id,description,qty,rate,amount,gst_rate,gst_amount,note")
        .eq("segment_bill_id", bill.id);
      const snapshot = (items ?? []) as any as ItemRow[];
      // Drop the folio mirror first and re-sync the folio balance.
      await syncFolioMirror(bill, [], "remove");
      const { error } = await supabase.from("segment_bills" as any).delete().eq("id", bill.id);
      if (error) throw error;
      await supabase.rpc("log_owner_override" as any, {
        _property_id: propertyId,
        _table_name: "segment_bills",
        _record_id: bill.id,
        _action: "SEGMENT_BILL_DELETED",
        _old: { bill: bill, items: snapshot },
        _new: {},
        _reason: reason.trim() || "Bill deleted from Invoices list",
      } as any);
      await logActivity({
        property_id: propertyId,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "SEGMENT_BILL_DELETED",
        module: "Billing",
        reference_id: bill.id,
        reference_label: bill.bill_number,
        details: {
          segment: bill.segment, amount: Number(bill.total_amount),
          settled: locked, reason: reason.trim() || null, items: snapshot,
        },
      });
      toast.success(`Bill ${bill.bill_number} deleted`);
      onDeleted();
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" /> Delete bill {bill?.bill_number}?
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This removes the bill and all its line items{locked ? ", reverses the posted folio charges" : ""} and
          re-syncs the folio balance. A full snapshot is kept in the audit log.
        </p>
        <div>
          <Label className="text-xs">Reason {locked ? "(required — settled bill)" : "(optional)"}</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={confirm} disabled={busy || (locked && !reason.trim())}>
            <Trash2 className="h-4 w-4 mr-1" /> {busy ? "Deleting…" : "Delete bill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
