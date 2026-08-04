import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useRooms } from "@/hooks/use-rooms";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckoutDialog } from "@/components/CheckoutDialog";
import { LogOut, AlertTriangle, UserPlus, DoorOpen, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";

import { RequirePermission } from "@/components/RequirePermission";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { istToday } from "@/lib/date";
import { reportQueryError, guardQuery } from "@/lib/queryError";
import { toastError } from "@/lib/errorMessage";
export const Route = createFileRoute("/_authenticated/front-desk/in-house")({
  head: () => ({ meta: [{ title: "In-house — HotelPilot" }] }),
  component: () => (<RequirePermission module="inhouse"><InHousePage /></RequirePermission>),
});

interface InHouseRow {
  id: string;
  booking_number: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  balance_amount: number;
  guests: { name: string; mobile: string | null } | null;
  booking_rooms: { id: string; rate: number; rooms: { room_number: string } | null }[];
}

function InHousePage() {
  const { current, loading: propLoading } = useCurrentProperty();
  const [rows, setRows] = useState<InHouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [assignGuestFor, setAssignGuestFor] = useState<string | null>(null);
  const [assignRoomFor, setAssignRoomFor] = useState<string | null>(null);

  async function load() {
    if (!current) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("bookings")
      .select("id,booking_number,check_in,check_out,adults,children,balance_amount,guests(name,mobile),booking_rooms!booking_rooms_booking_id_fkey(id,rate,rooms!booking_rooms_room_id_fkey(room_number))")
      .eq("property_id", current.id)
      .eq("status", "checked_in")
      .order("check_out", { ascending: true });
    if (error) toastError(error);
    setRows((data ?? []) as unknown as InHouseRow[]);
    setLoading(false);
  }

  useEffect(() => {
    if (current) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const today = istToday();

  if (propLoading) return <AppShell title="In-house"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!current) return <AppShell title="In-house"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="In-house Guests">
      <div className="max-w-7xl space-y-4">
        <Card>
          <CardContent className="pt-6">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No guests currently in-house.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Booking</TableHead>
                    <TableHead>Guest</TableHead>
                    <TableHead>Room(s)</TableHead>
                    <TableHead>Pax</TableHead>
                    <TableHead>Check-out</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const overdue = r.check_out < today;
                    const dueToday = r.check_out === today;
                    const noGuest = !r.guests?.name;
                    const noRoom = (r.booking_rooms ?? []).every((br) => !br.rooms?.room_number);
                    const incomplete = noGuest || noRoom;
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Link to="/front-desk/booking/$id" params={{ id: r.id }} className="text-primary font-medium hover:underline">
                            {r.booking_number}
                          </Link>
                        </TableCell>
                        <TableCell>
                          {r.guests?.name ? (
                            <>
                              <div>{r.guests.name}</div>
                              <div className="text-xs text-muted-foreground">{r.guests?.mobile ?? ""}</div>
                            </>
                          ) : (
                            <div className="flex items-center gap-1 text-amber-700 dark:text-amber-300 italic">
                              <AlertTriangle className="h-3.5 w-3.5" /> Unassigned
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.booking_rooms.map((br) => br.rooms?.room_number).filter(Boolean).join(", ") || (
                            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300 italic">
                              <AlertTriangle className="h-3.5 w-3.5" /> Unassigned
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{r.adults}A {r.children > 0 ? `${r.children}C` : ""}</TableCell>
                        <TableCell className="text-xs">
                          {r.check_out}
                          {overdue && <Badge className="ml-2 bg-[#b45309] text-white border-transparent font-bold">OVERDUE</Badge>}
                          {!overdue && dueToday && <Badge className="ml-2" variant="outline">Due</Badge>}
                        </TableCell>
                        <TableCell className={r.balance_amount > 0 ? "text-amber-700 dark:text-amber-300 font-medium" : ""}>
                          ₹{Number(r.balance_amount).toLocaleString("en-IN")}
                        </TableCell>
                        <TableCell>
                          {incomplete ? (
                            <div className="flex flex-wrap gap-1.5">
                              {noGuest && (
                                <Button size="sm" variant="outline" onClick={() => setAssignGuestFor(r.id)}>
                                  <UserPlus className="h-4 w-4 mr-1" /> Assign Guest
                                </Button>
                              )}
                              {noRoom && (
                                <Button size="sm" variant="outline" onClick={() => setAssignRoomFor(r.id)}>
                                  <DoorOpen className="h-4 w-4 mr-1" /> Assign Room
                                </Button>
                              )}
                              <Button
                                size="sm" variant="outline"
                                className="text-red-600 hover:text-red-700"
                                onClick={async () => {
                                  if (!confirm("Cancel this incomplete booking?")) return;
                                  const { error } = await supabase.from("bookings")
                                    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_reason: "Manual cancel — incomplete booking" } as any)
                                    .eq("id", r.id);
                                  if (error) return toastError(error);
                                  toast.success("Booking cancelled");
                                  load();
                                }}
                              >
                                <X className="h-4 w-4 mr-1" /> Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button size="sm" variant={overdue ? "default" : "outline"}
                              className={overdue ? "bg-red-600 hover:bg-red-700 text-white" : ""}
                              onClick={() => setCheckoutId(r.id)}>
                              <LogOut className="h-4 w-4 mr-1" /> {overdue ? "Checkout Now" : "Checkout"}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
      <CheckoutDialog
        bookingId={checkoutId}
        open={!!checkoutId}
        onOpenChange={(o) => { if (!o) setCheckoutId(null); }}
        onDone={() => { setCheckoutId(null); load(); }}
      />
      <AssignGuestDialog
        bookingId={assignGuestFor}
        propertyId={current?.id ?? null}
        onClose={() => setAssignGuestFor(null)}
        onDone={() => { setAssignGuestFor(null); load(); }}
      />
      <AssignRoomDialog
        bookingId={assignRoomFor}
        propertyId={current?.id ?? null}
        booking={rows.find((r) => r.id === assignRoomFor) ?? null}
        onClose={() => setAssignRoomFor(null)}
        onDone={() => { setAssignRoomFor(null); load(); }}
      />
    </AppShell>
  );
}

function AssignGuestDialog({
  bookingId, propertyId, onClose, onDone,
}: {
  bookingId: string | null;
  propertyId: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Array<{ id: string; name: string; mobile: string | null }>>([]);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMobile, setNewMobile] = useState("");

  useEffect(() => {
    if (!bookingId) { setSearch(""); setResults([]); setNewName(""); setNewMobile(""); }
  }, [bookingId]);

  useEffect(() => {
    if (!bookingId || !propertyId || search.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      const like = `%${search.trim()}%`;
      const { data, error: __qe1 } = await supabase
        .from("guests")
        .select("id,name,mobile")
        .eq("property_id", propertyId)
        .or(`name.ilike.${like},mobile.ilike.${like}`)
        .limit(10);
      if (__qe1) reportQueryError("guests", __qe1);
      setResults((data ?? []) as any);
    }, 250);
    return () => clearTimeout(t);
  }, [search, bookingId, propertyId]);

  const assign = async (guestId: string) => {
    if (!bookingId) return;
    setBusy(true);
    const { error } = await supabase.from("bookings").update({ guest_id: guestId } as any).eq("id", bookingId);
    setBusy(false);
    if (error) return toastError(error);
    toast.success("Guest assigned");
    onDone();
  };

  const createAndAssign = async () => {
    if (!bookingId || !propertyId) return;
    if (!newName.trim() || !newMobile.trim()) return toast.error("Name and mobile required");
    setBusy(true);
    const { data, error } = await supabase.from("guests")
      .insert({ property_id: propertyId, name: newName.trim(), mobile: newMobile.trim() } as any)
      .select("id").single();
    if (error || !data) { setBusy(false); return toastError(error, "Failed"); }
    await assign(data.id);
  };

  return (
    <Dialog open={!!bookingId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Guest</DialogTitle>
          <DialogDescription>Search an existing guest or create a new one.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Search by name or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {results.length > 0 && (
            <div className="border rounded divide-y max-h-48 overflow-y-auto">
              {results.map((g) => (
                <button key={g.id} type="button" className="w-full text-left px-3 py-2 hover:bg-muted text-sm"
                  onClick={() => assign(g.id)} disabled={busy}>
                  <div className="font-medium">{g.name}</div>
                  <div className="text-xs text-muted-foreground">{g.mobile ?? "—"}</div>
                </button>
              ))}
            </div>
          )}
          <div className="border-t pt-3 space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">Or create new</div>
            <Input placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Input placeholder="Mobile" value={newMobile} onChange={(e) => setNewMobile(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={createAndAssign} disabled={busy}>Create &amp; Assign</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignRoomDialog({
  bookingId, propertyId, booking, onClose, onDone,
}: {
  bookingId: string | null;
  propertyId: string | null;
  booking: InHouseRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  // Shared cache, filtered to vacant rooms client-side.
  const { rooms: allRooms } = useRooms(propertyId);
  const rooms = useMemo(
    () => (bookingId ? allRooms.filter((r) => r.status === "vacant") : []),
    [allRooms, bookingId],
  );
  const [picked, setPicked] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!bookingId || !propertyId) setPicked("");
  }, [bookingId, propertyId]);

  const assign = async () => {
    if (!bookingId || !picked || !propertyId || !booking) return;
    setBusy(true);
    const rate = booking.booking_rooms[0]?.rate ?? 0;
    const roomNumber = rooms.find((r) => r.id === picked)?.room_number ?? null;
    const { error: brErr } = await supabase.from("booking_rooms").insert({
      booking_id: bookingId, property_id: propertyId, room_id: picked, rate, status: "active",
    } as any);
    if (brErr) { setBusy(false); return toastError(brErr); }
    await supabase.from("rooms").update({ status: "occupied" } as any).eq("id", picked);
    const { data: u } = await supabase.auth.getUser();
    logActivity({
      property_id: propertyId,
      user_id: u.user?.id ?? "",
      user_name: userDisplayName(u.user as never),
      action_type: "ROOM_ADDED_TO_STAY",
      module: "Front Desk",
      reference_id: bookingId,
      reference_label: roomNumber ? `Room ${roomNumber}` : null,
      details: { booking_id: bookingId, room_id: picked, room_number: roomNumber },
    });
    setBusy(false);
    toast.success("Room assigned");
    onDone();
  };

  return (
    <Dialog open={!!bookingId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Room</DialogTitle>
          <DialogDescription>Select a vacant room for this booking.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {rooms.length === 0 ? (
            <div className="text-sm text-muted-foreground">No vacant rooms available.</div>
          ) : rooms.map((r) => (
            <label key={r.id} className="flex items-center gap-2 border rounded px-3 py-2 cursor-pointer hover:bg-muted">
              <input type="radio" name="room" value={r.id} checked={picked === r.id} onChange={() => setPicked(r.id)} />
              <span className="font-medium">Room {r.room_number}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={assign} disabled={busy || !picked}>Assign Room</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}