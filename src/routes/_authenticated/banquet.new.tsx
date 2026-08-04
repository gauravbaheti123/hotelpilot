import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { computeBanquetTotal, FUNCTION_TYPES } from "@/lib/banquet";
import { Plus, Trash2 } from "lucide-react";
import { RequirePermission } from "@/components/RequirePermission";
import { useDiscountLimit } from "@/hooks/use-discount-limit";
import { isValidMobile, sanitizeMobile, MOBILE_ERROR } from "@/lib/mobile";
import { type TariffPlan } from "@/lib/tariff";
import { useRoomCategories, useRooms, useTariffPlans } from "@/hooks/use-rooms";
import { commitRoomBlocks } from "@/lib/eventRoomBlocks";
import { EventRoomBlocks } from "@/components/booking-wizard/EventRoomBlocks";
import {
  assignedBlocksTotal, buildAssignedBlocks, checkRoomBlockDiscounts, roomBlocksSummary,
  validateRoomBlocks, type RoomOption,
} from "@/lib/eventRoomsForm";
import type { RoomBlockMode, WizardEventRoomRow } from "@/lib/bookingWizard";
import { isValidStayRange } from "@/lib/front-desk";
import { GuestSearchInput } from "@/components/GuestSearchInput";
import { istDateISO, istToday } from "@/lib/date";
import { createEventBooking, seedEventFolioCharges } from "@/lib/banquetEvent";
import { reportQueryError } from "@/lib/queryError";
import { toastError, errorMessage } from "@/lib/errorMessage";

export const Route = createFileRoute("/_authenticated/banquet/new")({
  head: () => ({ meta: [{ title: "New Banquet — HotelPilot" }] }),
  component: () => (
    <RequirePermission module="banquet">
      <NewBanquetPage />
    </RequirePermission>
  ),
});

interface Hall {
  id: string;
  name: string;
  capacity: number;
}
interface Cat {
  id: string;
  name: string;
}
type RoomOpt = RoomOption;
interface ExtraRow {
  point_name: string;
  amount: string;
}

function NewBanquetPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { currentId: propertyId } = useCurrentProperty();
  const { categories: sharedCats } = useRoomCategories(propertyId);
  const { plans: sharedPlans } = useTariffPlans(propertyId);
  const { rooms: sharedRooms } = useRooms(propertyId);
  const [halls, setHalls] = useState<Hall[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [tariffPlans, setTariffPlans] = useState<TariffPlan[]>([]);
  const [allRooms, setAllRooms] = useState<RoomOpt[]>([]);
  const [saving, setSaving] = useState(false);
  const { limit: discountLimit } = useDiscountLimit();

  const today = istToday();

  // guest
  const [guestName, setGuestName] = useState("");
  const [guestMobile, setGuestMobile] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  // Read-only reference to an existing guest, if one was explicitly picked.
  // Banquet never creates or edits `guests` rows from this form.
  const [linkedGuestId, setLinkedGuestId] = useState<string | null>(null);
  const [linkedGuestName, setLinkedGuestName] = useState<string | null>(null);

  // event
  const [hallId, setHallId] = useState("");
  const [functionType, setFunctionType] = useState("Wedding");
  const [eventDate, setEventDate] = useState(today);
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("23:00");
  // Phase 34.3 — events can run past midnight, so check-out has its own date.
  const [eventEndDate, setEventEndDate] = useState(today);
  const [pax, setPax] = useState("100");

  // charges
  const [eventPrice, setEventPrice] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [advance, setAdvance] = useState("0");
  const [notes, setNotes] = useState("");

  // Extras (repeatable named line items)
  const [extras, setExtras] = useState<ExtraRow[]>([]);

  // Rooms: two modes — single-assign or bulk-block
  const [roomMode, setRoomMode] = useState<RoomBlockMode>("none");
  const [eventName, setEventName] = useState("");
  // One row per physical room (single mode uses the first row only).
  const [blockRows, setBlockRows] = useState<WizardEventRoomRow[]>([]);

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const { data, error: __qe1 } = await supabase
        .from("halls")
        .select("id,name,capacity")
        .eq("property_id", propertyId)
        .eq("is_active", true)
        .order("name");
      if (__qe1) reportQueryError("halls", __qe1);
      setHalls((data ?? []) as Hall[]);
    })();
  }, [propertyId]);

  // Categories, tariff plans and rooms come from the shared caches
  // (see use-rooms.ts) instead of three per-mount queries.
  useEffect(() => {
    setCats(sharedCats as unknown as Cat[]);
  }, [sharedCats]);
  useEffect(() => {
    setTariffPlans(sharedPlans);
  }, [sharedPlans]);
  useEffect(() => {
    setAllRooms(
      sharedRooms
        .filter((r) => r.status === "vacant")
        .map((r) => ({
          id: r.id,
          room_number: r.room_number,
          category_id: r.category_id,
          category_name: r.category_name,
        })) as RoomOpt[],
    );
  }, [sharedRooms]);

  const extrasTotal = useMemo(
    () => extras.reduce((s, x) => s + (Number(x.amount) || 0), 0),
    [extras],
  );
  const total = useMemo(
    () =>
      computeBanquetTotal({
        package_rate: 0,
        pax: Number(pax),
        hall_charge: Number(eventPrice),
        fb_charge: 0,
        extra_charge: extrasTotal,
        discount_amount: Number(discount),
      }),
    [eventPrice, extrasTotal, pax, discount],
  );

  function addExtra() {
    setExtras((p) => [...p, { point_name: "", amount: "" }]);
  }
  function updateExtra(i: number, patch: Partial<ExtraRow>) {
    setExtras((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function removeExtra(i: number) {
    setExtras((p) => p.filter((_, idx) => idx !== i));
  }

  /** Shared room-block context (same helpers the wizard banquet path uses). */
  const blockCtx = useMemo(
    () => ({
      mode: roomMode,
      rows: blockRows,
      rooms: allRooms,
      plans: tariffPlans,
      eventDate,
      hostName: guestName,
      hostMobile: guestMobile,
    }),
    [roomMode, blockRows, allRooms, tariffPlans, eventDate, guestName, guestMobile],
  );
  const blockSummary = useMemo(() => roomBlocksSummary(blockCtx), [blockCtx]);
  const summaryRoomRevenue = blockSummary.revenue;

  async function save() {
    if (!propertyId) return;
    if (!guestName.trim()) return toast.error("Guest name required");
    if (!isValidMobile(guestMobile)) return toast.error(MOBILE_ERROR);
    if (!eventDate || !startTime || !eventEndDate || !endTime)
      return toast.error("Event check-in / check-out date & time required");
    if (!isValidStayRange(eventDate, eventEndDate, startTime, endTime))
      return toast.error("Event check-out must be after check-in");
    const invalid = validateRoomBlocks(blockCtx, eventName);
    if (invalid) return toast.error(invalid);
    const overLimit = checkRoomBlockDiscounts(discountLimit, blockCtx);
    if (overLimit) return toast.error(overLimit);
    setSaving(true);
    try {
      const advanceAmt = Number(advance) || 0;

      const finalAssignments = buildAssignedBlocks(blockCtx);
      const totalRoomCharges = assignedBlocksTotal(finalAssignments);
      const combinedTotal = total + totalRoomCharges;

      const extraRows = extras
        .map((x, idx) => ({
          point_name: x.point_name.trim(),
          amount: Number(x.amount) || 0,
          sort_order: idx,
        }))
        .filter((x) => x.point_name && x.amount > 0);

      // Unified model: creates the bookings row (booking_type='banquet') with the
      // next EVT number, the legacy mirror row, the extra-charge lines and the
      // seeded event folio — all in one transaction.
      const created = await createEventBooking({
        property_id: propertyId,
        hall_id: hallId || null,
        // Read-only link only when a guest was explicitly selected from search.
        guest_id: linkedGuestId,
        host_name: guestName.trim(),
        host_mobile: guestMobile.trim() || null,
        host_email: guestEmail.trim() || null,
        event_name: roomMode !== "none" ? eventName : null,
        function_type: functionType,
        event_date: eventDate,
        event_end_date: eventEndDate,
        start_time: startTime,
        end_time: endTime,
        pax: Number(pax) || 0,
        package_rate: 0,
        hall_charge: Number(eventPrice) || 0,
        fb_charge: 0,
        extra_charge: extrasTotal,
        discount_amount: Number(discount) || 0,
        total_amount: combinedTotal,
        advance_amount: advanceAmt,
        balance_amount: Math.max(0, combinedTotal - advanceAmt),
        total_room_charges: totalRoomCharges,
        notes: notes || null,
        extras: extraRows.map((x) => ({ point_name: x.point_name, amount: x.amount })),
      });

      let roomsBlocked = 0;
      if (roomMode !== "none" && finalAssignments.length > 0) {
        roomsBlocked = await commitRoomBlocks({
          propertyId,
          eventBookingId: created.bookingId,
          eventName,
          rows: finalAssignments,
        });
      }

      // Re-seed so any rooms assigned above also land on the event folio.
      await seedEventFolioCharges(created.bookingId).catch((e) =>
        toast.error(`Event saved, but the folio charges could not be added. ${errorMessage(e, "adding folio charges")}`),
      );

      const bn = created.banquetNumber;
      toast.success(
        roomsBlocked > 0
          ? `Event saved — ${bn} generated, ${roomsBlocked} rooms assigned to event`
          : `Event saved — ${bn} generated`,
      );
      router.navigate({ to: "/banquet/event/$id", params: { id: created.bookingId } });
    } catch (e: any) {
      toastError(e, "Failed");
    } finally {
      setSaving(false);
    }
  }

  if (!propertyId)
    return (
      <AppShell title="New Banquet">
        <EmptyPropertyState />
      </AppShell>
    );

  return (
    <AppShell title="New Banquet Event">
      <div className="max-w-5xl grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Guest / Host</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Field label="Name *">
                <GuestSearchInput
                  propertyId={propertyId}
                  value={guestName}
                  mobile={guestMobile}
                  allowCreate={false}
                  placeholder="Search existing or type new"
                  onChange={(v) => setGuestName(v)}
                  onSelect={(g) => {
                    setLinkedGuestId(g.id);
                    setLinkedGuestName(g.name);
                    setGuestName(g.name);
                    setGuestMobile(sanitizeMobile(g.mobile ?? ""));
                    setGuestEmail(g.email ?? "");
                  }}
                />
                {linkedGuestId ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Linked to existing guest (reference only — their CRM record is never changed).
                    <button
                      type="button"
                      className="ml-1 underline"
                      onClick={() => {
                        setLinkedGuestId(null);
                        setLinkedGuestName(null);
                      }}
                    >
                      Unlink
                    </button>
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Manual entry is saved on this event only.
                  </p>
                )}
              </Field>
              <Field label="Mobile *">
                <Input
                  value={guestMobile}
                  onChange={(e) => setGuestMobile(sanitizeMobile(e.target.value))}
                  inputMode="numeric"
                  pattern="\d{10}"
                  maxLength={10}
                  placeholder="10-digit mobile"
                  className={
                    guestMobile && !isValidMobile(guestMobile)
                      ? "border-red-500 focus-visible:ring-red-500"
                      : ""
                  }
                />
                {guestMobile && !isValidMobile(guestMobile) && (
                  <p className="mt-1 text-[11px] text-red-600">{MOBILE_ERROR}</p>
                )}
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Event</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Field label="Hall (optional)">
                <Select value={hallId} onValueChange={setHallId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick hall" />
                  </SelectTrigger>
                  <SelectContent>
                    {halls.length === 0 && (
                      <div className="px-2 py-1 text-xs text-muted-foreground">
                        Add halls in Masters first.
                      </div>
                    )}
                    {halls.map((h) => (
                      <SelectItem key={h.id} value={h.id}>
                        {h.name} · cap {h.capacity}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Function type">
                <Select value={functionType} onValueChange={setFunctionType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FUNCTION_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Pax">
                <Input type="number" value={pax} onChange={(e) => setPax(e.target.value)} />
              </Field>
              <Field label="Check-in Date *">
                <Input
                  type="date"
                  value={eventDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEventDate(v);
                    if (!eventEndDate || eventEndDate < v) setEventEndDate(v);
                  }}
                />
              </Field>
              <Field label="Check-in Time *">
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </Field>
              <Field label="Check-out Date *">
                <Input
                  type="date"
                  value={eventEndDate}
                  min={eventDate}
                  onChange={(e) => setEventEndDate(e.target.value)}
                />
              </Field>
              <Field label="Check-out Time *">
                <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Charges</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Field label="Event Price (₹) *">
                <Input
                  type="number"
                  value={eventPrice}
                  onChange={(e) => setEventPrice(e.target.value)}
                />
              </Field>
              <Field label="Discount (₹)">
                <Input
                  type="number"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                />
              </Field>
              <Field label="Advance (₹)">
                <Input type="number" value={advance} onChange={(e) => setAdvance(e.target.value)} />
              </Field>
              <Field label="Notes" wide>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Extra Charges</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addExtra}>
                <Plus className="h-4 w-4 mr-1" /> Add Extra Charge
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {extras.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Optional. Add named line items (e.g. "DJ Setup", "Extra Chairs", "Decoration")
                  that appear on the event bill.
                </p>
              )}
              {extras.map((x, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1.5fr_140px_30px] items-end">
                  <Field label={i === 0 ? "Point name" : ""}>
                    <Input
                      placeholder="e.g. DJ Setup"
                      value={x.point_name}
                      onChange={(e) => updateExtra(i, { point_name: e.target.value })}
                    />
                  </Field>
                  <Field label={i === 0 ? "Amount (₹)" : ""}>
                    <Input
                      type="number"
                      value={x.amount}
                      onChange={(e) => updateExtra(i, { amount: e.target.value })}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => removeExtra(i)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rooms · Assign Guest</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <EventRoomBlocks
                mode={roomMode}
                onModeChange={setRoomMode}
                eventName={eventName}
                onEventNameChange={setEventName}
                rows={blockRows}
                onRowsChange={setBlockRows}
                eventDate={eventDate}
                rooms={allRooms}
                plans={tariffPlans}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="self-start sticky top-4">
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <Row k="Event Price" v={`₹${Number(eventPrice).toLocaleString("en-IN")}`} />
            {extrasTotal > 0 && <Row k="Extras" v={`₹${extrasTotal.toLocaleString("en-IN")}`} />}
            {Number(discount) > 0 && (
              <Row k="Discount" v={`- ₹${Number(discount).toLocaleString("en-IN")}`} />
            )}
            {blockSummary.revenue > 0 && (
              <Row
                k={`Rooms (${blockSummary.totalRooms})`}
                v={`₹${blockSummary.revenue.toLocaleString("en-IN")}`}
              />
            )}
            <div className="border-t pt-2">
              <Row k="Total" v={`₹${(total + summaryRoomRevenue).toLocaleString("en-IN")}`} bold />
              <Row k="Advance" v={`₹${Number(advance).toLocaleString("en-IN")}`} />
              <Row
                k="Balance"
                v={`₹${Math.max(0, total + summaryRoomRevenue - Number(advance)).toLocaleString("en-IN")}`}
                bold
                highlight
              />
            </div>
            <div className="pt-3 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => router.history.back()}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Assign Guest / Save"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`space-y-1.5 ${wide ? "sm:col-span-3" : ""}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
function Row({
  k,
  v,
  bold,
  highlight,
}: {
  k: string;
  v: React.ReactNode;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${bold ? "font-semibold" : ""} ${highlight ? "text-amber-700" : ""}`}
    >
      <span className={bold ? "" : "text-muted-foreground"}>{k}</span>
      <span>{v}</span>
    </div>
  );
}
