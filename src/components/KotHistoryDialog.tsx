/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Printer, Pencil, Trash2, Plus, Minus } from "lucide-react";
import { inr } from "@/lib/billing";
import { useAuth, hasRole } from "@/hooks/use-auth";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import {
  buildKotPrintPlan,
  renderKotHtml,
  runKotPrintJobs,
  printThermalHtml,
  type KotItemForPrint,
  type PrinterInfo,
} from "@/lib/kotPrint";
import { reportQueryError } from "@/lib/queryError";
import { toastError } from "@/lib/errorMessage";

export type SegmentKind = "food" | "laundry";

interface ItemRow {
  id: string;
  segment_bill_id: string;
  description: string;
  qty: number;
  rate: number;
  amount: number;
  gst_rate: number;
  gst_amount: number;
  note: string | null;
  created_at: string;
}

interface BillRow {
  id: string;
  bill_number: string;
  status: string;
  created_at: string;
}

interface Punch {
  key: string;
  bill: BillRow;
  at: string;
  items: ItemRow[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  segment: SegmentKind;
  propertyId: string;
  roomId: string | null;
  roomNumber: string | null;
  guestName: string | null;
  bookingId?: string | null;
  onChanged?: () => void;
}

/** Group key — punches are all items written in the same second. */
function punchKey(billId: string, createdAt: string) {
  return `${billId}|${new Date(createdAt).toISOString().slice(0, 19)}`;
}

async function fetchKotPrinter(propertyId: string) {
  const { data, error: __qe1 } = await supabase
    .from("printers")
    .select("name,paper_size,type,is_default")
    .eq("property_id", propertyId)
    .eq("is_active", true)
    .in("type", ["kot", "both"])
    .order("is_default", { ascending: false })
    .limit(1);
  if (__qe1) reportQueryError("printers", __qe1);
  const row = data?.[0] as { name?: string; paper_size?: string | null } | undefined;
  if (!row?.name) return null;
  return { name: row.name, paper_size: (row.paper_size as string) ?? "80mm" };
}

async function recalcBillTotals(billId: string) {
  const { data: items, error } = await supabase
    .from("segment_bill_items" as any)
    .select("amount,gst_amount")
    .eq("segment_bill_id", billId);
  if (error) throw error;
  const sub = (items ?? []).reduce((s: number, i: any) => s + Number(i.amount || 0), 0);
  const gst = (items ?? []).reduce((s: number, i: any) => s + Number(i.gst_amount || 0), 0);
  const total = Math.round((sub + gst) * 100) / 100;
  const { error: uErr } = await supabase
    .from("segment_bills" as any)
    .update({ total_amount: total, gst_amount: Math.round(gst * 100) / 100 })
    .eq("id", billId);
  if (uErr) throw uErr;
}

export function KotHistoryDialog({
  open, onClose, segment, propertyId, roomId, roomNumber, guestName, bookingId, onChanged,
}: Props) {
  const { user, roles } = useAuth();
  const isOwner = hasRole(roles, "owner") || hasRole(roles, "superadmin");
  const ticketWord = segment === "food" ? "KOT" : "Ticket";

  const [loading, setLoading] = useState(false);
  const [punches, setPunches] = useState<Punch[]>([]);
  const [editing, setEditing] = useState<Punch | null>(null);
  const [draft, setDraft] = useState<ItemRow[]>([]);
  const [delTarget, setDelTarget] = useState<Punch | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!open || !propertyId) return;
    setLoading(true);
    try {
      // Phase 53 — scope STRICTLY to the room that was tapped. room_id is the
      // hard filter (never replaced by booking_id, which can span rooms), and
      // booking_id further narrows to the current guest's stay when known.
      if (!roomId) { setPunches([]); return; }
      let qb = supabase
        .from("segment_bills" as any)
        .select("id,bill_number,status,created_at,room_id,booking_id")
        .eq("property_id", propertyId)
        .eq("segment", segment)
        .eq("room_id", roomId);
      if (bookingId) qb = qb.eq("booking_id", bookingId);
      const { data: bills, error } = await qb.order("created_at", { ascending: false }).limit(10);
      if (error) throw error;
      const billRows = (bills ?? []) as unknown as BillRow[];
      if (billRows.length === 0) { setPunches([]); return; }
      const { data: items, error: iErr } = await supabase
        .from("segment_bill_items" as any)
        .select("id,segment_bill_id,description,qty,rate,amount,gst_rate,gst_amount,note,created_at")
        .in("segment_bill_id", billRows.map((b) => b.id))
        .order("created_at", { ascending: true });
      if (iErr) throw iErr;
      const byBill = new Map(billRows.map((b) => [b.id, b]));
      const grouped = new Map<string, Punch>();
      for (const raw of (items ?? []) as unknown as ItemRow[]) {
        const bill = byBill.get(raw.segment_bill_id);
        if (!bill) continue;
        const k = punchKey(raw.segment_bill_id, raw.created_at);
        const existing = grouped.get(k);
        if (existing) existing.items.push(raw);
        else grouped.set(k, { key: k, bill, at: raw.created_at, items: [raw] });
      }
      setPunches(Array.from(grouped.values()).sort((a, b) => b.at.localeCompare(a.at)));
    } catch (e: any) {
      toastError(e, "Failed to load punches");
    } finally {
      setLoading(false);
    }
  }, [open, propertyId, segment, bookingId, roomId]);

  useEffect(() => { void load(); }, [load]);

  async function reprint(p: Punch) {
    try {
      const itemNames = [...new Set(p.items.map((i) => i.description.trim()).filter(Boolean))];
      const [printerResult, menuResult] = await Promise.all([
        supabase
          .from("printers")
          .select("id,name,paper_size,printer_role")
          .eq("property_id", propertyId)
          .eq("is_active", true),
        segment === "food" && itemNames.length > 0
          ? supabase
              .from("menu_items")
              .select("name,kitchen_printer_id,menu_categories(kot_printer_id)")
              .eq("property_id", propertyId)
              .in("name", itemNames)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (printerResult.error) throw printerResult.error;
      if (menuResult.error) throw menuResult.error;

      const printers = (printerResult.data ?? []) as PrinterInfo[];
      const printerByName = new Map(
        (menuResult.data ?? []).map((m: any) => [
          String(m.name),
          (m.kitchen_printer_id ?? m.menu_categories?.kot_printer_id ?? null) as string | null,
        ]),
      );
      const items: KotItemForPrint[] = p.items.map((i) => ({
        item_name: i.description,
        qty: Number(i.qty),
        rate: Number(i.rate),
        printer_id: printerByName.get(i.description.trim()) ?? null,
        notes: i.note,
      }));
      const header = {
        kot_number: p.bill.bill_number,
        kot_type: roomNumber ? "room" : "table",
        room_number: roomNumber,
        guest_name: guestName,
        notes: null,
        created_at: p.at,
      };

      if (segment === "food") {
        const { jobs, warnings, unroutedItems } = buildKotPrintPlan(items, printers, null, "kitchen");
        warnings.forEach((warning) =>
          unroutedItems.length > 0 && warning.includes("no kitchen printer")
            ? toast.error(warning, { duration: 15000 })
            : toast.warning(warning),
        );
        if (jobs.length === 0) throw new Error("No assigned station printer found for this KOT");
        await runKotPrintJobs(header, jobs);
        toast.success(`${ticketWord} reprint sent to ${jobs.map((job) => job.printer.name).join(", ")}`);
        return;
      }

      const printer = await fetchKotPrinter(propertyId);
      const html = renderKotHtml(
        header,
        items,
        printer?.paper_size ?? "80mm",
        "KITCHEN COPY",
        printer?.name ?? "LAUNDRY",
      );
      await printThermalHtml({
        printerName: printer?.name ?? null,
        html,
        paperSize: printer?.paper_size ?? "80mm",
        label: `${ticketWord} reprint`,
      });
      toast.success(`${ticketWord} reprint sent${printer?.name ? ` to ${printer.name}` : ""}`);
    } catch (e: any) {
      toastError(e, "Reprint failed");
    }
  }

  function startEdit(p: Punch) {
    setEditing(p);
    setDraft(p.items.map((i) => ({ ...i })));
  }

  function patchDraft(id: string, patch: Partial<ItemRow>) {
    setDraft((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    try {
      for (const row of draft) {
        const original = editing.items.find((i) => i.id === row.id);
        const qty = Number(row.qty) || 0;
        const rate = Number(row.rate) || 0;
        const amount = Math.round(qty * rate * 100) / 100;
        const gstAmount = Math.round((amount * Number(row.gst_rate || 0)) / 100 * 100) / 100;
        const desc = row.description.trim();
        if (!desc || qty <= 0) { toast.error("Item name and quantity are required"); setBusy(false); return; }
        const unchanged = original
          && original.description === desc
          && Number(original.qty) === qty
          && Number(original.rate) === rate
          && (original.note ?? "") === (row.note ?? "");
        if (unchanged) continue;
        const { error } = await supabase
          .from("segment_bill_items" as any)
          .update({ description: desc, qty, rate, amount, gst_amount: gstAmount, note: (row.note ?? "").trim() || null })
          .eq("id", row.id);
        if (error) throw error;
      }
      await recalcBillTotals(editing.bill.id);
      await supabase.rpc("log_owner_override" as any, {
        _property_id: propertyId,
        _table_name: "segment_bill_items",
        _record_id: editing.bill.id,
        _action: "KOT_PUNCH_EDITED",
        _old: { bill_number: editing.bill.bill_number, items: editing.items },
        _new: { items: draft },
        _reason: `${ticketWord} punch edited from dashboard`,
      } as any);
      await logActivity({
        property_id: propertyId,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "KOT_PUNCH_EDITED",
        module: segment,
        reference_id: editing.bill.id,
        reference_label: editing.bill.bill_number,
        details: { room: roomNumber, punch_at: editing.at, items: draft.map((d) => ({ description: d.description, qty: d.qty, rate: d.rate })) },
      });
      toast.success("Punch updated");
      setEditing(null);
      await load();
      onChanged?.();
    } catch (e: any) {
      toastError(e, "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!delTarget) return;
    setBusy(true);
    try {
      const { error } = await supabase
        .from("segment_bill_items" as any)
        .delete()
        .in("id", delTarget.items.map((i) => i.id));
      if (error) throw error;
      await recalcBillTotals(delTarget.bill.id);
      await supabase.rpc("log_owner_override" as any, {
        _property_id: propertyId,
        _table_name: "segment_bill_items",
        _record_id: delTarget.bill.id,
        _action: "KOT_PUNCH_DELETED",
        _old: { bill_number: delTarget.bill.bill_number, items: delTarget.items },
        _new: {},
        _reason: `${ticketWord} punch deleted from dashboard`,
      } as any);
      await logActivity({
        property_id: propertyId,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "KOT_PUNCH_DELETED",
        module: segment,
        reference_id: delTarget.bill.id,
        reference_label: delTarget.bill.bill_number,
        details: { room: roomNumber, punch_at: delTarget.at, items: delTarget.items.map((d) => ({ description: d.description, qty: d.qty, rate: d.rate })) },
      });
      toast.success("Punch deleted");
      setDelTarget(null);
      await load();
      onChanged?.();
    } catch (e: any) {
      toastError(e, "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {segment === "food" ? "Food" : "Laundry"} punches
              {roomNumber ? ` — Room ${roomNumber}` : ""}
            </DialogTitle>
          </DialogHeader>

          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && punches.length === 0 && (
            <p className="text-sm text-muted-foreground">No {ticketWord} punches recorded yet.</p>
          )}

          <div className="space-y-3">
            {punches.map((p) => {
              const total = p.items.reduce((s, i) => s + Number(i.amount || 0) + Number(i.gst_amount || 0), 0);
              return (
                <div key={p.key} className="rounded-md border p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{p.bill.bill_number}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{p.bill.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(p.at).toLocaleString("en-IN", { hour12: false })}
                    </span>
                    <span className="ml-auto text-sm font-medium">{inr(total)}</span>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {p.items.map((i) => (
                      <li key={i.id} className="text-sm flex gap-2">
                        <span className="font-medium">{i.qty} ×</span>
                        <span className="flex-1">
                          {i.description}
                          {i.note && <span className="block text-xs text-muted-foreground">** {i.note}</span>}
                        </span>
                        <span className="text-muted-foreground">{inr(Number(i.amount))}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => reprint(p)}>
                      <Printer className="h-3.5 w-3.5 mr-1" /> Reprint
                    </Button>
                    {isOwner && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive" onClick={() => setDelTarget(p)}>
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit punch — {editing?.bill.bill_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {draft.map((i) => (
              <div key={i.id} className="rounded-md border p-2 space-y-2">
                <Input
                  value={i.description}
                  onChange={(e) => patchDraft(i.id, { description: e.target.value })}
                  placeholder="Item"
                />
                <div className="flex items-center gap-2">
                  <Button type="button" size="icon" variant="outline" className="h-8 w-8"
                    onClick={() => patchDraft(i.id, { qty: Math.max(1, Number(i.qty) - 1) })}>
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <Input type="number" min={1} className="w-20 h-8" value={i.qty}
                    onChange={(e) => patchDraft(i.id, { qty: Number(e.target.value) })} />
                  <Button type="button" size="icon" variant="outline" className="h-8 w-8"
                    onClick={() => patchDraft(i.id, { qty: Number(i.qty) + 1 })}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Input type="number" min={0} step="0.01" className="w-28 h-8" value={i.rate}
                    onChange={(e) => patchDraft(i.id, { rate: Number(e.target.value) })} />
                  <span className="text-xs text-muted-foreground">rate</span>
                </div>
                <Input
                  value={i.note ?? ""}
                  onChange={(e) => patchDraft(i.id, { note: e.target.value })}
                  placeholder="Instruction (prints on ticket only)"
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</Button>
            <Button onClick={saveEdit} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!delTarget} onOpenChange={(o) => { if (!o) setDelTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this punch?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {delTarget?.items.length} item(s) from {delTarget?.bill.bill_number} will be removed and the bill total
            recalculated. This action is logged.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelTarget(null)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {busy ? "Deleting…" : "Delete punch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}