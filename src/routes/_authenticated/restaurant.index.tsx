import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { Download, MessageCircle, FileSpreadsheet, AlertTriangle, CheckCircle2, Plus, Pencil, Trash2 } from "lucide-react";
import { useAuth, hasRole } from "@/hooks/use-auth";
import { logActivity, userDisplayName } from "@/lib/activityLog";

import { RequirePermission } from "@/components/RequirePermission";
import { istToday } from "@/lib/date";
export const Route = createFileRoute("/_authenticated/restaurant/")({
  head: () => ({ meta: [{ title: "Restaurant Billing — HotelPilot" }] }),
  component: () => (<RequirePermission module="restaurant_billing"><RestaurantPage /></RequirePermission>),
});

interface CreditRow {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  is_settled: boolean;
  kot_order_id: string | null;
  booking_id: string | null;
  room_id: string | null;
}

interface CreditEnrichment {
  kot_number?: string;
  room_no?: string;
  guest_name?: string;
  items?: string;
  kitchen?: string;
  settled_at?: string | null;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const UNASSIGNED = "Unassigned";

/** Small inline outlet-wise subtotal strip — reused on every settlement view. */
function OutletBreakdown({ parts, className }: { parts: Array<[string, number]>; className?: string }) {
  if (parts.length === 0) return null;
  return (
    <div className={`text-[11px] text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5 ${className ?? ""}`}>
      {parts.map(([name, amt], i) => (
        <span key={name}>
          {i > 0 && <span className="mr-2">·</span>}
          {name}: <span className="font-medium text-foreground">₹{amt.toLocaleString()}</span>
        </span>
      ))}
    </div>
  );
}

function RestaurantPage() {
  const { current } = useCurrentProperty();
  const { user, roles } = useAuth();
  const isOwner = hasRole(roles, "owner") || hasRole(roles, "superadmin");
  const [credits, setCredits] = useState<CreditRow[]>([]);
  const [enriched, setEnriched] = useState<Record<string, CreditEnrichment>>({});
  const [loading, setLoading] = useState(false);

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [restInvoice, setRestInvoice] = useState<number | "">("");
  const [settling, setSettling] = useState(false);
  const [waNumber, setWaNumber] = useState("");

  // ─── Feature 1: Direct Charges ───────────────────────────────────────────
  type DirectChargeRow = {
    id: string; booking_id: string | null; guest_id: string | null;
    amount: number; description: string | null; charge_date: string;
    is_settled: boolean; created_at: string; outlet_id?: string | null; bill_no?: string | null;
    folio_charge_id?: string | null;
  };
  type PayableRow = {
    id: string; charge_id: string | null; amount: number;
    description: string | null; charge_date: string;
    is_settled: boolean; settlement_date: string | null; settlement_notes: string | null;
    bill_no?: string | null;
  };
  const [directCharges, setDirectCharges] = useState<DirectChargeRow[]>([]);
  const [directEnrich, setDirectEnrich] = useState<Record<string, { room?: string; guest?: string }>>({});
  const [payables, setPayables] = useState<PayableRow[]>([]);
  const [activeBookings, setActiveBookings] = useState<{ value: string; label: string; guest_id?: string | null }[]>([]);
  const [postOpen, setPostOpen] = useState(false);
  const [pcBooking, setPcBooking] = useState("");
  const [pcOutlet, setPcOutlet] = useState("");
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([]);
  const [pcAmount, setPcAmount] = useState<string>("");
  const [pcBillNo, setPcBillNo] = useState<string>("");
  const [pcDesc, setPcDesc] = useState("Restaurant Charge");
  const [pcDate, setPcDate] = useState(istToday());
  const [posting, setPosting] = useState(false);

  const [settleOpen, setSettleOpen] = useState(false);
  const [settleIds, setSettleIds] = useState<string[]>([]);
  const [settleDate, setSettleDate] = useState(istToday());
  const [settleNotes, setSettleNotes] = useState("");

  // ─── Owner edit / delete of direct charges ───────────────────────────────
  const [editCharge, setEditCharge] = useState<DirectChargeRow | null>(null);
  const [ecBooking, setEcBooking] = useState("");
  const [ecOutlet, setEcOutlet] = useState("");
  const [ecAmount, setEcAmount] = useState("");
  const [ecBillNo, setEcBillNo] = useState("");
  const [ecDesc, setEcDesc] = useState("");
  const [ecDate, setEcDate] = useState(istToday());
  const [ecReason, setEcReason] = useState("");
  const [delCharge, setDelCharge] = useState<DirectChargeRow | null>(null);
  const [delReason, setDelReason] = useState("");
  const [busyRow, setBusyRow] = useState(false);

  /** A charge is locked once it (or its payable) has been reconciled into a
   *  month-end settlement — those rows must never be edited or deleted. */
  function chargeLocked(c: DirectChargeRow) {
    if (c.is_settled) return true;
    return payables.some((p) => p.charge_id === c.id && p.is_settled);
  }

  function openEdit(c: DirectChargeRow) {
    setEditCharge(c);
    setEcBooking(c.booking_id ?? "");
    setEcOutlet(c.outlet_id ?? "");
    setEcAmount(String(c.amount));
    setEcBillNo(c.bill_no ?? "");
    setEcDesc(c.description ?? "");
    setEcDate(c.charge_date);
    setEcReason("");
  }

  async function recomputeFolioOf(folioChargeId: string | null | undefined) {
    if (!folioChargeId) return;
    const { data } = await supabase
      .from("folio_charges").select("folio_id").eq("id", folioChargeId).maybeSingle();
    const folioId = (data as any)?.folio_id;
    if (folioId) await (supabase as any).rpc("recompute_folio_totals", { _folio_id: folioId });
  }

  async function saveChargeEdit() {
    if (!current || !editCharge) return;
    const amt = Number(ecAmount);
    if (!ecOutlet) return toast.error("Select an outlet");
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    if (!ecReason.trim()) return toast.error("Reason is required");
    setBusyRow(true);
    try {
      const old = { ...editCharge };
      const bookingChanged = (editCharge.booking_id ?? "") !== ecBooking;
      const booking = activeBookings.find((b) => b.value === ecBooking);
      const desc = ecDesc.trim() || "Restaurant Charge";

      // 1. Folio mirror — move or update the guest folio line item.
      let folioChargeId = editCharge.folio_charge_id ?? null;
      if (bookingChanged && folioChargeId) {
        await recomputeFolioOf(folioChargeId);
        const prevFolioCharge = folioChargeId;
        await supabase.from("folio_charges").delete().eq("id", prevFolioCharge);
        folioChargeId = null;
      }
      if (ecBooking) {
        if (folioChargeId) {
          const { error } = await supabase.from("folio_charges").update({
            description: `Restaurant Charge — ${desc}`,
            qty: 1, rate: amt, amount: amt, gst_rate: 0, gst_amount: 0,
          } as any).eq("id", folioChargeId);
          if (error) throw error;
        } else {
          const folio = await (supabase as any).rpc("get_or_create_folio", { _booking_id: ecBooking });
          if (folio.error) throw folio.error;
          const fc = await supabase.from("folio_charges").insert({
            folio_id: folio.data,
            charge_type: "extra",
            description: `Restaurant Charge — ${desc}`,
            qty: 1, rate: amt, amount: amt, gst_rate: 0, gst_amount: 0,
            created_by: user?.id ?? null,
          } as any).select("id").single();
          if (fc.error) throw fc.error;
          folioChargeId = fc.data.id;
        }
      }

      // 2. Charge row
      const upd = await (supabase as any).from("restaurant_direct_charges").update({
        booking_id: ecBooking || null,
        guest_id: booking?.guest_id ?? (bookingChanged ? null : editCharge.guest_id),
        outlet_id: ecOutlet,
        amount: amt,
        bill_no: ecBillNo.trim() || null,
        description: desc,
        charge_date: ecDate,
        folio_charge_id: folioChargeId,
      }).eq("id", editCharge.id);
      if (upd.error) throw upd.error;

      // 3. Unsettled payable mirror
      const pay = await (supabase as any).from("restaurant_payables").update({
        amount: amt,
        bill_no: ecBillNo.trim() || null,
        description: desc,
        charge_date: ecDate,
      }).eq("charge_id", editCharge.id).eq("is_settled", false);
      if (pay.error) throw pay.error;

      await recomputeFolioOf(folioChargeId);

      await supabase.rpc("log_owner_override" as any, {
        _property_id: current.id,
        _table_name: "restaurant_direct_charges",
        _record_id: editCharge.id,
        _action: "RESTAURANT_DIRECT_CHARGE_EDITED",
        _old: old,
        _new: {
          booking_id: ecBooking || null, outlet_id: ecOutlet, amount: amt,
          bill_no: ecBillNo.trim() || null, description: desc, charge_date: ecDate,
        },
        _reason: ecReason.trim(),
      } as any);
      await logActivity({
        property_id: current.id,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "RESTAURANT_DIRECT_CHARGE_EDITED",
        module: "Restaurant",
        reference_id: editCharge.id,
        reference_label: ecBillNo.trim() || desc,
        details: { reason: ecReason.trim(), old_amount: Number(old.amount), new_amount: amt },
      });

      toast.success("Charge updated");
      setEditCharge(null);
      await loadDirect();
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    } finally { setBusyRow(false); }
  }

  async function confirmChargeDelete() {
    if (!current || !delCharge) return;
    if (chargeLocked(delCharge)) {
      return toast.error("Charge is already reconciled into a settlement — it cannot be deleted");
    }
    if (!delReason.trim()) return toast.error("Reason is required");
    setBusyRow(true);
    try {
      const snapshot = { ...delCharge, payables: payables.filter((p) => p.charge_id === delCharge.id) };
      const folioChargeId = delCharge.folio_charge_id ?? null;
      let folioId: string | null = null;
      if (folioChargeId) {
        const { data } = await supabase
          .from("folio_charges").select("folio_id").eq("id", folioChargeId).maybeSingle();
        folioId = (data as any)?.folio_id ?? null;
        const del = await supabase.from("folio_charges").delete().eq("id", folioChargeId);
        if (del.error) throw del.error;
      }
      const pDel = await (supabase as any).from("restaurant_payables")
        .delete().eq("charge_id", delCharge.id).eq("is_settled", false);
      if (pDel.error) throw pDel.error;
      const cDel = await (supabase as any).from("restaurant_direct_charges")
        .delete().eq("id", delCharge.id);
      if (cDel.error) throw cDel.error;
      if (folioId) await (supabase as any).rpc("recompute_folio_totals", { _folio_id: folioId });

      await supabase.rpc("log_owner_override" as any, {
        _property_id: current.id,
        _table_name: "restaurant_direct_charges",
        _record_id: delCharge.id,
        _action: "RESTAURANT_DIRECT_CHARGE_DELETED",
        _old: snapshot,
        _new: {},
        _reason: delReason.trim(),
      } as any);
      await logActivity({
        property_id: current.id,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "RESTAURANT_DIRECT_CHARGE_DELETED",
        module: "Restaurant",
        reference_id: delCharge.id,
        reference_label: delCharge.bill_no || delCharge.description || "Direct charge",
        details: { reason: delReason.trim(), amount: Number(delCharge.amount) },
      });

      toast.success("Charge deleted");
      setDelCharge(null); setDelReason("");
      await loadDirect();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    } finally { setBusyRow(false); }
  }

  async function loadDirect() {
    if (!current) return;
    const [dc, py, bk, ol] = await Promise.all([
      supabase
        .from("restaurant_direct_charges" as any)
        .select("id,booking_id,guest_id,amount,description,charge_date,is_settled,created_at,outlet_id,bill_no,folio_charge_id")
        .eq("property_id", current.id)
        .order("charge_date", { ascending: false }),
      supabase
        .from("restaurant_payables" as any)
        .select("id,charge_id,amount,description,charge_date,is_settled,settlement_date,settlement_notes,bill_no")
        .eq("property_id", current.id)
        .order("charge_date", { ascending: false }),
      supabase
        .from("bookings")
        .select("id,booking_number,guest_id,guests(name),booking_rooms(rooms!booking_rooms_room_id_fkey(room_number))")
        .eq("property_id", current.id)
        .eq("status", "checked_in"),
      (supabase as any)
        .from("restaurant_outlets")
        .select("id,name")
        .eq("property_id", current.id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
    ]);
    const rows = (dc.data ?? []) as unknown as DirectChargeRow[];
    setDirectCharges(rows);
    setPayables((py.data ?? []) as unknown as PayableRow[]);
    setOutlets(((ol as any).data ?? []) as { id: string; name: string }[]);

    const bks = (bk.data ?? []) as any[];
    setActiveBookings(bks.map((b) => {
      const room = (b.booking_rooms ?? []).map((br: any) => br.rooms?.room_number).filter(Boolean).join(", ") || "—";
      const name = b.guests?.name ?? "Guest";
      return { value: b.id, label: `Room ${room} · ${name}`, guest_id: b.guest_id };
    }));

    // enrich charge rows w/ room+guest
    const bIds = Array.from(new Set(rows.map((r) => r.booking_id).filter(Boolean))) as string[];
    if (bIds.length) {
      const { data: bdata } = await supabase
        .from("bookings")
        .select("id,guests(name),booking_rooms(rooms!booking_rooms_room_id_fkey(room_number))")
        .in("id", bIds);
      const map: typeof directEnrich = {};
      for (const b of (bdata ?? []) as any[]) {
        const room = (b.booking_rooms ?? []).map((br: any) => br.rooms?.room_number).filter(Boolean).join(", ") || "—";
        map[b.id] = { room, guest: b.guests?.name ?? "—" };
      }
      const enrichByCharge: typeof directEnrich = {};
      for (const r of rows) {
        if (r.booking_id && map[r.booking_id]) enrichByCharge[r.id] = map[r.booking_id];
      }
      setDirectEnrich(enrichByCharge);
    } else setDirectEnrich({});
  }

  useEffect(() => { if (current) loadDirect(); /* eslint-disable-next-line */ }, [current?.id]);

  async function postDirectCharge() {
    if (!current) return;
    if (!pcBooking) return toast.error("Select a booking");
    if (!pcOutlet) return toast.error("Select an outlet");
    const amt = Number(pcAmount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    setPosting(true);
    try {
      const booking = activeBookings.find((b) => b.value === pcBooking);
      // 1. Insert direct charge
      const ins = await (supabase as any)
        .from("restaurant_direct_charges")
        .insert({
          property_id: current.id,
          booking_id: pcBooking,
          guest_id: booking?.guest_id ?? null,
          outlet_id: pcOutlet,
          amount: amt,
          bill_no: pcBillNo.trim() || null,
          description: pcDesc || "Restaurant Charge",
          charge_date: pcDate,
          posted_by: user?.id ?? null,
        }).select("id").single();
      if (ins.error) throw ins.error;
      const chargeId = ins.data.id;

      // 2. Payable
      const py = await (supabase as any).from("restaurant_payables").insert({
        property_id: current.id,
        charge_id: chargeId,
        amount: amt,
        bill_no: pcBillNo.trim() || null,
        description: pcDesc || "Restaurant Charge",
        charge_date: pcDate,
      });
      if (py.error) throw py.error;

      // 3. Folio line item (no GST)
      const folio = await (supabase as any).rpc("get_or_create_folio", { _booking_id: pcBooking });
      if (folio.error) throw folio.error;
      const folioId = folio.data;
      const fc = await supabase.from("folio_charges").insert({
        folio_id: folioId,
        charge_type: "extra",
        description: `Restaurant Charge — ${pcDesc || "Direct"}`,
        qty: 1,
        rate: amt,
        amount: amt,
        gst_rate: 0,
        gst_amount: 0,
        created_by: user?.id ?? null,
      } as any).select("id").single();
      if (fc.error) throw fc.error;

      // Link folio charge back
      await (supabase as any).from("restaurant_direct_charges")
        .update({ folio_charge_id: fc.data.id }).eq("id", chargeId);

      toast.success(`Charge posted to ${booking?.label ?? "guest"}`);
      setPostOpen(false);
      setPcAmount(""); setPcDesc("Restaurant Charge"); setPcBooking(""); setPcOutlet(""); setPcBillNo("");
      await loadDirect();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to post charge");
    } finally { setPosting(false); }
  }

  const unsettledPayables = useMemo(() => payables.filter((p) => !p.is_settled), [payables]);

  const outletName = useMemo(() => {
    const m = new Map(outlets.map((o) => [o.id, o.name]));
    return (id?: string | null) => (id && m.get(id)) || UNASSIGNED;
  }, [outlets]);

  /** outlet name for a payable, resolved through its originating direct charge */
  const payableOutlet = useMemo(() => {
    const byCharge = new Map(directCharges.map((c) => [c.id, c.outlet_id ?? null]));
    return (p: { charge_id: string | null }) => outletName(p.charge_id ? byCharge.get(p.charge_id) ?? null : null);
  }, [directCharges, outletName]);

  const payableBillNo = useMemo(() => {
    const byCharge = new Map(directCharges.map((c) => [c.id, c.bill_no ?? null]));
    return (p: PayableRow) => p.bill_no ?? (p.charge_id ? byCharge.get(p.charge_id) ?? null : null);
  }, [directCharges]);

  // Display-only: append the bill number to whatever description staff entered.
  function descWithBill(description?: string | null, billNo?: string | null) {
    const base = (description ?? "").trim() || "Restaurant Charge";
    const bill = (billNo ?? "").trim();
    if (!bill) return base;
    if (base.toLowerCase().includes(bill.toLowerCase())) return base;
    return `${base} — Bill No ${bill}`;
  }

  function groupByOutlet<T>(rows: T[], name: (r: T) => string, amount: (r: T) => number): Array<[string, number]> {
    const m = new Map<string, number>();
    for (const r of rows) m.set(name(r), (m.get(name(r)) ?? 0) + Number(amount(r) || 0));
    return Array.from(m.entries()).sort((a, b) => (a[0] === UNASSIGNED ? 1 : b[0] === UNASSIGNED ? -1 : b[1] - a[1]));
  }

  const settledPayables = useMemo(() => payables.filter((p) => p.is_settled), [payables]);
  const payablesByMonth = useMemo(() => {
    const m = new Map<string, PayableRow[]>();
    for (const p of unsettledPayables) {
      const k = p.charge_date.slice(0, 7); // YYYY-MM
      const arr = m.get(k) ?? [];
      arr.push(p); m.set(k, arr);
    }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [unsettledPayables]);
  const totalPayable = useMemo(
    () => unsettledPayables.reduce((s, p) => s + Number(p.amount), 0),
    [unsettledPayables],
  );

  async function settlePayables() {
    if (!current || settleIds.length === 0) return;
    const upd = await (supabase as any).from("restaurant_payables").update({
      is_settled: true,
      settlement_date: settleDate,
      settlement_notes: settleNotes || null,
    }).in("id", settleIds);
    if (upd.error) return toast.error(upd.error.message);
    toast.success(`Marked ${settleIds.length} payables settled`);
    setSettleOpen(false); setSettleIds([]); setSettleNotes("");
    await loadDirect();
  }
  // ─── end Feature 1 ───────────────────────────────────────────────────────

  async function load() {
    if (!current) return;
    setLoading(true);
    // Hotel outsources ALL food to one restaurant partner. Track every canonical
    // KOT (parent_kot_id IS NULL) for this property regardless of kitchen.
    const { data: allKots } = await supabase
      .from("kot_orders")
      .select("id,property_id,booking_id,room_id,total_amount,kot_number,created_at,status,kot_type,parent_kot_id")
      .eq("property_id", current.id)
      .is("parent_kot_id", null)
      .eq("is_wiped", false)
      .not("status", "in", "(void,cancelled)");
    if (allKots && allKots.length > 0) {
      const ids = allKots.map((k: any) => k.id);
      const { data: existing } = await supabase
        .from("restaurant_credits")
        .select("kot_order_id")
        .in("kot_order_id", ids);
      const have = new Set((existing ?? []).map((x: any) => x.kot_order_id));
      const missing = allKots.filter((k: any) => !have.has(k.id));
      if (missing.length > 0) {
        await supabase.from("restaurant_credits").insert(
          missing.map((k: any) => ({
            property_id: k.property_id,
            booking_id: k.booking_id,
            room_id: k.room_id,
            kot_order_id: k.id,
            amount: Number(k.total_amount ?? 0),
            date: (k.created_at ?? new Date().toISOString()).slice(0, 10),
            description: `Auto-credit from KOT ${k.kot_number ?? k.id}`,
          })) as any,
        );
      }
      // Clean up stale unsettled credits keyed to restaurant_copy duplicates.
      const { data: dupKots } = await supabase
        .from("kot_orders")
        .select("id")
        .eq("property_id", current.id)
        .not("parent_kot_id", "is", null);
      const dupIds = (dupKots ?? []).map((x: any) => x.id);
      if (dupIds.length > 0) {
        await supabase
          .from("restaurant_credits")
          .delete()
          .in("kot_order_id", dupIds)
          .eq("is_settled", false);
      }
    }
    const { data, error } = await supabase
      .from("restaurant_credits")
      .select("id,date,amount,description,is_settled,kot_order_id,booking_id,room_id")
      .eq("property_id", current.id)
      .order("date", { ascending: false });
    if (error) toast.error(error.message);
    const rows = (data ?? []) as CreditRow[];
    setCredits(rows);

    // Enrich
    const kotIds = Array.from(new Set(rows.map((r) => r.kot_order_id).filter(Boolean))) as string[];
    const roomIds = Array.from(new Set(rows.map((r) => r.room_id).filter(Boolean))) as string[];
    const bookIds = Array.from(new Set(rows.map((r) => r.booking_id).filter(Boolean))) as string[];
    const [koRes, rmRes, bkRes, itemRes] = await Promise.all([
      kotIds.length ? supabase.from("kot_orders").select("id,kot_number,kot_type").in("id", kotIds) : Promise.resolve({ data: [] as any }),
      roomIds.length ? supabase.from("rooms").select("id,room_number").in("id", roomIds) : Promise.resolve({ data: [] as any }),
      bookIds.length ? supabase.from("bookings").select("id,guests(name)").in("id", bookIds) : Promise.resolve({ data: [] as any }),
      kotIds.length ? supabase.from("kot_items").select("kot_id,item_name,qty").in("kot_id", kotIds) : Promise.resolve({ data: [] as any }),
    ]);
    const koMap = new Map((koRes.data ?? []).map((x: any) => [x.id, x]));
    const rmMap = new Map((rmRes.data ?? []).map((x: any) => [x.id, x.room_number]));
    const bkMap = new Map((bkRes.data ?? []).map((x: any) => [x.id, x.guests?.name]));
    const itemMap = new Map<string, string[]>();
    for (const it of (itemRes.data ?? []) as any[]) {
      const arr = itemMap.get(it.kot_id) ?? [];
      arr.push(`${it.item_name} x${it.qty}`);
      itemMap.set(it.kot_id, arr);
    }
    const e: typeof enriched = {};
    for (const r of rows) {
      const ko = r.kot_order_id ? (koMap.get(r.kot_order_id) as any) : undefined;
      e[r.id] = {
        kot_number: ko?.kot_number,
        kitchen: ko?.kot_type,
        room_no: r.room_id ? rmMap.get(r.room_id) as string | undefined : undefined,
        guest_name: r.booking_id ? bkMap.get(r.booking_id) as string | undefined : undefined,
        items: r.kot_order_id ? (itemMap.get(r.kot_order_id) ?? []).join(", ") : undefined,
      };
    }
    setEnriched(e);
    setLoading(false);
  }

  useEffect(() => { if (current) load(); /* eslint-disable-next-line */ }, [current?.id]);

  // Tab 1 — active credits (unsettled only) for current month
  const monthRows = useMemo(() => {
    return credits.filter((c) => {
      const d = new Date(c.date);
      return d.getMonth() + 1 === month && d.getFullYear() === year;
    });
  }, [credits, month, year]);

  const activeRows = useMemo(() => monthRows.filter((c) => !c.is_settled), [monthRows]);
  const totalActive = useMemo(() => activeRows.reduce((s, r) => s + Number(r.amount), 0), [activeRows]);
  const totalMonth = useMemo(() => monthRows.reduce((s, r) => s + Number(r.amount), 0), [monthRows]);
  const totalSettled = useMemo(
    () => monthRows.filter((r) => r.is_settled).reduce((s, r) => s + Number(r.amount), 0),
    [monthRows],
  );

  const restInvoiceNum = typeof restInvoice === "number" ? restInvoice : Number(restInvoice || 0);
  const difference = restInvoiceNum - totalActive;

  // Outlet-wise breakdowns (KOT credits carry no outlet → Unassigned bucket)
  const monthDirect = useMemo(
    () => directCharges.filter((c) => {
      const d = new Date(c.charge_date);
      return d.getMonth() + 1 === month && d.getFullYear() === year;
    }),
    [directCharges, month, year],
  );
  const outletTotalAmount = useMemo(
    () => groupByOutlet(
      [
        ...monthRows.map((r) => ({ n: UNASSIGNED, a: Number(r.amount) })),
        ...monthDirect.map((c) => ({ n: outletName(c.outlet_id), a: Number(c.amount) })),
      ],
      (r) => r.n, (r) => r.a,
    ),
    [monthRows, monthDirect, outletName],
  );
  const outletSettled = useMemo(
    () => groupByOutlet(
      [
        ...monthRows.filter((r) => r.is_settled).map((r) => ({ n: UNASSIGNED, a: Number(r.amount) })),
        ...monthDirect.filter((c) => c.is_settled).map((c) => ({ n: outletName(c.outlet_id), a: Number(c.amount) })),
      ],
      (r) => r.n, (r) => r.a,
    ),
    [monthRows, monthDirect, outletName],
  );
  const outletOutstanding = useMemo(
    () => groupByOutlet(
      [
        ...activeRows.map((r) => ({ n: UNASSIGNED, a: Number(r.amount) })),
        ...monthDirect.filter((c) => !c.is_settled).map((c) => ({ n: outletName(c.outlet_id), a: Number(c.amount) })),
      ],
      (r) => r.n, (r) => r.a,
    ),
    [activeRows, monthDirect, outletName],
  );
  const outletDirectAll = useMemo(
    () => groupByOutlet(directCharges, (c) => outletName(c.outlet_id), (c) => Number(c.amount)),
    [directCharges, outletName],
  );
  const outletPayableAll = useMemo(
    () => groupByOutlet(unsettledPayables, payableOutlet, (p) => Number(p.amount)),
    [unsettledPayables, payableOutlet],
  );

  async function settle() {
    if (!current) return;
    if (activeRows.length === 0) return toast.error("No outstanding credits to settle");
    setSettling(true);
    try {
      const ins = await (supabase as any).from("restaurant_settlements").insert({
        property_id: current.id,
        month,
        year,
        total_amount: totalActive,
        settled_amount: restInvoiceNum || totalActive,
        payment_mode: "bank_transfer",
        notes: difference !== 0 ? `Mismatch: hotel ₹${totalActive} vs restaurant ₹${restInvoiceNum} (Δ ${difference})` : null,
      }).select("id").single();
      if (ins.error) throw ins.error;
      const settlementId = ins.data.id;
      const ids = activeRows.map((r) => r.id);
      const upd = await supabase.from("restaurant_credits")
        .update({ is_settled: true, settlement_id: settlementId } as any)
        .in("id", ids);
      if (upd.error) throw upd.error;
      toast.success(`Settled ${ids.length} credits`);
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Settlement failed");
    } finally { setSettling(false); }
  }

  async function settleOne(id: string, amount: number) {
    if (!current) return;
    try {
      const ins = await (supabase as any).from("restaurant_settlements").insert({
        property_id: current.id,
        month, year,
        total_amount: amount,
        settled_amount: amount,
        payment_mode: "bank_transfer",
        notes: "Single KOT settled",
      }).select("id").single();
      if (ins.error) throw ins.error;
      const upd = await supabase.from("restaurant_credits")
        .update({ is_settled: true, settlement_id: ins.data.id } as any)
        .eq("id", id);
      if (upd.error) throw upd.error;
      toast.success("Credit settled");
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    }
  }

  async function exportPdf() {
    const { default: jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(`Restaurant Statement — ${MONTHS[month - 1]} ${year}`, 14, 18);
    doc.setFontSize(10);
    doc.text(`${current?.name ?? ""}`, 14, 25);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 31);
    autoTable(doc, {
      startY: 38,
      head: [["Date", "Room", "Guest", "KOT", "Items", "Amount"]],
      body: monthRows.map((r) => {
        const e = enriched[r.id] ?? {};
        return [
          r.date,
          e.room_no ?? "-",
          e.guest_name ?? "-",
          e.kot_number ?? "-",
          (e.items ?? "").slice(0, 60),
          `Rs ${Number(r.amount).toFixed(2)}`,
        ];
      }),
      styles: { fontSize: 8 },
    });
    const finalY = (doc as any).lastAutoTable.finalY + 8;
    doc.setFontSize(11);
    doc.text(`Total: Rs ${totalMonth.toFixed(2)}`, 14, finalY);
    doc.save(`restaurant-${year}-${String(month).padStart(2, "0")}.pdf`);
  }

  async function sendWhatsApp() {
    if (!current) return;
    if (!waNumber.trim()) return toast.error("Enter restaurant WhatsApp number");
    const msg = [
      `*Restaurant Statement — ${MONTHS[month - 1]} ${year}*`,
      `Hotel: ${current.name}`,
      `Outstanding: ₹${totalActive.toFixed(2)}`,
      `Total entries: ${monthRows.length}`,
      `Please confirm reconciliation.`,
    ].join("\n");
    const url = `https://wa.me/${waNumber.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  }

  if (!current) return <AppShell title="Restaurant"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Restaurant Billing">
      <div className="p-4 space-y-4 max-w-6xl">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Total Food Orders</div>
            <div className="text-2xl font-semibold">{monthRows.length}</div>
            <div className="text-[10px] text-muted-foreground">{MONTHS[month - 1]} {year}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Total Amount</div>
            <div className="text-2xl font-semibold">₹{totalMonth.toLocaleString()}</div>
            <OutletBreakdown parts={outletTotalAmount} className="mt-1" />
          </CardContent></Card>
          <Card><CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Settled</div>
            <div className="text-2xl font-semibold text-emerald-600">₹{totalSettled.toLocaleString()}</div>
            <OutletBreakdown parts={outletSettled} className="mt-1" />
          </CardContent></Card>
          <Card><CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Outstanding</div>
            <div className={`text-2xl font-semibold ${totalActive > 0 ? "text-destructive" : ""}`}>₹{totalActive.toLocaleString()}</div>
            <OutletBreakdown parts={outletOutstanding} className="mt-1" />
          </CardContent></Card>
        </div>
        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">Active Credits</TabsTrigger>
            <TabsTrigger value="direct">Direct Charges</TabsTrigger>
            <TabsTrigger value="settle">Month-end Settlement</TabsTrigger>
            <TabsTrigger value="payables">Restaurant Settlement</TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Active Restaurant Credits ({MONTHS[month - 1]} {year})</span>
                  <span className="text-sm font-normal text-muted-foreground text-right">
                    Total outstanding this month: <span className="font-semibold text-foreground">₹{totalActive.toLocaleString()}</span>
                    <OutletBreakdown parts={outletOutstanding} className="justify-end mt-0.5" />
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Guest</TableHead>
                      <TableHead>KOT Ref</TableHead>
                      <TableHead>Outlet</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Kitchen</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading && (
                      <TableRow><TableCell colSpan={10} className="text-center py-6 text-sm text-muted-foreground">Loading…</TableCell></TableRow>
                    )}
                    {!loading && monthRows.length === 0 && (
                      <TableRow><TableCell colSpan={10} className="text-center py-6 text-sm text-muted-foreground">No food orders this month</TableCell></TableRow>
                    )}
                    {monthRows.map((r) => {
                      const e = enriched[r.id] ?? {};
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs">{r.date}</TableCell>
                          <TableCell>{e.room_no ?? "—"}</TableCell>
                          <TableCell>{e.guest_name ?? "—"}</TableCell>
                          <TableCell className="text-xs font-mono">{e.kot_number ?? "—"}</TableCell>
                          <TableCell className="text-xs">{UNASSIGNED}</TableCell>
                          <TableCell className="text-xs max-w-[280px] truncate">{e.items ?? "—"}</TableCell>
                          <TableCell className="text-right font-medium">₹{Number(r.amount).toFixed(2)}</TableCell>
                          <TableCell className="text-xs capitalize">{e.kitchen ?? "—"}</TableCell>
                          <TableCell>
                            {r.is_settled
                              ? <Badge variant="secondary">Settled</Badge>
                              : <Badge variant="default">Open</Badge>}
                          </TableCell>
                          <TableCell>
                            {!r.is_settled && (
                              <Button size="sm" variant="outline" onClick={() => settleOne(r.id, Number(r.amount))}>
                                Settle
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settle" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Month-end Settlement</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <Label>Month</Label>
                    <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Year</Label>
                    <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
                  </div>
                  <div className="md:col-span-2 flex items-end gap-2">
                    <Button variant="outline" onClick={exportPdf}>
                      <Download className="h-4 w-4 mr-1" /> Export PDF
                    </Button>
                    <Input placeholder="Restaurant WhatsApp #" value={waNumber} onChange={(e) => setWaNumber(e.target.value)} className="max-w-[180px]" />
                    <Button variant="outline" onClick={sendWhatsApp}>
                      <MessageCircle className="h-4 w-4 mr-1" /> Send WA
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Card><CardContent className="pt-4">
                    <div className="text-xs text-muted-foreground">Hotel Total (unsettled)</div>
                    <div className="text-2xl font-semibold">₹{totalActive.toLocaleString()}</div>
                    <OutletBreakdown parts={outletOutstanding} className="mt-1" />
                  </CardContent></Card>
                  <Card><CardContent className="pt-4">
                    <Label className="text-xs">Restaurant invoice amount</Label>
                    <Input type="number" placeholder="0" value={restInvoice}
                      onChange={(e) => setRestInvoice(e.target.value === "" ? "" : Number(e.target.value))} />
                  </CardContent></Card>
                  <Card><CardContent className="pt-4">
                    <div className="text-xs text-muted-foreground">Difference</div>
                    <div className={`text-2xl font-semibold ${difference === 0 ? "" : "text-destructive"}`}>
                      ₹{difference.toLocaleString()}
                    </div>
                    {difference !== 0 && restInvoice !== "" && (
                      <div className="flex items-center text-xs text-destructive mt-1">
                        <AlertTriangle className="h-3 w-3 mr-1" /> Mismatch — please reconcile
                      </div>
                    )}
                    {difference === 0 && restInvoice !== "" && (
                      <div className="flex items-center text-xs text-emerald-600 mt-1">
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Matches
                      </div>
                    )}
                  </CardContent></Card>
                </div>

                <div>
                  <div className="text-sm font-medium mb-2 flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4" /> KOT-wise breakup
                  </div>
                  <OutletBreakdown parts={outletTotalAmount} className="mb-2" />
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>KOT</TableHead>
                        <TableHead>Outlet</TableHead>
                        <TableHead>Room</TableHead>
                        <TableHead>Guest</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {monthRows.length === 0 && (
                        <TableRow><TableCell colSpan={7} className="text-center py-4 text-sm text-muted-foreground">No data</TableCell></TableRow>
                      )}
                      {monthRows.map((r) => {
                        const e = enriched[r.id] ?? {};
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="text-xs">{r.date}</TableCell>
                            <TableCell className="text-xs font-mono">{e.kot_number ?? "—"}</TableCell>
                            <TableCell className="text-xs">{UNASSIGNED}</TableCell>
                            <TableCell>{e.room_no ?? "—"}</TableCell>
                            <TableCell>{e.guest_name ?? "—"}</TableCell>
                            <TableCell className="text-right">₹{Number(r.amount).toFixed(2)}</TableCell>
                            <TableCell>{r.is_settled ? <Badge variant="secondary">Settled</Badge> : <Badge>Open</Badge>}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <Button onClick={settle} disabled={settling || activeRows.length === 0} className="w-full">
                  {settling ? "Settling…" : `Mark ${activeRows.length} credits settled`}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="direct" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Direct Restaurant Charges</span>
                  <Button size="sm" onClick={() => setPostOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" /> Post Restaurant Charge
                  </Button>
                </CardTitle>
                <OutletBreakdown parts={outletDirectAll} className="mt-1" />
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Date</TableHead><TableHead>Room</TableHead>
                    <TableHead>Guest</TableHead><TableHead>Outlet</TableHead>
                    <TableHead>Bill No</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    {isOwner && <TableHead className="text-right">Actions</TableHead>}
                  </TableRow></TableHeader>
                  <TableBody>
                    {directCharges.length === 0 && (
                      <TableRow><TableCell colSpan={isOwner ? 9 : 8} className="text-center py-6 text-sm text-muted-foreground">
                        No direct charges posted yet
                      </TableCell></TableRow>
                    )}
                    {directCharges.map((c) => {
                      const e = directEnrich[c.id] ?? {};
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="text-xs">{c.charge_date}</TableCell>
                          <TableCell>{e.room ?? "—"}</TableCell>
                          <TableCell>{e.guest ?? "—"}</TableCell>
                          <TableCell className="text-xs">
                            {outletName(c.outlet_id)}
                          </TableCell>
                          <TableCell className="text-xs font-mono">{c.bill_no || "—"}</TableCell>
                          <TableCell className="text-xs">{descWithBill(c.description, c.bill_no)}</TableCell>
                          <TableCell className="text-right font-medium">₹{Number(c.amount).toFixed(2)}</TableCell>
                          <TableCell>
                            {c.is_settled
                              ? <Badge variant="secondary">Settled</Badge>
                              : <Badge>Posted</Badge>}
                          </TableCell>
                          {isOwner && (
                            <TableCell className="text-right whitespace-nowrap">
                              <Button
                                size="icon" variant="ghost" className="h-8 w-8"
                                title={chargeLocked(c) ? "Reconciled into a settlement — locked" : "Edit charge"}
                                disabled={chargeLocked(c)}
                                onClick={() => openEdit(c)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon" variant="ghost" className="h-8 w-8 text-destructive"
                                title={chargeLocked(c) ? "Reconciled into a settlement — locked" : "Delete charge"}
                                disabled={chargeLocked(c)}
                                onClick={() => { setDelCharge(c); setDelReason(""); }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payables" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Owed to Restaurant (Direct Charges)</span>
                  <span className="text-sm font-normal">
                    Total outstanding: <span className="font-bold text-destructive">₹{totalPayable.toLocaleString()}</span>
                  </span>
                </CardTitle>
                <OutletBreakdown parts={outletPayableAll} className="mt-1" />
              </CardHeader>
              <CardContent className="space-y-4">
                {payablesByMonth.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-6">No outstanding payables</div>
                )}
                {payablesByMonth.map(([ym, rows]) => {
                  const total = rows.reduce((s, p) => s + Number(p.amount), 0);
                  const ids = rows.map((r) => r.id);
                  const byOutlet = groupByOutlet(rows, payableOutlet, (p) => Number(p.amount));
                  return (
                    <div key={ym} className="border rounded-md p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <div className="font-medium">{ym} · {rows.length} entries · ₹{total.toLocaleString()}</div>
                          <OutletBreakdown parts={byOutlet} className="mt-0.5" />
                        </div>
                        <Button size="sm" variant="outline" onClick={() => { setSettleIds(ids); setSettleOpen(true); }}>
                          Mark as Settled
                        </Button>
                      </div>
                      {byOutlet.map(([oname, osum]) => (
                        <div key={oname} className="mb-2">
                          <div className="text-xs font-medium text-muted-foreground px-1 py-1">
                            {oname} · ₹{osum.toLocaleString()}
                          </div>
                          <Table>
                            <TableHeader><TableRow>
                              <TableHead>Date</TableHead><TableHead>Outlet</TableHead>
                              <TableHead>Bill No</TableHead><TableHead>Description</TableHead>
                              <TableHead className="text-right">Amount</TableHead>
                            </TableRow></TableHeader>
                            <TableBody>
                              {rows.filter((p) => payableOutlet(p) === oname).map((p) => (
                                <TableRow key={p.id}>
                                  <TableCell className="text-xs">{p.charge_date}</TableCell>
                                  <TableCell className="text-xs">{oname}</TableCell>
                                  <TableCell className="text-xs font-mono">{payableBillNo(p) || "—"}</TableCell>
                                  <TableCell className="text-xs">{descWithBill(p.description, payableBillNo(p))}</TableCell>
                                  <TableCell className="text-right">₹{Number(p.amount).toFixed(2)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                  );
                })}

                {settledPayables.length > 0 && (
                  <div>
                    <div className="text-sm font-medium mt-4 mb-2">Settlement history</div>
                    <Table>
                      <TableHeader><TableRow>
                        <TableHead>Charge Date</TableHead><TableHead>Outlet</TableHead>
                        <TableHead>Bill No</TableHead><TableHead>Settled On</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow></TableHeader>
                      <TableBody>
                        {settledPayables.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="text-xs">{p.charge_date}</TableCell>
                            <TableCell className="text-xs">{payableOutlet(p)}</TableCell>
                            <TableCell className="text-xs font-mono">{payableBillNo(p) || "—"}</TableCell>
                            <TableCell className="text-xs">{p.settlement_date ?? "—"}</TableCell>
                            <TableCell className="text-xs">{p.settlement_notes ?? "—"}</TableCell>
                            <TableCell className="text-right">₹{Number(p.amount).toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Post Charge Modal */}
        <Dialog open={postOpen} onOpenChange={setPostOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Post Restaurant Charge</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Booking (Room · Guest)</Label>
                <SearchableSelect
                  options={activeBookings}
                  value={pcBooking}
                  onChange={setPcBooking}
                  placeholder="Search booking…"
                  emptyText="No active bookings"
                />
              </div>
              <div>
                <Label>Outlet *</Label>
                <Select value={pcOutlet} onValueChange={setPcOutlet}>
                  <SelectTrigger><SelectValue placeholder="Select outlet…" /></SelectTrigger>
                  <SelectContent>
                    {outlets.map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Bill No</Label>
                <Input value={pcBillNo} onChange={(e) => setPcBillNo(e.target.value)} placeholder="e.g. 202" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Amount (₹)</Label>
                  <Input type="number" value={pcAmount} onChange={(e) => setPcAmount(e.target.value)} />
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={pcDate} onChange={(e) => setPcDate(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Description</Label>
                <Input value={pcDesc} onChange={(e) => setPcDesc(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                Posted as a line item on the guest folio (no GST) and recorded as payable to the restaurant.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPostOpen(false)}>Cancel</Button>
              <Button onClick={postDirectCharge} disabled={posting}>
                {posting ? "Posting…" : "Post Charge"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Settle Payables Modal */}
        {/* Owner — Edit Direct Charge */}
        <Dialog open={!!editCharge} onOpenChange={(o) => !o && setEditCharge(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Restaurant Charge</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Booking (Room · Guest)</Label>
                <SearchableSelect
                  options={activeBookings}
                  value={ecBooking}
                  onChange={setEcBooking}
                  placeholder="Search booking…"
                  emptyText="No active bookings"
                />
              </div>
              <div>
                <Label>Outlet *</Label>
                <Select value={ecOutlet} onValueChange={setEcOutlet}>
                  <SelectTrigger><SelectValue placeholder="Select outlet…" /></SelectTrigger>
                  <SelectContent>
                    {outlets.map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Bill No</Label>
                <Input value={ecBillNo} onChange={(e) => setEcBillNo(e.target.value)} placeholder="e.g. 202" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Amount (₹)</Label>
                  <Input type="number" value={ecAmount} onChange={(e) => setEcAmount(e.target.value)} />
                </div>
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={ecDate} onChange={(e) => setEcDate(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Description</Label>
                <Input value={ecDesc} onChange={(e) => setEcDesc(e.target.value)} />
              </div>
              <div>
                <Label>Reason *</Label>
                <Textarea value={ecReason} onChange={(e) => setEcReason(e.target.value)} rows={2}
                  placeholder="Why is this charge being edited?" />
              </div>
              <p className="text-xs text-muted-foreground">
                The guest folio line item and the unsettled restaurant payable are updated to match.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditCharge(null)}>Cancel</Button>
              <Button onClick={saveChargeEdit} disabled={busyRow}>{busyRow ? "Saving…" : "Save Changes"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Owner — Delete Direct Charge */}
        <Dialog open={!!delCharge} onOpenChange={(o) => !o && setDelCharge(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Delete Restaurant Charge</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="text-sm">
                {delCharge?.charge_date} · {delCharge?.bill_no || "—"} · ₹{Number(delCharge?.amount ?? 0).toFixed(2)}
                <div className="text-muted-foreground text-xs">{delCharge?.description}</div>
              </div>
              <div className="text-xs text-destructive">
                This removes the charge, its guest folio line item and the unsettled payable. Folio totals recompute automatically.
              </div>
              <div>
                <Label>Reason *</Label>
                <Textarea value={delReason} onChange={(e) => setDelReason(e.target.value)} rows={2}
                  placeholder="Why is this charge being deleted?" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDelCharge(null)}>Cancel</Button>
              <Button variant="destructive" onClick={confirmChargeDelete} disabled={busyRow}>
                {busyRow ? "Deleting…" : "Delete Charge"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Mark Payables Settled</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="text-sm">Settling <b>{settleIds.length}</b> entries.</div>
              <div>
                <Label>Settlement Date</Label>
                <Input type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} />
              </div>
              <div>
                <Label>Notes (optional)</Label>
                <Textarea value={settleNotes} onChange={(e) => setSettleNotes(e.target.value)} rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSettleOpen(false)}>Cancel</Button>
              <Button onClick={settlePayables}>Confirm Settlement</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}