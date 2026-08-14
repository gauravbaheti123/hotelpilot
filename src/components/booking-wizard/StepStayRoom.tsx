// Part 3 — Step 3: stay dates, room(s) and pricing.
// Reservation mode is a mini variant (category only, no room number).
// Regular mode uses the `available_rooms` RPC so only genuinely bookable rooms
// (vacant + no booking overlap + not event-blocked) can be picked.
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { supabase } from "@/integrations/supabase/client";
import { fetchAvailableRooms, type AvailableRoom } from "@/lib/roomAvailability";
import {
  findPlanByNameAndMeal, mealPlansForPlanName, planNamesForCategory,
  defaultMealPlanFor, type TariffPlan, NO_TARIFF_PLAN_ERROR,
} from "@/lib/tariff";
import { useRoomCategories, useTariffPlans } from "@/hooks/use-rooms";
import { SOURCES, isValidStayRange, nightsBetween } from "@/lib/front-desk";
import { BookingSourceFields } from "@/components/booking-wizard/BookingSourceFields";
import { useGstSlabs } from "@/hooks/use-gst-slabs";
import { resolveGstRate, resolveGstRateInclusive } from "@/lib/gst";
import { useDiscountLimit } from "@/hooks/use-discount-limit";
import { canApplyDiscount, describeLimit } from "@/lib/discountLimit";
import { emptyRoom, type WizardRoom } from "@/lib/bookingWizard";
import { useEarlyCheckinSlabs } from "@/hooks/use-early-checkin-slabs";
import { hoursEarly, resolveEarlyCheckinCharge } from "@/lib/earlyCheckin";
import { supabase as sb } from "@/integrations/supabase/client";

const MEAL_PLAN_LABELS: Record<string, string> = {
  EP: "EP — Room only",
  CP: "CP — Breakfast",
  MAP: "MAP — Breakfast + 1 meal",
  AP: "AP — All meals",
};

interface Category { id: string; name: string }

interface Props {
  propertyId: string;
  reservation: boolean;
  rooms: WizardRoom[];
  source: string;
  otaPartnerName: string;
  onRoomsChange: (next: WizardRoom[]) => void;
  onMetaChange: (p: { source?: string; otaPartnerName?: string }) => void;
  /** Reports rate-override violations so the shell can block Next. */
  onBlockedChange: (blocked: boolean) => void;
}

export function StepStayRoom({
  propertyId, reservation, rooms, source, otaPartnerName,
  onRoomsChange, onMetaChange, onBlockedChange,
}: Props) {
  // Shared caches (see use-rooms.ts) — categories and tariff plans used to be
  // re-fetched on every mount of this step.
  const { categories: cats } = useRoomCategories(propertyId);
  const { plans: tariffs } = useTariffPlans(propertyId);
  const [violations, setViolations] = useState<Record<string, string | null>>({});
  const { limit } = useDiscountLimit();
  const [stdCheckinTime, setStdCheckinTime] = useState<string>("12:00");

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    sb.from("properties").select("default_checkin_time").eq("id", propertyId).maybeSingle()
      .then(({ data }) => {
        if (!cancelled && (data as any)?.default_checkin_time) {
          setStdCheckinTime(String((data as any).default_checkin_time).slice(0, 5));
        }
      });
    return () => { cancelled = true; };
  }, [propertyId]);

  useEffect(() => {
    onBlockedChange(Object.values(violations).some(Boolean));
  }, [violations, onBlockedChange]);

  function patchRoom(key: string, p: Partial<WizardRoom>) {
    onRoomsChange(rooms.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }

  function addRoom() {
    const base = rooms[rooms.length - 1];
    onRoomsChange([
      ...rooms,
      emptyRoom({
        checkIn: base?.checkIn,
        checkInTime: base?.checkInTime,
        checkOut: base?.checkOut,
        checkOutTime: base?.checkOutTime,
      }),
    ]);
  }

  function removeRoom(key: string) {
    onRoomsChange(rooms.filter((r) => r.key !== key));
    setViolations((v) => ({ ...v, [key]: null }));
  }

  return (
    <div className="space-y-6">
      {rooms.map((r, i) => (
        <RoomCard
          key={r.key}
          index={i}
          propertyId={propertyId}
          reservation={reservation}
          room={r}
          cats={cats}
          tariffs={tariffs}
          stdCheckinTime={stdCheckinTime}
          limitLabel={describeLimit(limit)}
          limit={limit}
          checkRate={(standard, rate) =>
            standard > 0 && rate > 0 && rate < standard
              ? canApplyDiscount(limit, { discountRupees: standard - rate, base: standard })
              : { allowed: true, maxRupees: 0 }
          }
          onViolation={(msg) => setViolations((v) => (v[r.key] === msg ? v : { ...v, [r.key]: msg }))}
          onChange={(p) => patchRoom(r.key, p)}
          onRemove={rooms.length > 1 ? () => removeRoom(r.key) : undefined}
        />
      ))}

      {!reservation && (
        <Button type="button" variant="outline" size="sm" onClick={addRoom}>
          <Plus className="mr-2 h-4 w-4" /> Add another room
        </Button>
      )}

      <div className="border-t pt-4">
        <BookingSourceFields source={source} detail={otaPartnerName} onChange={onMetaChange} />
      </div>
    </div>
  );
}

function RoomCard({
  index, propertyId, reservation, room, cats, tariffs, stdCheckinTime, limitLabel, limit, checkRate, onChange, onRemove, onViolation,
}: {
  index: number;
  propertyId: string;
  reservation: boolean;
  room: WizardRoom;
  cats: Category[];
  tariffs: TariffPlan[];
  stdCheckinTime: string;
  limitLabel: string;
  limit: import("@/lib/discountLimit").DiscountLimit;
  checkRate: (standard: number, rate: number) => { allowed: boolean; reason?: string };
  onChange: (p: Partial<WizardRoom>) => void;
  onRemove?: () => void;
  onViolation: (msg: string | null) => void;
}) {
  const [avail, setAvail] = useState<AvailableRoom[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  // True only once availability has actually been fetched for the current
  // property/date/category combination. Without this, the "drop unavailable
  // room" effect below fired on first render (avail=[] and loadingRooms still
  // false) and wiped a pre-selected room passed in from the dashboard.
  const [availLoaded, setAvailLoaded] = useState(false);
  const [availError, setAvailError] = useState<string | null>(null);
  const { slabs: gstSlabs } = useGstSlabs(propertyId);
  const { slabs: ecSlabs } = useEarlyCheckinSlabs(propertyId);

  const datesValid = isValidStayRange(room.checkIn, room.checkOut);
  const nights = datesValid ? nightsBetween(room.checkIn, room.checkOut) : 0;
  const showRoomPicker = !reservation && !room.assignLater;

  // Re-query availability whenever dates or category change.
  useEffect(() => {
    if (!showRoomPicker || !propertyId || !datesValid || !room.categoryId) {
      setAvail([]);
      setAvailLoaded(false);
      return;
    }
    let cancelled = false;
    setLoadingRooms(true);
    setAvailLoaded(false);
    setAvailError(null);
    fetchAvailableRooms(propertyId, room.checkIn, room.checkOut, room.categoryId)
      .then((rows) => { if (!cancelled) { setAvail(rows); setAvailLoaded(true); } })
      .catch((e: any) => { if (!cancelled) { setAvail([]); setAvailError(e?.message ?? "Could not load rooms"); } })
      .finally(() => { if (!cancelled) setLoadingRooms(false); });
    return () => { cancelled = true; };
  }, [propertyId, room.checkIn, room.checkOut, room.categoryId, showRoomPicker, datesValid]);

  // Drop a selected room that is no longer available for the current range.
  useEffect(() => {
    if (!showRoomPicker || loadingRooms || !availLoaded || !room.roomId) return;
    if (!avail.some((a) => a.id === room.roomId)) onChange({ roomId: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avail, loadingRooms, availLoaded]);

  const planNames = useMemo(
    () => planNamesForCategory(tariffs, room.categoryId, room.checkIn),
    [tariffs, room.categoryId, room.checkIn],
  );
  const mealPlanOptions = useMemo(
    () => mealPlansForPlanName(tariffs, room.categoryId, room.planName, room.checkIn),
    [tariffs, room.categoryId, room.planName, room.checkIn],
  );
  const resolvedPlan = useMemo(
    () => findPlanByNameAndMeal(tariffs, room.categoryId, room.planName, room.mealPlan, room.checkIn),
    [tariffs, room.categoryId, room.planName, room.mealPlan, room.checkIn],
  );
  const standardRate = Number(resolvedPlan?.rate) || 0;

  // Keep plan name / meal plan / rate consistent with the chosen category.
  useEffect(() => {
    if (!room.categoryId || tariffs.length === 0) return;
    if (planNames.length === 0) { onChange({ planName: "", tariffId: "", rate: 0 }); return; }
    if (!room.planName || !planNames.includes(room.planName)) {
      const next = planNames.find((n) => n.toLowerCase() === "regular") ?? planNames[0];
      onChange({ planName: next });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.categoryId, tariffs.length, planNames.join("|")]);

  useEffect(() => {
    if (!room.planName || mealPlanOptions.length === 0) return;
    if (mealPlanOptions.includes(room.mealPlan)) return;
    onChange({ mealPlan: defaultMealPlanFor(mealPlanOptions) || "CP" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.planName, mealPlanOptions.join("|")]);

  useEffect(() => {
    if (!resolvedPlan) return;
    onChange({ tariffId: resolvedPlan.id, ...(room.rate > 0 ? {} : { rate: Number(resolvedPlan.rate) || 0 }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedPlan?.id]);

  const rateCheck = checkRate(standardRate, Number(room.rate) || 0);

  // Keep the stored hours-early in sync when the arrival time is edited.
  const hrsEarly = hoursEarly(stdCheckinTime, room.checkInTime);
  const suggestedEc = resolveEarlyCheckinCharge(ecSlabs, hrsEarly);
  useEffect(() => {
    if (room.earlyCheckinHours === hrsEarly) return;
    onChange({ earlyCheckinHours: hrsEarly });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hrsEarly]);

  // Auto-tick early check-in when detected and a slab matches, until the user
  // decides for themselves (unchecking must stick).
  const [ecTouched, setEcTouched] = useState(false);
  useEffect(() => {
    if (ecTouched) return;
    const applicable = hrsEarly > 0 && suggestedEc != null && suggestedEc > 0;
    if (applicable && !room.earlyCheckinEnabled) {
      onChange({ earlyCheckinEnabled: true, earlyCheckinHours: hrsEarly, earlyCheckinAmount: suggestedEc });
    } else if (applicable && !room.earlyCheckinAmount) {
      onChange({ earlyCheckinAmount: suggestedEc });
    } else if (!applicable && room.earlyCheckinEnabled) {
      onChange({ earlyCheckinEnabled: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hrsEarly, suggestedEc, ecTouched]);

  useEffect(() => {
    onViolation(rateCheck.allowed ? null : rateCheck.reason ?? "Rate below your discount limit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rateCheck.allowed, rateCheck.reason]);

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Room {index + 1}</h4>
        {onRemove && (
          <Button type="button" size="icon" variant="ghost" onClick={onRemove} aria-label="Remove room">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <Label>Check-in date *</Label>
          <div className="flex gap-2">
            <Input type="date" value={room.checkIn} onChange={(e) => onChange({ checkIn: e.target.value })} />
            <Input type="time" className="w-32" value={room.checkInTime} onChange={(e) => onChange({ checkInTime: e.target.value })} />
          </div>
        </div>
        <div className="grid content-start gap-2">
          <Label>Check-out date *</Label>
          <div className="flex gap-2">
            <Input type="date" value={room.checkOut} onChange={(e) => onChange({ checkOut: e.target.value })} />
            <Input type="time" className="w-32" value={room.checkOutTime} onChange={(e) => onChange({ checkOutTime: e.target.value })} />
          </div>
          {!datesValid && <p className="text-xs text-destructive">Check-out must be after check-in</p>}
        </div>

        <div className="grid content-start gap-2">
          <Label>Room Category *</Label>
          <SearchableSelect
            value={room.categoryId}
            onChange={(v) => onChange({ categoryId: v, roomId: "", planName: "", tariffId: "", rate: 0 })}
            options={cats.map((c) => ({ value: c.id, label: c.name }))}
            placeholder="Select category"
            searchPlaceholder="Type to filter categories…"
            alwaysShowSearch
          />
          {room.categoryId && tariffs.length > 0 && planNames.length === 0 && (
            <p className="text-xs text-destructive">{NO_TARIFF_PLAN_ERROR}</p>
          )}
        </div>

        {reservation ? (
          <div className="grid content-start gap-2">
            <Label>Room Number</Label>
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Assigned later — reservations hold the category only.
            </p>
          </div>
        ) : (
          <div className="grid content-start gap-2">
            <Label>Room Number {showRoomPicker ? "*" : ""}</Label>
            {showRoomPicker ? (
              <>
                <SearchableSelect
                  value={room.roomId}
                  onChange={(v) => onChange({ roomId: v })}
                  options={avail.map((a) => ({
                    value: a.id,
                    label: a.room_number,
                    hint: a.floor ? `Floor ${a.floor}` : undefined,
                  }))}
                  placeholder={loadingRooms ? "Loading available rooms…" : "Select room"}
                  searchPlaceholder="Type room number…"
                  emptyText="No rooms available for these dates"
                  alwaysShowSearch
                  disabled={!room.categoryId || !datesValid || loadingRooms}
                />
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {loadingRooms && <Loader2 className="h-3 w-3 animate-spin" />}
                  {availError ?? `${avail.length} available for ${room.checkIn} → ${room.checkOut}`}
                </p>
              </>
            ) : (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Room will be assigned later.
              </p>
            )}
            <label className="mt-1 flex items-center gap-2 text-xs">
              <Checkbox
                checked={room.assignLater}
                onCheckedChange={(c) => onChange({ assignLater: c === true, roomId: c === true ? "" : room.roomId })}
              />
              Assign room later
            </label>
          </div>
        )}

        <div className="grid content-start gap-2">
          <Label>Tariff Plan</Label>
          <SearchableSelect
            value={room.planName}
            onChange={(v) => onChange({ planName: v, rate: 0 })}
            options={planNames.map((n) => ({ value: n, label: n }))}
            placeholder="Select plan"
            searchPlaceholder="Type to filter plans…"
            alwaysShowSearch
            disabled={planNames.length === 0}
          />
        </div>

        <div className="grid content-start gap-2">
          <Label>Meal Plan</Label>
          <SearchableSelect
            value={room.mealPlan}
            onChange={(v) => onChange({ mealPlan: v, rate: 0 })}
            options={mealPlanOptions.map((m) => ({ value: m, label: MEAL_PLAN_LABELS[m] ?? m }))}
            placeholder="Select meal plan"
            searchPlaceholder="Type to filter…"
            alwaysShowSearch
            disabled={mealPlanOptions.length === 0}
          />
        </div>

        <div className="grid content-start gap-2">
          <Label>Rate / Night *</Label>
          <div className="flex gap-2">
            <Input
              type="number" min={0} step="0.01" value={room.rate || ""}
              onChange={(e) => onChange({ rate: Number(e.target.value) || 0 })}
            />
            <div className="w-40">
              <SearchableSelect
                value={room.rateType}
                onChange={(v) => onChange({ rateType: v as "exclusive" | "inclusive" })}
                options={[
                  { value: "exclusive", label: "Excl. GST" },
                  { value: "inclusive", label: "Incl. GST" },
                ]}
                placeholder="GST"
              />
            </div>
          </div>
          {standardRate > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Standard rate ₹{standardRate.toLocaleString("en-IN")}. {limitLabel}
            </p>
          )}
          {!rateCheck.allowed && <p className="text-xs text-destructive">{rateCheck.reason}</p>}
          {Number(room.rate) > 0 && (() => {
            const rate = Number(room.rate) || 0;
            const g = room.rateType === "inclusive"
              ? resolveGstRateInclusive(gstSlabs, "room", rate)
              : resolveGstRate(gstSlabs, "room", rate);
            if (g == null) {
              return (
                <p className="text-[11px] text-destructive">
                  No GST slab configured for this room tariff. Configure it in Master Data → GST Slabs.
                </p>
              );
            }
            if (room.rateType === "inclusive") {
              const taxable = rate / (1 + g / 100);
              return (
                <p className="text-[11px] text-muted-foreground">
                  Incl. GST {g}% → Taxable ₹{taxable.toFixed(2)} + GST ₹{(rate - taxable).toFixed(2)} = ₹{rate.toFixed(2)}
                </p>
              );
            }
            const gst = rate * g / 100;
            return (
              <p className="text-[11px] text-muted-foreground">
                Excl. GST {g}% → Taxable ₹{rate.toFixed(2)} + GST ₹{gst.toFixed(2)} = ₹{(rate + gst).toFixed(2)}
              </p>
            );
          })()}
        </div>

        <div className="flex items-start pt-8 text-xs text-muted-foreground">
          {nights > 0 && `${nights} night${nights === 1 ? "" : "s"} · ₹${((Number(room.rate) || 0) * nights).toLocaleString("en-IN")}`}
        </div>
      </div>

      {/* Optional add-on charges for this room line. */}
      <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={room.extraBedEnabled}
              onCheckedChange={(c) =>
                onChange({
                  extraBedEnabled: c === true,
                  extraBedRate:
                    c === true && !room.extraBedRate
                      ? Number(resolvedPlan?.extra_adult_rate) || 0
                      : room.extraBedRate,
                })
              }
            />
            Add extra bed
          </label>
          {room.extraBedEnabled && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number" min={1} max={4} value={room.extraBedQty || 1}
                  onChange={(e) => onChange({ extraBedQty: Math.max(1, Number(e.target.value) || 1) })}
                  aria-label="Extra bed quantity"
                />
                <Input
                  type="number" min={0} step="0.01" value={room.extraBedRate || ""}
                  onChange={(e) => onChange({ extraBedRate: Number(e.target.value) || 0 })}
                  aria-label="Extra bed rate per night"
                />
              </div>
              {(() => {
                const std = Number(resolvedPlan?.extra_adult_rate) || 0;
                const rate = Number(room.extraBedRate) || 0;
                const chk = std > 0 && rate > 0 && rate < std
                  ? canApplyDiscount(limit, { discountRupees: std - rate, base: std })
                  : { allowed: true as boolean, reason: undefined as string | undefined };
                return (
                  <>
                    <p className="text-[11px] text-muted-foreground">
                      {std > 0
                        ? `Tariff extra bed rate ₹${std.toLocaleString("en-IN")}/night × ${nights || 0} night(s).`
                        : "No extra bed rate on this tariff plan — enter one manually."}
                    </p>
                    {!chk.allowed && <p className="text-xs text-destructive">{chk.reason}</p>}
                  </>
                );
              })()}
            </>
          )}
        </div>

        <div className="space-y-2">
          {(() => {
            const hrs = hoursEarly(stdCheckinTime, room.checkInTime);
            const suggested = resolveEarlyCheckinCharge(ecSlabs, hrs);
            return (
              <>
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={room.earlyCheckinEnabled}
                    onCheckedChange={(c) => {
                      setEcTouched(true);
                      onChange({
                        earlyCheckinEnabled: c === true,
                        earlyCheckinHours: hrs,
                        earlyCheckinAmount:
                          c === true && !room.earlyCheckinAmount ? (suggested ?? 0) : room.earlyCheckinAmount,
                      });
                    }}
                    disabled={hrs <= 0 || suggested == null || suggested <= 0}
                  />
                  Early check-in
                </label>
                {hrs <= 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Arrival at/after standard check-in {stdCheckinTime} — no early check-in charge.
                  </p>
                ) : (
                  <>
                    {room.earlyCheckinEnabled && (
                      <Input
                        type="number" min={0} step="0.01" value={room.earlyCheckinAmount || ""}
                        onChange={(e) => onChange({ earlyCheckinAmount: Number(e.target.value) || 0 })}
                        aria-label="Early check-in amount"
                      />
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {hrs} hour(s) before standard check-in {stdCheckinTime}.{" "}
                      {suggested != null
                        ? `Suggested ₹${suggested.toLocaleString("en-IN")} (editable).`
                        : "No matching slab — set one up in Master Data → Early Check-in Slabs."}
                    </p>
                  </>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}