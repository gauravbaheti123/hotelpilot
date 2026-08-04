import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { todayIso } from "@/lib/front-desk";
import { extraBedRateFor, resolveTariffForCategory } from "@/lib/tariff";
import { reportQueryError } from "@/lib/queryError";

interface Props {
  bookingId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}

interface Ctx {
  property_id: string;
  check_in: string;
  check_out: string;
  status: string;
  rate_per_night: number;
  category_name: string | null;
}

export function AddExtraBedDialog({ bookingId, open, onOpenChange, onDone }: Props) {
  const { user } = useAuth();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !bookingId) { setCtx(null); setQty(1); return; }
    (async () => {
      const { data: b, error: __qe1 } = await supabase
        .from("bookings")
        .select("property_id, check_in, check_out, status")
        .eq("id", bookingId).maybeSingle();
      if (__qe1) reportQueryError("bookings", __qe1);
      if (!b) { toast.error("Booking not found"); onOpenChange(false); return; }
      const { data: br, error: __qe2 } = await supabase
        .from("booking_rooms")
        .select("category_id, meal_plan, room_categories(name)")
        .eq("booking_id", bookingId)
        .neq("status", "shifted")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(1);
      if (__qe2) reportQueryError("booking rooms", __qe2);
      const row = (br?.[0] as any) ?? null;
      // Phase 27b — extra bed price comes from the stay's tariff plan
      // (extra_adult_rate), resolved against the booking's check-in date.
      const plan = await resolveTariffForCategory(
        (b as any).property_id,
        row?.category_id ?? null,
        (b as any).check_in,
        row?.meal_plan ?? null,
      ).catch(() => null);
      const rate = extraBedRateFor(plan);
      setCtx({
        property_id: (b as any).property_id,
        check_in: (b as any).check_in,
        check_out: (b as any).check_out,
        status: (b as any).status,
        rate_per_night: rate,
        category_name: row?.room_categories?.name ?? null,
      });
    })();
  }, [open, bookingId, onOpenChange]);

  const today = todayIso();
  const fromDate =
    ctx ? (today > ctx.check_in ? today : ctx.check_in) : today;
  const remainingNights =
    ctx ? Math.max(1, Math.round((+new Date(ctx.check_out) - +new Date(fromDate)) / 86_400_000)) : 0;
  const total = ctx ? ctx.rate_per_night * qty * remainingNights : 0;

  const save = async () => {
    if (!ctx || !bookingId) return;
    if (ctx.rate_per_night <= 0) {
      toast.error("No extra bed rate on this tariff plan — set “Extra adult rate” in Master Data → Tariff Plans");
      return;
    }
    if (qty <= 0) { toast.error("Quantity must be at least 1"); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from("booking_extra_beds" as any).insert({
        property_id: ctx.property_id,
        booking_id: bookingId,
        quantity: qty,
        rate_per_night: ctx.rate_per_night,
        added_from_date: fromDate,
        added_by: user?.id ?? null,
      } as any);
      if (error) throw error;
      toast.success(`Extra bed added — ₹${total.toLocaleString("en-IN")}`);
      onDone?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to add extra bed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Extra Bed</DialogTitle>
          <DialogDescription>
            Charged per night for remaining nights of the stay.
          </DialogDescription>
        </DialogHeader>
        {ctx && (
          <div className="space-y-3 text-sm">
            {ctx.category_name && (
              <div className="text-xs text-muted-foreground">Category: {ctx.category_name}</div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  min={1}
                  max={4}
                  value={qty}
                  onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Rate / night (from tariff plan)</Label>
                <Input value={`₹${ctx.rate_per_night.toLocaleString("en-IN")}`} readOnly />
              </div>
            </div>
            <div className="rounded-md border p-3 bg-muted/40 text-sm">
              ₹{ctx.rate_per_night.toLocaleString("en-IN")}/night × {qty} bed{qty > 1 ? "s" : ""} × {remainingNights} remaining night{remainingNights > 1 ? "s" : ""} =
              {" "}<span className="font-semibold">₹{total.toLocaleString("en-IN")}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">
              From {fromDate} · through checkout {ctx.check_out}. Not retroactive to already-passed nights.
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !ctx || ctx.rate_per_night <= 0}>
            {saving ? "Adding…" : "Add Extra Bed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}