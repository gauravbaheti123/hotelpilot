import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { usePaymentMethods, formatPaymentMethodLabel } from "@/hooks/use-payment-methods";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { logActivity, userDisplayName, ACTIVITY } from "@/lib/activityLog";
import { toastError } from "@/lib/errorMessage";
import { billNo } from "@/lib/billNumber";
import { withinGraceWindow } from "@/lib/graceWindow";

export interface ChangePaymentModeFolio {
  id: string;
  invoice_number: string | null;
  property_id: string;
  booking_id: string | null;
  status: string;
  is_deleted?: boolean | null;
  /** Used for the 60-minute post-settlement grace window. */
  settled_at?: string | null;
}

interface PaymentRow {
  id: string;
  amount: number;
  mode: string;
  paid_at: string;
  reference_no: string | null;
}

interface Props {
  folio: ChangePaymentModeFolio | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

export function ChangePaymentModeDialog({ folio, open, onOpenChange, onSaved }: Props) {
  const { user } = useAuth();
  const { can } = usePermissions();
  // 60-minute post-settlement grace window: any role may correct payments.
  const inGrace = withinGraceWindow(folio?.settled_at ?? null);
  const canEditAmount = can("payments", "edit_amount") || inGrace;
  const canDeletePayment = can("payments", "delete") || inGrace;
  const viaGrace = inGrace && !can("payments", "edit_amount");
  const { methods } = usePaymentMethods(folio?.property_id ?? null);
  const activeMethods = methods.filter((m) => m.is_active);

  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [amountDraft, setAmountDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const locked = !!folio && (folio.status === "settled" || folio.status === "due" || folio.status === "void" || folio.is_deleted === true);

  /** Owner-only destructive action: removes the payment row, recomputes the
   *  folio's paid/balance from the remaining real payments and flips a
   *  finalised bill back to "due" when it is no longer fully covered. */
  async function deletePayment(p: PaymentRow) {
    if (!folio || !canDeletePayment) return;
    const ok = window.confirm(
      `Are you sure you want to delete this ₹${Number(p.amount).toLocaleString("en-IN")} payment?\n\n` +
        `This cannot be undone. The bill's paid and balance figures will be recalculated.`,
    );
    if (!ok) return;
    setDeletingId(p.id);
    try {
      const { error } = await supabase.rpc("delete_payment" as any, {
        _payment_id: p.id,
        _reason: reason.trim() || null,
      } as any);
      if (error) return toastError(error);
      await logActivity({
        property_id: folio.property_id,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        ...ACTIVITY.PAYMENT_DELETED,
        reference_id: p.id,
        reference_label: `${billNo(folio.invoice_number)} — ₹${Number(p.amount)} (${p.mode}) deleted`,
        details: {
          payment_id: p.id,
          folio_id: folio.id,
          bill_number: billNo(folio.invoice_number),
          booking_id: folio.booking_id,
          amount: Number(p.amount),
          mode: p.mode,
          reference_no: p.reference_no,
          via_grace_window: inGrace && !can("payments", "delete"),
          reason: reason.trim() || null,
        },
      });
      setPayments((rows) => rows.filter((r) => r.id !== p.id));
      toast.success("Payment deleted");
      onSaved?.();
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    if (!open || !folio) return;
    let cancelled = false;
    setLoading(true);
    setReason("");
    (async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id,amount,mode,paid_at,reference_no")
        .eq("folio_id", folio.id)
        .order("paid_at", { ascending: true });
      if (cancelled) return;
      setLoading(false);
      if (error) return toastError(error);
      const rows = (data ?? []) as unknown as PaymentRow[];
      setPayments(rows);
      const initial: Record<string, string> = {};
      const initialAmounts: Record<string, string> = {};
      rows.forEach((p) => { initial[p.id] = p.mode; initialAmounts[p.id] = String(Number(p.amount)); });
      setDraft(initial);
      setAmountDraft(initialAmounts);
    })();
    return () => { cancelled = true; };
  }, [open, folio]);

  async function save() {
    if (!folio) return;
    const changes = payments
      .map((p) => ({ p, next: draft[p.id] }))
      .filter(({ p, next }) => next && next !== p.mode);

    const amountChanges = canEditAmount
      ? payments
          .map((p) => ({ p, next: Number(amountDraft[p.id]) }))
          .filter(({ p, next }) => Number.isFinite(next) && Math.abs(next - Number(p.amount)) > 0.001)
      : [];

    if (changes.length === 0 && amountChanges.length === 0) {
      onOpenChange(false);
      return;
    }

    for (const { next } of amountChanges) {
      if (!(next > 0)) return toast.error("Payment amount must be greater than zero");
    }

    // Mandatory: every selection must be an active payment method
    const activeNames = new Set(activeMethods.map((m) => m.name));
    for (const { next } of changes) {
      if (!next || !activeNames.has(next)) {
        return toast.error("Select a valid, active payment method for every row");
      }
    }

    if (locked && !reason.trim()) return toast.error("Reason required for a locked bill");

    if (amountChanges.length > 0) {
      const summary = amountChanges
        .map(({ p, next }) => `₹${Number(p.amount).toLocaleString("en-IN")} → ₹${next.toLocaleString("en-IN")}`)
        .join(", ");
      const ok = window.confirm(
        `Are you sure? This changes the recorded payment amount (${summary}) and will update this bill's paid and balance figures.`,
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      for (const { p, next } of amountChanges) {
        const { error } = await supabase.rpc("change_payment_amount" as any, {
          _payment_id: p.id,
          _new_amount: next,
          _reason: reason.trim() || null,
        } as any);
        if (error) { toastError(error); setSaving(false); return; }

        await logActivity({
          property_id: folio.property_id,
          user_id: user?.id ?? "",
          user_name: userDisplayName(user as any),
          ...ACTIVITY.PAYMENT_AMOUNT_CHANGED,
          reference_id: p.id,
          reference_label: `${billNo(folio.invoice_number)} — ₹${Number(p.amount)} → ₹${next}`,
          details: {
            payment_id: p.id,
            folio_id: folio.id,
            bill_id: folio.id,
            bill_number: billNo(folio.invoice_number),
            booking_id: folio.booking_id,
            old_amount: Number(p.amount),
            new_amount: next,
            mode: p.mode,
            changed_by: user?.id ?? null,
            changed_at: new Date().toISOString(),
            locked,
            via_grace_window: viaGrace,
            reason: reason.trim() || null,
          },
        });
      }

      for (const { p, next } of changes) {
        // Mode-only change via a server routine gated by payments/edit_mode.
        const { error } = await supabase.rpc("change_payment_mode" as any, {
          _payment_id: p.id,
          _new_mode: next,
          _reason: locked ? reason.trim() : null,
        } as any);
        if (error) { toastError(error); setSaving(false); return; }

        // Locked bills: keep the override audit trail
        if (locked) {
          await supabase.rpc("log_owner_override" as any, {
            _property_id: folio.property_id,
            _table_name: "payments",
            _record_id: p.id,
            _action: "PAYMENT_MODE_CHANGED",
            _old: { mode: p.mode, amount: p.amount, folio_id: folio.id },
            _new: { mode: next },
            _reason: reason.trim(),
          } as any);
        }

        // Always also write the PAYMENT_MODE_CHANGED entry so surfaces that
        // query by action_type (folio detail "edited" chip, reports) pick it up.
        await logActivity({
          property_id: folio.property_id,
          user_id: user?.id ?? "",
          user_name: userDisplayName(user as any),
          ...ACTIVITY.PAYMENT_MODE_CHANGED,
          reference_id: p.id,
          reference_label: `${billNo(folio.invoice_number)} — ₹${p.amount}: ${p.mode} → ${next}`,
          details: {
            payment_id: p.id,
            folio_id: folio.id,
            bill_id: folio.id,
            bill_number: billNo(folio.invoice_number),
            booking_id: folio.booking_id,
            amount: Number(p.amount),
            old_mode: p.mode,
            new_mode: next,
            changed_by: user?.id ?? null,
            changed_at: new Date().toISOString(),
            locked,
            reason: locked ? reason.trim() : null,
          },
        });
      }
      const n = changes.length + amountChanges.length;
      toast.success(`Updated ${n} payment change${n === 1 ? "" : "s"}`);
      onOpenChange(false);
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{canEditAmount ? "Edit Payment" : "Change Payment Mode"}</DialogTitle>
          <DialogDescription>
            {folio ? (
              <>Bill <b>{billNo(folio.invoice_number)}</b>{" "}
                {locked && <Badge variant="outline" className="ml-1 border-amber-400 text-amber-700">LOCKED — owner override</Badge>}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading payments…</p>
        ) : payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments recorded for this bill.</p>
        ) : (
          <div className="space-y-3 max-h-[50dvh] overflow-auto pr-1">
            {payments.map((p) => (
              <div key={p.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border rounded-md p-2">
                <div className="min-w-0">
                  {canEditAmount ? (
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-medium">₹</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        className="h-8 w-32"
                        value={amountDraft[p.id] ?? ""}
                        onChange={(e) => setAmountDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                      />
                    </div>
                  ) : (
                    <div className="text-sm font-medium">₹{Number(p.amount).toLocaleString("en-IN")}</div>
                  )}
                  <div className="text-xs text-muted-foreground truncate">
                    {new Date(p.paid_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {p.reference_no ? ` · Ref ${p.reference_no}` : ""}
                  </div>
                </div>
                <Select value={draft[p.id] ?? ""} onValueChange={(v) => setDraft((d) => ({ ...d, [p.id]: v }))}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="Select mode" /></SelectTrigger>
                  <SelectContent>
                    {activeMethods.map((m) => (
                      <SelectItem key={m.id} value={m.name}>{formatPaymentMethodLabel(m.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {canDeletePayment && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    title="Delete this payment"
                    disabled={deletingId === p.id || saving}
                    onClick={() => deletePayment(p)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        {locked && payments.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs">Reason (required for locked bill)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Guest paid by UPI, marked wrong at settle" />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || payments.length === 0}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}