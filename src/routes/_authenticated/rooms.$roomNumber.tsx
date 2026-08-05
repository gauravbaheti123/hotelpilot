import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { fetchBanquetScope, isBanquetRecord } from "@/lib/banquetScope";
import { AppShell } from "@/components/AppShell";
import { useCurrentProperty } from "@/hooks/use-property";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FolioOpenButton, useFolioOpener } from "@/components/FolioOpenButton";
import { BackButton } from "@/components/BackButton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronLeft, LogOut } from "lucide-react";
import { toast } from "sonner";
import { CheckoutDialog } from "@/components/CheckoutDialog";

import { RequirePermission } from "@/components/RequirePermission";
import { reportQueryError } from "@/lib/queryError";
import { toastError } from "@/lib/errorMessage";
export const Route = createFileRoute("/_authenticated/rooms/$roomNumber")({
  head: () => ({ meta: [{ title: "Room Detail — HotelPilot" }] }),
  component: () => (<RequirePermission module="room_board"><RoomDetailPage /></RequirePermission>),
});

type RoomRow = {
  id: string;
  property_id: string;
  room_number: string;
  floor: number | null;
  status: "vacant" | "occupied" | "blocked" | "maintenance";
  housekeeping_status: "clean" | "dirty" | "inspected" | "out_of_order";
  notes: string | null;
  category: { id: string; name: string } | null;
};

type CurrentBooking = {
  id: string;
  booking_number: string;
  source: string | null;
  status: string;
  check_in: string;
  check_out: string;
  checked_in_at: string | null;
  adults: number;
  children: number;
  total_amount: number;
  advance_amount: number;
  balance_amount: number;
  guest: { name: string | null; mobile: string | null; id_proof_type: string | null; id_proof_number: string | null } | null;
  br: { rate: number; check_in: string; check_out: string; tariff: { name: string } | null } | null;
};

type Kot = { id: string; kot_number: string | null; status: string; total_amount: number; created_at: string; items: { item_name: string; qty: number }[] };
type HkTask = { id: string; task_type: string; status: string; due_date: string | null; assigned_to: string | null; completed_at: string | null; notes: string | null };
type HistoryRow = { id: string; booking_number: string; check_in: string; check_out: string; total_amount: number; advance_amount: number; guest_name: string | null };
type FolioCharge = { id: string; charge_type: string; description: string | null; amount: number; charged_on: string };

function nightsBetween(a: string, b: string) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.max(1, Math.round(ms / 86_400_000));
}
function inr(n: number) { return `₹${Number(n || 0).toLocaleString("en-IN")}`; }
function fmtDT(d: string | null) { return d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"; }
function fmtD(d: string | null) { return d ? new Date(d).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—"; }

function RoomDetailPage() {
  const { roomNumber } = Route.useParams();
  const navigate = useNavigate();
  const { currentId } = useCurrentProperty();

  const [loading, setLoading] = useState(true);
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [booking, setBooking] = useState<CurrentBooking | null>(null);
  const [folioId, setFolioId] = useState<string | null>(null);
  const [charges, setCharges] = useState<FolioCharge[]>([]);
  const [paid, setPaid] = useState(0);
  const [kots, setKots] = useState<Kot[]>([]);
  const [tasks, setTasks] = useState<HkTask[]>([]);
  const [staffMap, setStaffMap] = useState<Record<string, string>>({});
  const [lastClean, setLastClean] = useState<{ at: string | null; by: string | null }>({ at: null, by: null });
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const load = useCallback(async () => {
    if (!currentId) return;
    setLoading(true);

    const { data: r, error: rErr } = await supabase
      .from("rooms")
      .select("id, property_id, room_number, floor, status, housekeeping_status, notes, category:room_categories(id, name)")
      .eq("property_id", currentId)
      .eq("room_number", roomNumber)
      .maybeSingle();
    if (rErr) { toastError(rErr); setLoading(false); return; }
    if (!r) { setRoom(null); setLoading(false); return; }
    setRoom(r as any);

    // current booking via booking_rooms
    const { data: brRows, error: __qe1 } = await supabase
      .from("booking_rooms")
      .select("rate, check_in, check_out, tariff:tariff_plans(name), booking:bookings!booking_rooms_booking_id_fkey!inner(id, booking_number, source, status, check_in, check_out, checked_in_at, adults, children, total_amount, advance_amount, balance_amount, guest:guests(name, mobile, id_proof_type, id_proof_number))")
      .eq("room_id", (r as any).id)
      .in("booking.status", ["checked_in"])
      .order("check_in", { ascending: false })
      .limit(1);
    if (__qe1) reportQueryError("booking rooms", __qe1);

    const live = (brRows ?? []).find((x: any) => x.booking) as any;
    if (live?.booking) {
      const b = live.booking;
      const cb: CurrentBooking = {
        id: b.id, booking_number: b.booking_number, source: b.source, status: b.status,
        check_in: b.check_in, check_out: b.check_out, checked_in_at: b.checked_in_at,
        adults: b.adults, children: b.children,
        total_amount: Number(b.total_amount || 0), advance_amount: Number(b.advance_amount || 0), balance_amount: Number(b.balance_amount || 0),
        guest: b.guest,
        br: { rate: Number(live.rate || 0), check_in: live.check_in, check_out: live.check_out, tariff: live.tariff },
      };
      setBooking(cb);

      // folio + charges + payments
      const { data: f, error: __qe2 } = await supabase.from("folios").select("id").eq("booking_id", b.id).maybeSingle();
      if (__qe2) reportQueryError("folios", __qe2);
      setFolioId(f?.id ?? null);
      if (f?.id) {
        const [{ data: ch, error: __qp1 }, { data: pays, error: __qp2 }] = await Promise.all([
          supabase.from("folio_charges").select("id, charge_type, description, amount, charged_on").eq("folio_id", f.id).order("charged_on"),
          supabase.from("payments").select("amount").eq("folio_id", f.id),
        ]);
        if (__qp1) reportQueryError("folio charges", __qp1);
        if (__qp2) reportQueryError("payments", __qp2);
        setCharges((ch ?? []) as any);
        setPaid((pays ?? []).reduce((a: number, x: any) => a + Number(x.amount || 0), 0));
      } else {
        setCharges([]); setPaid(Number(b.advance_amount || 0));
      }

      // KOTs
      const { data: kotRows, error: __qe3 } = await supabase
        .from("kot_orders")
        .select("id, kot_number, status, total_amount, created_at, items:kot_items(item_name, qty)")
        .eq("booking_id", b.id)
        .order("created_at", { ascending: false });
      if (__qe3) reportQueryError("kot orders", __qe3);
      setKots((kotRows ?? []) as any);
    } else {
      setBooking(null); setFolioId(null); setCharges([]); setPaid(0); setKots([]);
    }

    // Housekeeping tasks for this room
    const { data: hk, error: __qe4 } = await supabase
      .from("housekeeping_tasks")
      .select("id, task_type, status, due_date, assigned_to, completed_at, notes")
      .eq("room_id", (r as any).id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (__qe4) reportQueryError("housekeeping tasks", __qe4);
    const hkRows = (hk ?? []) as HkTask[];
    setTasks(hkRows);

    // staff names
    const ids = Array.from(new Set(hkRows.map((t) => t.assigned_to).filter(Boolean))) as string[];
    if (ids.length) {
      const { data: st, error: __qe5 } = await supabase.from("staff").select("id, full_name").in("id", ids);
      if (__qe5) reportQueryError("staff", __qe5);
      const m: Record<string, string> = {};
      (st ?? []).forEach((s: any) => { m[s.id] = s.full_name; });
      setStaffMap(m);
    } else setStaffMap({});

    const lastDone = hkRows.find((t) => t.status === "done" || t.completed_at);
    setLastClean({ at: lastDone?.completed_at ?? null, by: lastDone?.assigned_to ? null : null });

    // booking history (last 5, any status, scoped to this room)
    const { data: histBr, error: __qe6 } = await supabase
      .from("booking_rooms")
      .select("booking:bookings!booking_rooms_booking_id_fkey(id, booking_number, check_in, check_out, total_amount, advance_amount, guest:guests(name))")
      .eq("room_id", (r as any).id)
      .order("check_in", { ascending: false })
      .limit(8);
    if (__qe6) reportQueryError("booking rooms", __qe6);
    // Banquet event-block stays leave room history 48h after the event ends.
    const bqScope = await fetchBanquetScope(null);
    const histRows: HistoryRow[] = (histBr ?? [])
      .map((x: any) => x.booking)
      .filter(Boolean)
      .filter((b: any) => !isBanquetRecord(bqScope, { booking_id: b.id }))
      .slice(0, 5)
      .map((b: any) => ({
        id: b.id, booking_number: b.booking_number, check_in: b.check_in, check_out: b.check_out,
        total_amount: Number(b.total_amount || 0), advance_amount: Number(b.advance_amount || 0),
        guest_name: b.guest?.name ?? null,
      }));
    setHistory(histRows);

    setLoading(false);
  }, [currentId, roomNumber]);

  useEffect(() => { load(); }, [load]);

  async function setRoomField(patch: Partial<Pick<RoomRow, "status" | "housekeeping_status">>) {
    if (!room) return;
    const { error } = await supabase.from("rooms").update(patch).eq("id", room.id);
    if (error) return toastError(error);
    toast.success("Room updated");
    load();
  }

  if (loading) return <AppShell title="Room"><div className="p-4 text-sm text-muted-foreground">Loading…</div></AppShell>;
  if (!room) return (
    <AppShell title="Room">
      <div className="max-w-2xl space-y-3">
        <BackButton variant="ghost" fallbackTo="/dashboard" />
        <Card><CardContent className="p-6 text-sm">Room <b>{roomNumber}</b> not found for this property.</CardContent></Card>
      </div>
    </AppShell>
  );

  const isOccupied = room.status === "occupied" && !!booking;
  const isMaintenance = room.status === "maintenance";
  const isDirty = room.housekeeping_status === "dirty";

  // billing breakdown
  const bucket = (types: string[]) => charges.filter((c) => types.includes(c.charge_type)).reduce((a, c) => a + Number(c.amount || 0), 0);
  const roomCharges = bucket(["room", "room_charge", "tariff"]);
  const foodCharges = bucket(["food", "kot", "restaurant"]);
  const sundryCharges = bucket(["sundry", "pos", "misc"]);
  const laundryCharges = bucket(["laundry"]);
  const otherCharges = charges
    .filter((c) => !["room","room_charge","tariff","food","kot","restaurant","sundry","pos","misc","laundry","discount","tax","gst"].includes(c.charge_type))
    .reduce((a, c) => a + Number(c.amount || 0), 0);
  const totalDues = booking?.total_amount ?? (roomCharges + foodCharges + sundryCharges + laundryCharges + otherCharges);
  const balanceDue = booking ? booking.balance_amount : Math.max(0, totalDues - paid);

  const pendingLaundry = charges.filter((c) => c.charge_type === "laundry");

  return (
    <AppShell title={`Room ${room.room_number}`}>
      <div className="max-w-5xl space-y-4">
        <BackButton variant="ghost" fallbackTo="/dashboard" />

        {/* HEADER */}
        <Card>
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">Room {room.room_number}</h1>
                <p className="text-sm text-muted-foreground">
                  {room.category?.name ?? "Uncategorised"}{room.floor != null ? ` · Floor ${room.floor}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusBadge label={room.status} variant={isOccupied ? "destructive" : isMaintenance ? "secondary" : "default"} />
                  <Badge variant={isDirty ? "secondary" : "outline"} className={isDirty ? "bg-amber-100 text-amber-800" : ""}>
                    HK: {room.housekeeping_status}
                  </Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {!isOccupied && !isMaintenance && (
                  <Button asChild size="sm">
                    <Link
                      to="/front-desk/new"
                      search={{ roomId: room.id, categoryId: room.category?.id ?? undefined } as never}
                    >
                      + New Booking
                    </Link>
                  </Button>
                )}
                {isOccupied && booking && (
                  <FolioOpenButton bookingId={booking.id} size="sm" variant="outline">
                    View Bill
                  </FolioOpenButton>
                )}
                {isOccupied && booking && (
                  <Button size="sm" onClick={() => setCheckoutOpen(true)}>
                    <LogOut className="h-4 w-4 mr-1" /> Checkout
                  </Button>
                )}
                <Button size="sm" variant="outline"
                  onClick={() => setRoomField({ housekeeping_status: isDirty ? "clean" : "dirty" })}>
                  {isDirty ? "Mark Clean" : "Mark Dirty"}
                </Button>
                <Button size="sm" variant="outline"
                  onClick={() => setRoomField({ status: isMaintenance ? "vacant" : "maintenance" })}>
                  {isMaintenance ? "Clear Maintenance" : "Mark Maintenance"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {isOccupied && booking && (
          <Section title="Current Guest" defaultOpen>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field k="Guest" v={booking.guest?.name ?? "—"} />
              <Field k="Mobile" v={booking.guest?.mobile ?? "—"} />
              <Field k="Checked in" v={fmtDT(booking.checked_in_at)} />
              <Field k="Expected checkout" v={fmtD(booking.check_out)} />
              <Field k="Nights" v={String(nightsBetween(booking.check_in, booking.check_out))} />
              <Field k="Adults / Children" v={`${booking.adults} / ${booking.children}`} />
              <Field k="Source" v={booking.source ?? "—"} />
              <Field k="ID proof" v={booking.guest?.id_proof_type ? `${booking.guest.id_proof_type} · ${booking.guest.id_proof_number ?? ""}` : "—"} />
              <Field k="Tariff plan" v={booking.br?.tariff?.name ?? "—"} />
              <Field k="Rate / night" v={inr(booking.br?.rate ?? 0)} />
              <Field k="Booking #" v={
                <Link className="text-primary underline" to="/front-desk/booking/$id" params={{ id: booking.id }}>{booking.booking_number}</Link>
              } />
            </div>
          </Section>
        )}

        {isOccupied && booking && (
          <Section title="Billing Summary" defaultOpen>
            <div className="grid gap-2 sm:grid-cols-2">
              <Row k="Room charges" v={inr(roomCharges)} />
              <Row k="Food / KOT" v={inr(foodCharges)} />
              <Row k="Sundry / POS" v={inr(sundryCharges)} />
              <Row k="Laundry" v={inr(laundryCharges)} />
              <Row k="Other" v={inr(otherCharges)} />
              <Row k="Total dues" v={inr(totalDues)} bold />
              <Row k="Paid / advance" v={inr(paid || booking.advance_amount)} />
              <Row k="Balance due" v={inr(balanceDue)} bold danger={balanceDue > 0} />
            </div>
            {folioId && (
              <div className="mt-3">
                <FolioOpenButton bookingId={booking.id} size="sm" variant="outline">
                  Open folio
                </FolioOpenButton>
              </div>
            )}
          </Section>
        )}

        {isOccupied && booking && (
          <Section title={`Food Orders (${kots.length})`}>
            {kots.length === 0 ? (
              <p className="text-sm text-muted-foreground">No KOTs for this booking.</p>
            ) : (
              <ul className="divide-y">
                {kots.map((k) => (
                  <li key={k.id} className="py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{k.kot_number ?? "KOT"} · <span className="text-muted-foreground font-normal">{fmtDT(k.created_at)}</span></div>
                      <div className="text-xs text-muted-foreground truncate">
                        {(k.items ?? []).map((i) => `${i.item_name} ×${i.qty}`).join(", ") || "—"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm">{inr(k.total_amount)}</div>
                      <Badge variant="outline" className="text-[10px] uppercase">{k.status}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        <Section title="Housekeeping" defaultOpen>
          <div className="grid gap-2 sm:grid-cols-2 mb-3">
            <Field k="Last cleaned" v={fmtDT(lastClean.at)} />
            <Field k="Pending tasks" v={String(tasks.filter((t) => t.status !== "done").length)} />
          </div>
          <div className="mb-3">
            <Button asChild size="sm">
              <Link to="/housekeeping/new" search={{ room: room.id } as any}>+ Add Task</Link>
            </Button>
          </div>
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks for this room.</p>
          ) : (
            <ul className="divide-y">
              {tasks.map((t) => (
                <li key={t.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium capitalize">{t.task_type}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtD(t.due_date)}{t.assigned_to ? ` · ${staffMap[t.assigned_to] ?? "Staff"}` : ""}
                      {t.notes ? ` · ${t.notes}` : ""}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] uppercase shrink-0">{t.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {isOccupied && (
          <Section title="Laundry">
            {pendingLaundry.length === 0 ? (
              <p className="text-sm text-muted-foreground">No laundry items.</p>
            ) : (
              <ul className="divide-y">
                {pendingLaundry.map((c) => (
                  <li key={c.id} className="py-2 flex justify-between text-sm">
                    <span>{c.description ?? "Laundry"}<span className="text-xs text-muted-foreground"> · {fmtD(c.charged_on)}</span></span>
                    <span>{inr(c.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        <Section title="Booking History" defaultOpen>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No previous bookings.</p>
          ) : (
            <ul className="divide-y">
              {history.map((h) => (
                <li key={h.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      <Link to="/front-desk/booking/$id" params={{ id: h.id }} className="hover:underline">{h.guest_name ?? "Guest"}</Link>
                    </div>
                    <div className="text-xs text-muted-foreground">{h.booking_number} · {fmtD(h.check_in)} → {fmtD(h.check_out)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm">{inr(h.total_amount)}</div>
                    <div className="text-xs text-muted-foreground">Paid {inr(h.advance_amount)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <CheckoutDialog
        bookingId={booking?.id ?? null}
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        onDone={() => { setCheckoutOpen(false); load(); }}
      />
    </AppShell>
  );
}

function StatusBadge({ label, variant }: { label: string; variant: "default" | "secondary" | "destructive" | "outline" }) {
  return <Badge variant={variant} className="capitalize">{label}</Badge>;
}

function Field({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="text-sm">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className="font-medium">{v}</div>
    </div>
  );
}

function Row({ k, v, bold, danger }: { k: string; v: React.ReactNode; bold?: boolean; danger?: boolean }) {
  return (
    <div className={`flex justify-between border-b py-1.5 text-sm ${bold ? "font-semibold" : ""} ${danger ? "text-red-600" : ""}`}>
      <span>{k}</span><span>{v}</span>
    </div>
  );
}

function Section({ title, children, defaultOpen }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">{title}</CardTitle>
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Separator />
          <CardContent className="pt-4">{children}</CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}