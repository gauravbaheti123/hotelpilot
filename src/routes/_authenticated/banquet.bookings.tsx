import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { BANQUET_STATUS_TONE } from "@/lib/banquet";
import { PlusCircle, Trash2, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { toast } from "sonner";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { listEventBookings, deleteEventBooking, type EventRow } from "@/lib/banquetEvent";

import { RequirePermission } from "@/components/RequirePermission";
import { reportQueryError } from "@/lib/queryError";
import { toastError } from "@/lib/errorMessage";
export const Route = createFileRoute("/_authenticated/banquet/bookings")({
  head: () => ({ meta: [{ title: "Banquet Events — HotelPilot" }] }),
  component: () => (<RequirePermission module="banquet"><BanquetBookingsPage /></RequirePermission>),
});

type Row = EventRow;

function BanquetBookingsPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const { user } = useAuth();
  const { can } = usePermissions();
  const isOwner = can("banquet", "delete");
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [delTarget, setDelTarget] = useState<Row | null>(null);
  const [delStep, setDelStep] = useState<1 | 2>(1);
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [impact, setImpact] = useState<Record<string, number> | null>(null);

  const load = () => {
    if (!propertyId) return;
    (async () => {
      try {
        setRows(await listEventBookings(propertyId, { limit: 200 }));
      } catch (e: any) {
        toastError(e, "Failed to load events");
      }
    })();
  };
  useEffect(load, [propertyId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!propertyId) return <AppShell title="Banquet Events"><EmptyPropertyState /></AppShell>;

  const filtered = rows.filter((r) =>
    !q ||
    r.banquet_number.toLowerCase().includes(q.toLowerCase()) ||
    ((r.host_name ?? r.guest_name) ?? "").toLowerCase().includes(q.toLowerCase()) ||
    (r.hall_name ?? "").toLowerCase().includes(q.toLowerCase()));

  /** Load counts of records that will be removed / detached by the delete. */
  async function openDelete(r: Row) {
    setDelTarget(r); setDelStep(1); setPwd(""); setImpact(null);
    const [blocks, pays, extras, mbills, bkgs] = await Promise.all([
      supabase.from("event_room_blocks").select("id", { count: "exact", head: true }).eq("event_booking_id", r.booking_id),
      supabase.from("payments").select("id", { count: "exact", head: true }).eq("booking_id", r.booking_id),
      supabase.from("banquet_extra_charges").select("id", { count: "exact", head: true }).eq("booking_id", r.booking_id),
      supabase.from("banquet_master_bills").select("id", { count: "exact", head: true }).eq("booking_id", r.booking_id),
      supabase.from("bookings").select("id", { count: "exact", head: true }).eq("event_id", r.booking_id),
    ]);
    setImpact({
      "Room blocks": blocks.count ?? 0,
      "Payments": pays.count ?? 0,
      "Extra charges": extras.count ?? 0,
      "Master bills": mbills.count ?? 0,
      "Room bookings (kept, unlinked)": bkgs.count ?? 0,
    });
  }

  async function permanentlyDelete() {
    if (!delTarget || !user?.email) return;
    setBusy(true);
    // Night-audit day lock guard — same convention as invoice hard-delete.
    const { data: locked, error: __qe1 } = await supabase.rpc("is_day_locked" as any, {
      _property_id: propertyId, _d: delTarget.event_date,
    } as any);
    if (__qe1) reportQueryError("is day locked", __qe1);
    if (locked === true) {
      setBusy(false);
      return toast.error("Cannot delete — this date has been locked by night audit.");
    }
    const { error: pErr } = await supabase.auth.signInWithPassword({
      email: user.email, password: pwd,
    });
    if (pErr) { setBusy(false); return toast.error("Password incorrect"); }
    // Full snapshot of the unified event row before the hard delete.
    const { data: eventRow, error: __qe2 } = await supabase.from("bookings")
      .select("*").eq("id", delTarget.booking_id).maybeSingle();
    if (__qe2) reportQueryError("bookings", __qe2);
    // Collect room_ids linked to this banquet BEFORE deleting the booking
    // (child rows cascade-delete, so we snapshot first). Rooms currently
    // flagged 'blocked' need to be reset to Vacant + Dirty so housekeeping
    // verifies them before they go back on sale.
    const roomIds = new Set<string>();
    const { data: blocks, error: __qe3 } = await supabase
      .from("event_room_blocks").select("room_id").eq("event_booking_id", delTarget.booking_id);
    if (__qe3) reportQueryError("event room blocks", __qe3);
    (blocks ?? []).forEach((r: any) => { if (r.room_id) roomIds.add(r.room_id); });

    await logActivity({
      property_id: propertyId!,
      user_id: user.id,
      user_name: userDisplayName(user as any),
      action_type: "BANQUET_EVENT_DELETED",
      module: "Banquet",
      reference_id: delTarget.booking_id,
      reference_label: `${delTarget.banquet_number} — ${delTarget.host_name ?? delTarget.guest_name ?? ""}`,
      details: {
        event_id: delTarget.booking_id,
        legacy_event_id: delTarget.legacy_id,
        banquet_number: delTarget.banquet_number,
        amount: delTarget.total_amount,
        event: eventRow ?? null,
        impact: impact ?? null,
        deleted_at: new Date().toISOString(),
        acting_user_id: user.id,
        acting_user_is_owner: isOwner,
      },
    });

    try {
      await deleteEventBooking({ bookingId: delTarget.booking_id, legacyId: delTarget.legacy_id });
    } catch (e: any) {
      setBusy(false);
      return toastError(e, "Delete failed");
    }
    setBusy(false);
    // Reset rooms still stuck at 'blocked' (skip rooms already occupied by
    // a regular guest booking so we don't overwrite legitimate state).
    if (roomIds.size > 0) {
      await supabase.from("rooms")
        .update({ status: "vacant", housekeeping_status: "dirty" } as any)
        .in("id", Array.from(roomIds))
        .eq("status", "blocked");
    }
    toast.success(`Event Bill ${delTarget.banquet_number} permanently deleted`);
    setDelTarget(null); setPwd(""); setDelStep(1);
    load();
  }

  return (
    <AppShell title="Banquet Events">
      <div className="flex items-center gap-2 mb-4">
        <Input placeholder="Search event / hall / guest…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <div className="flex-1" />
        <Link to="/banquet/new"><Button size="sm"><PlusCircle className="h-4 w-4 mr-1" /> New event</Button></Link>
      </div>
      <Card>
        <CardContent className="p-0 divide-y">
          {filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground">No events.</p>}
          {filtered.map((r) => (
            <div key={r.booking_id} className="flex items-center gap-3 px-4 py-3 hover:bg-accent">
              <Link to="/banquet/event/$id" params={{ id: r.booking_id }} className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium text-sm">{r.banquet_number}</div>
                  <Badge variant="outline" className={BANQUET_STATUS_TONE[r.status]}>{r.status}</Badge>
                  <span className="text-xs text-muted-foreground">{r.function_type}</span>
                </div>
                <div className="text-xs text-muted-foreground truncate">
{r.hall_name || "—"} · {r.event_date} · {r.start_time?.slice(0,5)}–{r.end_time?.slice(0,5)} · {r.pax} pax · {r.host_name ?? r.guest_name ?? "—"}
                </div>
              </Link>
              <div className="text-right">
                <div className="text-sm font-medium">₹{Number(r.total_amount).toLocaleString("en-IN")}</div>
                <div className="text-xs text-muted-foreground">Bal ₹{Number(r.balance_amount).toLocaleString("en-IN")}</div>
              </div>
              {isOwner && (
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive ml-2"
                  onClick={(e) => { e.preventDefault(); void openDelete(r); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!delTarget} onOpenChange={(o) => !o && setDelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {delStep === 1 ? `Delete Event Bill ${delTarget?.banquet_number}?` : "Confirm with password"}
            </DialogTitle>
          </DialogHeader>
          {delStep === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Event bills are <b>permanently deleted</b> and cannot be recovered. An audit snapshot is stored in the activity log.
              </p>
              {impact && (
                <div className="rounded-md border p-3 text-xs space-y-1">
                  <div className="font-medium mb-1">Records affected</div>
                  {Object.entries(impact).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="text-muted-foreground">{k}</span><span>{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {delStep === 2 && (
            <div className="space-y-2">
              <Label className="text-xs">Enter your account password to confirm</Label>
              <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelTarget(null)}>Cancel</Button>
            {delStep === 1 ? (
              <Button variant="destructive" onClick={() => setDelStep(2)}>Proceed</Button>
            ) : (
              <Button variant="destructive" disabled={!pwd || busy} onClick={permanentlyDelete}>
                {busy ? "Verifying…" : "Verify & Delete Permanently"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}