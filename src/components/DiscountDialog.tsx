import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inr } from "@/lib/billing";
import type { DiscountLimit } from "@/lib/discountLimit";
import { canApplyDiscount, describeLimit } from "@/lib/discountLimit";

export type DiscType = "percent" | "amount";

export interface DiscountDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** "bill" = bill-level, "line" = per-line-item */
  kind: "bill" | "line";
  /** For "line": description shown in the info card. */
  lineDescription?: string;
  /**
   * Base amount the discount applies against, in rupees.
   * - For "bill" this is the net subtotal (after per-line discounts).
   * - For "line" this is the absolute line amount.
   */
  base: number;
  initialType?: DiscType;
  initialValue?: number;
  /** True when the current user has no percentage cap (owner / superadmin). */
  unlimited: boolean;
  /** Max percentage allowed for this user's role (0-100). Ignored when unlimited. */
  maxPct: number;
  /**
   * Optional richer per-user limit. When provided it takes precedence over
   * (unlimited, maxPct) and supports 'fixed_amount' and 'none' limit types.
   * (unlimited, maxPct) are still accepted so existing call sites keep working.
   */
  limit?: DiscountLimit;
  /** Called when the user Applies. Return a promise; dialog closes on success. */
  onSave: (v: { type: DiscType; value: number; rupees: number }) => Promise<void> | void;
  /** Show Remove button (when there is already an existing discount to remove). */
  hasExisting?: boolean;
  title?: string;
}

/** Convert (type, value, base) to a positive rupee amount, clamped to base. */
function discountToRupees(type: DiscType, value: number, base: number): number {
  if (!value || value <= 0 || base <= 0) return 0;
  if (type === "percent") return Math.max(0, Math.min(100, value)) * base / 100;
  return Math.min(value, base);
}

/** Effective % of a base regardless of input type. */
function effectivePct(type: DiscType, value: number, base: number): number {
  if (base <= 0 || !value || value <= 0) return 0;
  if (type === "percent") return Math.max(0, Math.min(100, value));
  return (value / base) * 100;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Shared discount dialog used across folio, banquet bill, and split bill.
 * Enforces role-based max_discount_pct except when `unlimited` is true.
 */
export function DiscountDialog({
  open, onOpenChange, kind, lineDescription, base,
  initialType = "percent", initialValue = 0, unlimited, maxPct,
  limit, onSave, hasExisting, title,
}: DiscountDialogProps) {
  const effectiveLimit: DiscountLimit = limit ?? {
    limitType: "percentage",
    limitValue: Math.max(0, Math.min(100, Number(maxPct) || 0)),
    unlimited: !!unlimited,
  };
  const blocked = !effectiveLimit.unlimited && effectiveLimit.limitType === "none";
  const [type, setType] = useState<DiscType>(initialType);
  const [value, setValue] = useState<string>(initialValue ? String(initialValue) : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setType(initialType);
      setValue(initialValue ? String(initialValue) : "");
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function submit(overrideValue?: string) {
    const raw = overrideValue ?? value;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) return;
    const rupees = round2(discountToRupees(type, v, base));
    if (v > 0) {
      const check = canApplyDiscount(effectiveLimit, { discountRupees: rupees, base });
      if (!check.allowed) {
        alert(check.reason ?? "Discount exceeds your allowed limit.");
        return;
      }
    }
    setBusy(true);
    try {
      await onSave({ type, value: v, rupees });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  const previewRupees = round2(discountToRupees(type, Number(value) || 0, base));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {title ?? (kind === "bill" ? "Apply bill-level discount" : "Apply line-item discount")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {kind === "line" && lineDescription && (
            <div className="rounded-md border bg-muted/30 p-2 text-xs">
              <div className="font-medium">{lineDescription}</div>
              <div className="text-muted-foreground">Line amount: {inr(base)}</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Discount type</Label>
              <Select value={type} onValueChange={(v) => setType(v as DiscType)} disabled={blocked}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percent">Percent (%)</SelectItem>
                  <SelectItem value="amount">Amount (₹)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Value</Label>
              <Input
                type="number" min="0"
                step={type === "percent" ? "0.01" : "1"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                disabled={blocked}
              />
            </div>
          </div>
          {!effectiveLimit.unlimited && (
            <div className={`text-xs ${blocked ? "text-destructive" : "text-muted-foreground"}`}>
              {describeLimit(effectiveLimit)}
            </div>
          )}
          {previewRupees > 0 && (
            <div className="rounded-md border bg-emerald-50 p-2 text-xs text-emerald-800">
              Discount: -{inr(previewRupees)} on {inr(base)}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          {hasExisting && (
            <Button variant="ghost" onClick={() => submit("0")} disabled={busy}>
              Remove
            </Button>
          )}
          <Button onClick={() => submit()} disabled={busy || blocked}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}