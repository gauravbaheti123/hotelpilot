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
import { usePaymentMethods, formatPaymentMethodLabel } from "@/hooks/use-payment-methods";
import { useAuth, hasRole } from "@/hooks/use-auth";
import { logActivity, userDisplayName, ACTIVITY } from "@/lib/activityLog";
import { toastError } from "@/lib/errorMessage";

export interface ChangePaymentModeFolio {
  id: string;
  invoice_number: string;
  property_id: string;
  booking_id: string | null;
  status: string;
  is_deleted?: boolean | null;
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
  const { user, roles } = useAuth();
  const { methods } = usePaymentMethods(folio?.property_id ?? null);
  const activeMethods = methods.filter((m) => m.is_active);
  const isOwner = hasRole(roles, "owner") || hasRole(roles, "superadmin");

  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const locked = !!folio && (folio.status === "settled" || folio.status === "void" || folio.is_deleted === true);

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
      rows.forEach((p) => { initial[p.id] = p.mode; });
      setDraft(initial);
    })();
    return () => { cancelled = true; };
  }, [open, folio]);

  async function save() {
    if (!folio) return;
    const changes = payments
      .map((p) => ({ p, next: draft[p.id] }))
      .filter(({ p, next }) => next && next !== p.mode);

    if (changes.length === 0) {
      onOpenChange(false);
      return;
    }

    // Mandatory: every selection must be an active payment method
    const activeNames = new Set(activeMethods.map((m) => m.name));
    for (const { next } of changes) {
      if (!next || !activeNames.has(next)) {
        return toast.error("Select a valid, active payment method for every row");
      }
    }

    if (locked) {
      if (!isOwner) return toast.error("Bill is locked — only Owner/Superadmin can change payment mode");
      if (!reason.trim()) return toast.error("Reason required for locked-bill override");
    }

    setSaving(true);
    try {
      for (const { p, next } of changes) {
        const { error } = await supabase
          .from("payments")
          .update({ mode: next })
          .eq("id", p.id);
        if (error) { toastError(error); setSaving(false); return; }

        // Locked bills: route through owner override for consistent audit
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
          reference_label: `${folio.invoice_number} — ₹${p.amount}: ${p.mode} → ${next}`,
          details: {
            payment_id: p.id,
            folio_id: folio.id,
            bill_id: folio.id,
            bill_number: folio.invoice_number,
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
      toast.success(`Updated ${changes.length} payment${changes.length === 1 ? "" : "s"}`);
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
          <DialogTitle>Change Payment Mode</DialogTitle>
          <DialogDescription>
            {folio ? (
              <>Bill <b>{folio.invoice_number}</b>{" "}
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
          <div className="space-y-3 max-h-[50vh] overflow-auto pr-1">
            {payments.map((p) => (
              <div key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-3 border rounded-md p-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium">₹{Number(p.amount).toLocaleString("en-IN")}</div>
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