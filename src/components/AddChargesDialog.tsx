// Unified "Add Charges" modal (replaces the old Add Extra Bed dialog).
// Three charge types share one shell:
//   • Extra Bed     → booking_extra_beds  (seed_extra_bed_charge trigger path)
//   • Early Check-in→ folio_charges (charge_type 'early_checkin', room GST)
//   • Other         → folio_charges (charge_type 'extra', room GST)
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { toast } from "sonner";
import { todayIso } from "@/lib/front-desk";
import { extraBedRateFor, resolveTariffForCategory } from "@/lib/tariff";
import { reportQueryError } from "@/lib/queryError";
import { toastError } from "@/lib/errorMessage";
import { useGstSlabs } from "@/hooks/use-gst-slabs";
import { resolveGstRate } from "@/lib/gst";
import { useDiscountLimit } from "@/hooks/use-discount-limit";
import { canApplyDiscount, describeLimit } from "@/lib/discountLimit";
import { useEarlyCheckinSlabs } from "@/hooks/use-early-checkin-slabs";
import { earlyCheckinDescription, hoursEarly, resolveEarlyCheckinCharge } from "@/lib/earlyCheckin";

type ChargeKind = "extra_bed" | "early_checkin" | "other";

const KIND_OPTIONS = [
  { value: "early_checkin", label: "Early Check-in" },
  { value: "extra_bed", label: "Extra Bed" },
  { value: "other", label: "Other" },
];

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
  /** Property standard check-in time, e.g. "12:00". */
  default_checkin_time: string | null;
  /** Actual arrival time (HH:mm) when the guest is already checked in. */
  actual_checkin_time: string | null;
}

export function AddChargesDialog({ bookingId, open, onOpenChange, onDone }: Props) {
  const { user } = useAuth();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [kind, setKind] = useState<ChargeKind>("early_checkin");
  const [qty, setQty] = useState(1);
  const [bedRate, setBedRate] = useState(0);
  const [amount, setAmount] = useState("");
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const { slabs: gstSlabs } = useGstSlabs(ctx?.property_id ?? null);
  const { slabs: ecSlabs } = useEarlyCheckinSlabs(ctx?.property_id ?? null);
  const { limit } = useDiscountLimit();

  useEffect(() => {
    if (!open || !bookingId) {
      setCtx(null); setQty(1); setBedRate(0); setAmount(""); setHours("");
      setDescription(""); setKind("early_checkin");
      return;
    }
    (async () => {
      const { data: b, error: __qe1 } = await supabase
        .from("bookings")
        .select("property_id, check_in, check_out, status, checked_in_at")
        .eq("id", bookingId).maybeSingle();
      if (__qe1) reportQueryError("bookings", __qe1);
      if (!b) { toast.error("Booking not found"); onOpenChange(false); return; }
      const { data: br, error: __qe2 } = await supabase
        .from("booking_rooms")
        .select("category_id, meal_plan, actual_check_in, room_categories(name)")
        .eq("booking_id", bookingId)
        .neq("status", "shifted")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(1);
      if (__qe2) reportQueryError("booking rooms", __qe2);
      const row = (br?.[0] as any) ?? null;
      const { data: prop, error: __qe3 } = await supabase
        .from("properties")
        .select("default_checkin_time")
        .eq("id", (b as any).property_id).maybeSingle();
      if (__qe3) reportQueryError("property", __qe3);
      // Phase 27b — extra bed price comes from the stay's tariff plan.
      const plan = await resolveTariffForCategory(
        (b as any).property_id,
        row?.category_id ?? null,
        (b as any).check_in,
        row?.meal_plan ?? null,
      ).catch(() => null);
      const rate = extraBedRateFor(plan);
      const arrivalRaw = row?.actual_check_in ?? (b as any).checked_in_at ?? null;
      const arrival = arrivalRaw
        ? new Date(arrivalRaw).toLocaleTimeString("en-GB", {
            hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
          })
        : null;
      setCtx({
        property_id: (b as any).property_id,
        check_in: (b as any).check_in,
        check_out: (b as any).check_out,
        status: (b as any).status,
        rate_per_night: rate,
        category_name: row?.room_categories?.name ?? null,
        default_checkin_time: (prop as any)?.default_checkin_time ?? null,
        actual_checkin_time: arrival,
      });
      setBedRate(rate);
    })();
  }, [open, bookingId, onOpenChange]);

  /* ---------------- Extra bed math (unchanged behaviour) ---------------- */
  const today = todayIso();
  const fromDate = ctx ? (today > ctx.check_in ? today : ctx.check_in) : today;
  const remainingNights =
    ctx ? Math.max(1, Math.round((+new Date(ctx.check_out) - +new Date(fromDate)) / 86_400_000)) : 0;
  const bedTotal = ctx ? bedRate * qty * remainingNights : 0;

  const standardBedRate = ctx?.rate_per_night ?? 0;
  const bedRateCheck = useMemo(() => {
    if (standardBedRate <= 0 || bedRate <= 0 || bedRate >= standardBedRate) {
      return { allowed: true } as { allowed: boolean; reason?: string };
    }
    return canApplyDiscount(limit, {
      discountRupees: standardBedRate - bedRate,
      base: standardBedRate,
    });
  }, [limit, standardBedRate, bedRate]);

  /* ---------------- Early check-in ---------------- */
  const autoHours = ctx
    ? hoursEarly(ctx.default_checkin_time ?? "12:00", ctx.actual_checkin_time)
    : 0;
  const effHours = hours === "" ? autoHours : Number(hours) || 0;
  const suggested = resolveEarlyCheckinCharge(ecSlabs, effHours);

  useEffect(() => {
    if (kind !== "early_checkin") return;
    if (amount !== "") return;
    if (suggested != null && suggested > 0) setAmount(String(suggested));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, suggested]);

  const numericAmount = Number(amount) || 0;
  const gstRate = resolveGstRate(gstSlabs, "room", numericAmount);
  const gstAmount = gstRate != null ? Math.round(numericAmount * gstRate) / 100 : 0;

  async function saveExtraBed() {
    if (!ctx || !bookingId) return;
    if (bedRate <= 0) {
      toast.error("Enter a rate per night for the extra bed");
      return;
    }
    if (!bedRateCheck.allowed) {
      toast.error(bedRateCheck.reason ?? "Rate below your discount limit");
      return;
    }
    if (qty <= 0) { toast.error("Quantity must be at least 1"); return; }
    const { error } = await supabase.from("booking_extra_beds" as never).insert({
      property_id: ctx.property_id,
      booking_id: bookingId,
      quantity: qty,
      rate_per_night: bedRate,
      added_from_date: fromDate,
      added_by: user?.id ?? null,
    } as never);
    if (error) throw error;
    toast.success(`Extra bed added — ₹${bedTotal.toLocaleString("en-IN")}`);
  }

  async function saveFolioCharge(chargeType: "early_checkin" | "extra", desc: string) {
    if (!ctx || !bookingId) return;
    if (numericAmount <= 0) { toast.error("Enter an amount"); return; }
    if (gstRate == null) {
      toast.error("No GST slab configured for this amount — set it up in Master Data → GST Slabs");
      return;
    }
    const { data: folioId, error: fErr } = await supabase.rpc("get_or_create_folio", {
      _booking_id: bookingId,
    } as never);
    if (fErr) throw fErr;
    const { error } = await supabase.from("folio_charges").insert({
      folio_id: folioId as unknown as string,
      charge_type: chargeType,
      description: desc,
      qty: 1,
      rate: numericAmount,
      amount: numericAmount,
      gst_rate: gstRate,
      gst_amount: gstAmount,
      charged_on: fromDate,
      source_table: chargeType === "early_checkin" ? "early_checkin" : "manual",
      created_by: user?.id ?? null,
    } as never);
    if (error) throw error;
    // Belt-and-braces: the folio_charges trigger already recomputes totals.
    await supabase.rpc("recompute_folio_totals", { _folio_id: folioId } as never);
    toast.success(`Charge added — ₹${numericAmount.toLocaleString("en-IN")}`);
  }

  const save = async () => {
    if (!ctx || !bookingId) return;
    setSaving(true);
    try {
      if (kind === "extra_bed") {
        await saveExtraBed();
      } else if (kind === "early_checkin") {
        if (effHours <= 0) { toast.error("Hours early must be greater than 0"); return; }
        await saveFolioCharge("early_checkin", earlyCheckinDescription(effHours));
      } else {
        const desc = description.trim();
        if (!desc) { toast.error("Enter a description"); return; }
        await saveFolioCharge("extra", desc);
      }
      onDone?.();
      onOpenChange(false);
    } catch (e: any) {
      toastError(e, "Failed to add charge");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Charges</DialogTitle>
          <DialogDescription>
            Post an extra bed, early check-in or a custom charge to this folio.
          </DialogDescription>
        </DialogHeader>

        {ctx && (
          <div className="space-y-3 text-sm">
            <div className="space-y-1.5">
              <Label>Charge type</Label>
              <SearchableSelect
                value={kind}
                onChange={(v) => { setKind(v as ChargeKind); setAmount(""); }}
                options={KIND_OPTIONS}
                placeholder="Select charge type"
                searchPlaceholder="Search charge type…"
                alwaysShowSearch
              />
            </div>

            {ctx.category_name && (
              <div className="text-xs text-muted-foreground">Category: {ctx.category_name}</div>
            )}

            {kind === "extra_bed" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Quantity</Label>
                    <Input
                      type="number" min={1} max={4} value={qty}
                      onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Rate / night</Label>
                    <Input
                      type="number" min={0} step="0.01" value={bedRate || ""}
                      onChange={(e) => setBedRate(Number(e.target.value) || 0)}
                    />
                  </div>
                </div>
                {standardBedRate > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Tariff plan rate ₹{standardBedRate.toLocaleString("en-IN")}. {describeLimit(limit)}
                  </p>
                )}
                {!bedRateCheck.allowed && (
                  <p className="text-xs text-destructive">{bedRateCheck.reason}</p>
                )}
                <div className="rounded-md border p-3 bg-muted/40 text-sm">
                  ₹{bedRate.toLocaleString("en-IN")}/night × {qty} bed{qty > 1 ? "s" : ""} × {remainingNights} remaining night{remainingNights > 1 ? "s" : ""} =
                  {" "}<span className="font-semibold">₹{bedTotal.toLocaleString("en-IN")}</span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  From {fromDate} · through checkout {ctx.check_out}. Not retroactive to already-passed nights.
                </div>
              </>
            )}

            {kind === "early_checkin" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Hours early</Label>
                    <Input
                      type="number" min={0} step="0.5"
                      value={hours === "" ? String(autoHours) : hours}
                      onChange={(e) => { setHours(e.target.value); setAmount(""); }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Amount (₹)</Label>
                    <Input
                      type="number" min={0} step="0.01" value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Standard check-in {ctx.default_checkin_time ?? "12:00"}
                  {ctx.actual_checkin_time ? ` · arrived ${ctx.actual_checkin_time}` : " · arrival time unknown"}.
                  {suggested != null
                    ? ` Suggested slab amount ₹${suggested.toLocaleString("en-IN")}.`
                    : " No matching slab — set one up in Master Data → Early Check-in Slabs."}
                </p>
              </>
            )}

            {kind === "other" && (
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label>Description</Label>
                  <Input
                    value={description} maxLength={120}
                    placeholder="e.g. Airport pickup"
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Amount (₹)</Label>
                  <Input
                    type="number" min={0} step="0.01" value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </div>
            )}

            {kind !== "extra_bed" && numericAmount > 0 && (
              <div className="rounded-md border p-3 bg-muted/40 text-sm">
                {gstRate == null ? (
                  <span className="text-destructive">
                    No GST slab configured for this amount. Set it up in Master Data → GST Slabs.
                  </span>
                ) : (
                  <>
                    ₹{numericAmount.toLocaleString("en-IN")} + GST {gstRate}% (₹{gstAmount.toFixed(2)}) =
                    {" "}<span className="font-semibold">₹{(numericAmount + gstAmount).toFixed(2)}</span>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || !ctx}>
            {saving ? "Adding…" : "Add Charge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
