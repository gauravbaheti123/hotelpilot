/* eslint-disable @typescript-eslint/no-explicit-any */
// Standalone food/laundry bill settlement — collects payment for a running
// in-house segment bill mid-stay, without touching room/checkout state.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { inr } from "@/lib/billing";
import { useAuth } from "@/hooks/use-auth";
import { usePaymentMethods, formatPaymentMethodLabel } from "@/hooks/use-payment-methods";
import { toastError } from "@/lib/errorMessage";
import { printSegmentBill } from "@/components/PunchChargeDialog";
import {
  COMPLIMENTARY_PRESETS, COMPLIMENTARY_OTHER, canMarkComplimentary,
} from "@/lib/complimentary";
import { Textarea } from "@/components/ui/textarea";


interface Props {
  open: boolean;
  onClose: () => void;
  propertyId: string;
  billId: string | null;
  /** All open bills covered by `amount` (tables can carry more than one). */
  billIds?: string[];
  billNumber: string | null;
  amount: number;
  segment: "food" | "laundry";
  /** Counter/table walk-in bill — no room folio involved. */
  walkin?: boolean;
  /** Printed on the counter receipt when settling a walk-in bill. */
  propertyName?: string | null;
  guestLabel?: string | null;
  onSettled?: () => void;
}

export function SettleFoodBillDialog({
  open, onClose, propertyId, billId, billIds, billNumber, amount, segment, walkin,
  propertyName, guestLabel, onSettled,
}: Props) {



  const { user, roles } = useAuth();
  const { methods } = usePaymentMethods(propertyId);
  const [mode, setMode] = useState<string>("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [compOpen, setCompOpen] = useState(false);
  const [compPreset, setCompPreset] = useState<string>(COMPLIMENTARY_PRESETS[0]);
  const [compOther, setCompOther] = useState("");
  const mayComp = canMarkComplimentary(roles as string[]);

  useEffect(() => {
    if (!open) return;
    setRef("");
    setCompOpen(false);
    setCompPreset(COMPLIMENTARY_PRESETS[0]);
    setCompOther("");
    setMode((prev) => prev || methods[0]?.name || "cash");
  }, [open, methods]);

  function targetBillIds(): string[] {
    return (billIds && billIds.length > 0 ? billIds : billId ? [billId] : []).filter(
      (v, i, a) => a.indexOf(v) === i,
    );
  }

  /**
   * Close the bill(s) as complimentary — nothing is collected and nothing is
   * posted to the room folio. A reason is mandatory and audited server-side.
   */
  async function markComplimentary() {
    const targets = targetBillIds();
    if (targets.length === 0) return;
    const reason = (compPreset === COMPLIMENTARY_OTHER ? compOther : compPreset).trim();
    if (!reason) { toast.error("Enter a reason"); return; }
    setBusy(true);
    try {
      const settled: { id: string; bill_number: string; total: number }[] = [];
      for (const id of targets) {
        const { data, error } = await supabase.rpc(
          "settle_segment_bill_complimentary" as any,
          { _bill_id: id, _reason: reason, _actor: user?.id ?? null } as any,
        );
        if (error) throw error;
        const res = data as any;
        if (!res?.ok) {
          const r = res?.reason;
          if (r === "no_items" && targets.length > 1) continue;
          throw new Error(
            r === "no_items" ? "This bill has no items yet"
              : r === "reason_required" ? "Enter a reason"
              : r === "not_allowed" ? "You do not have access to this property"
              : "Could not mark this bill complimentary",
          );
        }
        settled.push({ id, bill_number: res.bill_number, total: Number(res.total_amount || 0) });
      }
      if (settled.length === 0) throw new Error("This bill has no items yet");

      if (walkin) {
        for (const s of settled) {
          try {
            const [{ data: items }, { data: billRow }] = await Promise.all([
              supabase.from("segment_bill_items" as any)
                .select("description,qty,rate,amount,gst_rate,gst_amount")
                .eq("segment_bill_id", s.id).order("id"),
              supabase.from("segment_bills" as any)
                .select("settled_at,created_at,guest_name")
                .eq("id", s.id).maybeSingle(),
            ]);
            const rows = (items ?? []) as any[];
            const sub = rows.reduce((acc, i) => acc + Number(i.amount || 0), 0);
            const gst = rows.reduce((acc, i) => acc + Number(i.gst_amount || 0), 0);
            printSegmentBill({
              billNumber: s.bill_number,
              segment,
              propertyName: propertyName ?? "",
              propertyId,
              guestName: guestLabel || (billRow as any)?.guest_name || "Walk-in Guest",
              roomNumber: null,
              items: rows.map((i) => ({
                description: i.description, qty: Number(i.qty), rate: Number(i.rate),
                amount: Number(i.amount), gst_rate: Number(i.gst_rate),
              })),
              sub: Math.round(sub * 100) / 100,
              gst: Math.round(gst * 100) / 100,
              total: Math.round((sub + gst) * 100) / 100,
              isWalkin: true,
              paymentMode: "complimentary",
              complimentaryReason: reason,
              billDate: (billRow as any)?.settled_at ?? (billRow as any)?.created_at ?? null,
            });
          } catch (pe: any) {
            toastError(pe, "Bill printed failed — settlement is saved");
          }
        }
      }

      toast.success(
        settled.length === 1
          ? `${settled[0].bill_number} settled as complimentary`
          : `${settled.length} bills settled as complimentary`,
      );
      onSettled?.();
      onClose();
    } catch (e: any) {
      toastError(e, "Could not mark complimentary");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!billId) return;
    if (!mode) { toast.error("Select a payment mode"); return; }
    // The amount shown covers every open bill on this table/room segment, so
    // settle them all — closing only one would leave the table occupied and
    // the collected cash unaccounted for.
    const targets = (billIds && billIds.length > 0 ? billIds : [billId]).filter(
      (v, i, a) => a.indexOf(v) === i,
    );
    setBusy(true);
    try {
      const settled: { id: string; bill_number: string; total: number }[] = [];
      for (const id of targets) {
        const { data, error } = await supabase.rpc(
          "settle_segment_bill_with_payment" as any,
          { _bill_id: id, _mode: mode, _reference_no: ref || null, _actor: user?.id ?? null } as any,
        );
        if (error) throw error;
        const res = data as any;
        if (!res?.ok) {
          const reason = res?.reason;
          // A stale duplicate with nothing on it must not block the rest.
          if (reason === "no_items" && targets.length > 1) continue;
          throw new Error(
            reason === "no_items" ? "This bill has no items yet"
              : reason === "not_open" ? "This bill is already settled"
              : reason === "mode_required" ? "Select a payment mode"
              : "Could not settle this bill",
          );
        }
        settled.push({ id, bill_number: res.bill_number, total: Number(res.total_amount || 0) });
      }
      if (settled.length === 0) throw new Error("This bill has no items yet");

      // Counter bills get their customer receipt printed on settlement.
      if (walkin) {
        for (const s of settled) {
          try {
            const [{ data: items }, { data: billRow }] = await Promise.all([
              supabase.from("segment_bill_items" as any)
                .select("description,qty,rate,amount,gst_rate,gst_amount")
                .eq("segment_bill_id", s.id).order("id"),
              supabase.from("segment_bills" as any)
                .select("settled_at,created_at,guest_name")
                .eq("id", s.id).maybeSingle(),
            ]);
            const rows = (items ?? []) as any[];
            const sub = rows.reduce((acc, i) => acc + Number(i.amount || 0), 0);
            const gst = rows.reduce((acc, i) => acc + Number(i.gst_amount || 0), 0);
            printSegmentBill({
              billNumber: s.bill_number,
              segment,
              propertyName: propertyName ?? "",
              propertyId,
              guestName: guestLabel || (billRow as any)?.guest_name || "Walk-in Guest",
              roomNumber: null,
              items: rows.map((i) => ({
                description: i.description, qty: Number(i.qty), rate: Number(i.rate),
                amount: Number(i.amount), gst_rate: Number(i.gst_rate),
              })),
              sub: Math.round(sub * 100) / 100,
              gst: Math.round(gst * 100) / 100,
              total: Math.round((sub + gst) * 100) / 100,
              isWalkin: true,
              paymentMode: mode,
              billDate: (billRow as any)?.settled_at ?? (billRow as any)?.created_at ?? null,
            });
          } catch (pe: any) {
            toastError(pe, "Bill printed failed — settlement is saved");
          }
        }
      }

      const collected = settled.reduce((acc, s) => acc + s.total, 0);
      toast.success(
        settled.length === 1
          ? `${settled[0].bill_number} settled — ${inr(collected)} collected`
          : `${settled.length} bills settled — ${inr(collected)} collected`,
      );
      onSettled?.();
      onClose();

    } catch (e: any) {
      toastError(e, "Failed to settle bill");
    } finally {
      setBusy(false);
    }
  }

  const label = segment === "food" ? "food" : "laundry";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settle {label} bill{billNumber ? ` — ${billNumber}` : ""}</DialogTitle>
          <DialogDescription>
            {walkin
              ? "Collects payment at the counter and closes this bill, freeing the table."
              : "Collects payment now. The room stays open and checkout is unaffected."}
          </DialogDescription>

        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border p-3">
            <span className="text-sm text-muted-foreground">Amount due</span>
            <span className="text-lg font-semibold">{inr(amount)}</span>
          </div>
          {compOpen ? (
            <div className="space-y-2 rounded-md border p-3">
              <Label className="text-xs">Reason (required)</Label>
              <Select value={compPreset} onValueChange={setCompPreset}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMPLIMENTARY_PRESETS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                  <SelectItem value={COMPLIMENTARY_OTHER}>{COMPLIMENTARY_OTHER}</SelectItem>
                </SelectContent>
              </Select>
              {compPreset === COMPLIMENTARY_OTHER && (
                <Textarea
                  value={compOther}
                  onChange={(e) => setCompOther(e.target.value)}
                  placeholder="Type the reason"
                  rows={2}
                />
              )}
              <p className="text-xs text-muted-foreground">
                No amount is collected and nothing is posted to the room bill.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Payment mode</Label>
                <Select value={mode} onValueChange={setMode}>
                  <SelectTrigger><SelectValue placeholder="Select mode" /></SelectTrigger>
                  <SelectContent>
                    {methods.map((m) => (
                      <SelectItem key={m.id} value={m.name}>{formatPaymentMethodLabel(m.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Reference (optional)</Label>
                <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UPI / card ref" />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {mayComp ? (
            <Button
              variant="outline"
              onClick={() => setCompOpen((v) => !v)}
              disabled={busy}
            >
              {compOpen ? "Collect payment instead" : "Mark Complimentary"}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            {compOpen ? (
              <Button onClick={markComplimentary} disabled={busy}>
                {busy ? "Working…" : "Confirm Complimentary"}
              </Button>
            ) : (
              <Button onClick={submit} disabled={busy || amount <= 0}>
                {busy ? "Settling…" : `Collect ${inr(amount)}`}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
