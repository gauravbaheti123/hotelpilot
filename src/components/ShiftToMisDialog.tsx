/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { inr, recomputeFolio } from "@/lib/billing";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { Loader2, ArrowRightLeft } from "lucide-react";

interface ChargeRow {
  id: string;
  charge_type: string;
  description: string;
  amount: number;
  gst_amount?: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  folio: {
    id: string;
    invoice_number: string;
    property_id: string;
    gst_mode: string;
  } | null;
  booking: {
    id: string;
    booking_number?: string;
    guests?: { id?: string | null; name?: string | null } | null;
    booking_rooms?: { rooms?: { room_number?: string | null } | null }[];
  } | null;
  charges: ChargeRow[];
  /** Pre-select all food items on open (used from Checkout). */
  preselectFoodOnly?: boolean;
  onShifted?: () => void;
}

export function ShiftToMisDialog({
  open, onOpenChange, folio, booking, charges, preselectFoodOnly, onShifted,
}: Props) {
  const { user } = useAuth();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (preselectFoodOnly) {
      const m: Record<string, boolean> = {};
      charges.forEach((c) => { if (c.charge_type === "food") m[c.id] = true; });
      setSelected(m);
    } else {
      setSelected({});
    }
    setReason("");
  }, [open, preselectFoodOnly, charges]);

  const selectedRows = useMemo(
    () => charges.filter((c) => selected[c.id] && c.charge_type !== "discount"),
    [charges, selected],
  );
  const total = selectedRows.reduce((s, c) => s + Number(c.amount), 0);

  function selectAllFood() {
    const m: Record<string, boolean> = { ...selected };
    charges.forEach((c) => { if (c.charge_type === "food") m[c.id] = true; });
    setSelected(m);
  }
  function selectAll() {
    const m: Record<string, boolean> = {};
    charges.forEach((c) => { if (c.charge_type !== "discount") m[c.id] = true; });
    setSelected(m);
  }
  function clearAll() { setSelected({}); }

  async function confirmShift() {
    if (!folio || !booking) return;
    if (selectedRows.length === 0) return toast.error("Select at least one charge");
    setBusy(true);
    try {
      // 1. Resolve MIS account
      const { data: misAcc } = await supabase.from("mis_accounts" as any)
        .select("id").eq("property_id", folio.property_id).maybeSingle();
      let misAccountId = (misAcc as any)?.id as string | undefined;
      if (!misAccountId) {
        const { data: created, error: cErr } = await supabase.from("mis_accounts" as any)
          .insert({ property_id: folio.property_id } as any).select("id").single();
        if (cErr) throw cErr;
        misAccountId = (created as any).id;
      }

      // 2. Build mis_ledger insert
      const lineItems = selectedRows.map((c) => ({
        name: c.description, amount: Number(c.amount), charge_type: c.charge_type,
      }));
      const roomNumber = booking.booking_rooms?.[0]?.rooms?.room_number ?? null;
      const { error: misErr } = await supabase.from("mis_ledger" as any).insert({
        property_id: folio.property_id,
        mis_account_id: misAccountId,
        source_bill_id: folio.id,
        source_bill_number: folio.invoice_number,
        source_booking_id: booking.id,
        source_room_number: roomNumber,
        source_guest_name: booking.guests?.name ?? null,
        source_guest_id: booking.guests?.id ?? null,
        amount: total,
        description: reason || null,
        line_items: lineItems,
        shifted_by: user?.id ?? null,
        shifted_by_name: userDisplayName(user as any),
      } as any);
      if (misErr) throw misErr;

      // 3. Remove selected charges from folio
      const ids = selectedRows.map((c) => c.id);
      const { error: dErr } = await supabase.from("folio_charges")
        .delete().in("id", ids);
      if (dErr) throw dErr;

      // 4. Recompute folio totals
      const remaining = charges.filter((c) => !selected[c.id]);
      const gstMode = (folio.gst_mode as "cash" | "gst") ?? "cash";
      const t = recomputeFolio(remaining as any, gstMode);
      const { data: pays } = await supabase.from("payments")
        .select("amount").eq("folio_id", folio.id);
      const paid = (pays ?? []).reduce((s, p: any) => s + Number(p.amount), 0);
      await supabase.from("folios").update({
        ...t,
        paid_amount: paid,
        balance_amount: Math.max(0, t.total_amount - paid),
      } as any).eq("id", folio.id);

      // 5. Activity log
      logActivity({
        property_id: folio.property_id,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "MIS_TRANSFER",
        module: "MIS",
        reference_id: folio.id,
        reference_label: `${folio.invoice_number} — ${booking.guests?.name ?? ""}`,
        details: {
          bill_number: folio.invoice_number,
          amount: total,
          items_count: selectedRows.length,
          reason: reason || null,
        },
      });

      toast.success(`${inr(total)} shifted to MIS from ${folio.invoice_number}`);
      onOpenChange(false);
      onShifted?.();
    } catch (e: any) {
      toast.error(e.message ?? "Shift failed");
    } finally {
      setBusy(false);
    }
  }

  const shiftableCharges = charges.filter((c) => c.charge_type !== "discount");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" /> Shift Charges to MIS
          </DialogTitle>
        </DialogHeader>
        {!folio ? (
          <div className="py-8 text-center text-sm text-muted-foreground">No bill</div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Bill <span className="font-semibold">{folio.invoice_number}</span>
              {" · "}{booking?.guests?.name ?? "—"}
              {booking?.booking_rooms?.[0]?.rooms?.room_number
                ? ` · Room ${booking.booking_rooms[0].rooms.room_number}` : ""}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={selectAllFood}>Select All Food</Button>
              <Button size="sm" variant="outline" onClick={selectAll}>Select All</Button>
              <Button size="sm" variant="ghost" onClick={clearAll}>Clear</Button>
            </div>
            <div className="rounded border divide-y max-h-64 overflow-auto">
              {shiftableCharges.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">No charges on this bill.</div>
              ) : shiftableCharges.map((c) => (
                <label key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-accent">
                  <Checkbox
                    checked={!!selected[c.id]}
                    onCheckedChange={(v) => setSelected((s) => ({ ...s, [c.id]: !!v }))}
                  />
                  <span className="flex-1 min-w-0 truncate">
                    <span className="text-[10px] uppercase mr-2 text-muted-foreground">{c.charge_type}</span>
                    {c.description}
                  </span>
                  <span className="tabular-nums font-medium">{inr(c.amount)}</span>
                </label>
              ))}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Reason (optional)</Label>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. complimentary / written off / staff meal" />
            </div>
            <div className="flex justify-between items-center rounded-md bg-muted/40 px-3 py-2">
              <span className="text-sm font-medium">Amount to shift</span>
              <span className="text-lg font-bold tabular-nums">{inr(total)}</span>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={confirmShift} disabled={busy || selectedRows.length === 0}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Confirm Shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
