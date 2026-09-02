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

interface Props {
  open: boolean;
  onClose: () => void;
  propertyId: string;
  billId: string | null;
  billNumber: string | null;
  amount: number;
  segment: "food" | "laundry";
  onSettled?: () => void;
}

export function SettleFoodBillDialog({
  open, onClose, propertyId, billId, billNumber, amount, segment, onSettled,
}: Props) {
  const { user } = useAuth();
  const { methods } = usePaymentMethods(propertyId);
  const [mode, setMode] = useState<string>("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRef("");
    setMode((prev) => prev || methods[0]?.name || "cash");
  }, [open, methods]);

  async function submit() {
    if (!billId) return;
    if (!mode) { toast.error("Select a payment mode"); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc(
        "settle_segment_bill_with_payment" as any,
        { _bill_id: billId, _mode: mode, _reference_no: ref || null, _actor: user?.id ?? null } as any,
      );
      if (error) throw error;
      const res = data as any;
      if (!res?.ok) {
        const reason = res?.reason;
        throw new Error(
          reason === "no_items" ? "This bill has no items yet"
            : reason === "not_open" ? "This bill is already settled"
            : reason === "walkin_not_supported" ? "Walk-in bills use the counter settlement flow"
            : "Could not settle this bill",
        );
      }
      toast.success(`${res.bill_number} settled — ${inr(Number(res.total_amount))} collected`);
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
            Collects payment now. The room stays open and checkout is unaffected.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md border p-3">
            <span className="text-sm text-muted-foreground">Amount due</span>
            <span className="text-lg font-semibold">{inr(amount)}</span>
          </div>
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || amount <= 0}>
            {busy ? "Settling…" : `Collect ${inr(amount)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
