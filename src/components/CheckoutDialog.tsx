import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { billNo } from "@/lib/billNumber";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { toast } from "sonner";
import { inr, inrRound, recomputeFolio, consolidateSegmentCharges, type BillDiscount, realPaidTotal, overpaymentError } from "@/lib/billing";
import { computeRoomChargeTax } from "@/lib/gst";
import { fireTrigger } from "@/lib/whatsapp";
import { AlertTriangle, Plus, Trash2, Loader2, SplitSquareHorizontal } from "lucide-react";
import { SplitBillDialog } from "@/components/SplitBillDialog";
import { logActivity, userDisplayName, ACTIVITY } from "@/lib/activityLog";
import { closeEventBlocksForBooking } from "@/lib/eventRoomBlocks";
import { usePaymentMethods, formatPaymentMethodLabel } from "@/hooks/use-payment-methods";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { istToday } from "@/lib/date";
import { reportQueryError } from "@/lib/queryError";
import { toastError } from "@/lib/errorMessage";
import { payableFolios } from "@/lib/folioSelect";
import { mergeSegmentBillToFolio } from "@/lib/paymentTargets";
import { finalizeBookingSettlement } from "@/lib/folioFinalize";

interface Props {
  bookingId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: () => void;
  /**
   * Bulk (sequential) checkout only: suppress the jump to the invoice page for
   * every room except the last one, otherwise the navigation would unmount the
   * queue mid-run. All other checkout logic is unchanged.
   */
  skipInvoiceNavigation?: boolean;
}

interface SummaryRow {
  label: string;
  amount: number;
}

interface PendingKot {
  id: string;
  kot_number: string;
  status: string;
  total_amount: number;
  sub_total: number;
  gst_amount: number;
}

interface PendingPosCharge {
  id: string;
  category_name: string;
  description: string;
  qty: number;
  rate: number;
  amount: number;
  gst_rate: number;
  gst_amount: number;
}

interface SplitRow {
  mode: string;
  amount: string;
  reference: string;
}

function checkoutFolioRank(f: any) {
  const status = String(f?.status ?? "");
  const balance = Number(f?.balance_amount ?? 0);
  const total = Number(f?.total_amount ?? 0);
  const isChild = Boolean(f?.parent_folio_id);
  const createdAt = new Date(f?.created_at ?? 0).getTime() || 0;
  return {
    payableOpen: status === "open" && balance > 0.01 ? 0 : 1,
    open: status === "open" ? 0 : 1,
    child: isChild ? 0 : 1,
    balance: -balance,
    total: -total,
    createdAt: -createdAt,
  };
}

function pickCheckoutFolio(rows: any[]) {
  // `payableFolios` drops any folio that has been split into live child
  // portions — its charges were cloned onto the children, so summing it
  // double-counts the bill and invents a phantom balance at check-out.
  return payableFolios([...rows] as any[])
    .sort((a: any, b: any) => {
      const ar = checkoutFolioRank(a);
      const br = checkoutFolioRank(b);
      return (
        ar.payableOpen - br.payableOpen ||
        ar.open - br.open ||
        ar.child - br.child ||
        ar.balance - br.balance ||
        ar.total - br.total ||
        ar.createdAt - br.createdAt
      );
    })[0] ?? null;
}

export function CheckoutDialog({ bookingId, open, onOpenChange, onDone, skipInvoiceNavigation }: Props) {
  // Phase 64 — after a successful checkout, take staff straight to the finalized
  // Lodge invoice instead of dropping them back on the Dashboard.
  const navigate = useNavigate();
  const currentPath = useRouterState({ select: (st) => st.location.pathname });
  const { user, roles } = useAuth();
  const { can } = usePermissions();
  const isOwnerRole = roles.includes("owner") || roles.includes("superadmin");
  const canSplit = can("billing", "split_bill");
  const [splitOpen, setSplitOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [booking, setBooking] = useState<any>(null);
  const [folio, setFolio] = useState<any>(null);
  // The booking's other live bill portions (after a Split Bill). Kept so the
  // dialog can show the TRUE combined state instead of one portion in isolation.
  const [otherFolios, setOtherFolios] = useState<any[]>([]);
  const [charges, setCharges] = useState<any[]>([]);
  // Separate flag: does a late-checkout charge row exist on this folio,
  // INCLUDING soft-deleted (wiped) ones? `charges` only holds live rows, so
  // the auto-late-fee guard must not use it — otherwise a staff-deleted late
  // fee would silently be re-added on every reopen.
  const [hasAnyLateChargeRow, setHasAnyLateChargeRow] = useState(false);
  const [payments, setPayments] = useState<any[]>([]);
  const [pendingKots, setPendingKots] = useState<PendingKot[]>([]);
  const [pendingPos, setPendingPos] = useState<PendingPosCharge[]>([]);
  const [pendingSegments, setPendingSegments] = useState<Array<{
    id: string; segment: string; bill_number: string; total_amount: number; paid_amount: number; balance: number;
  }>>([]);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  // Phase 48b — early checkout choice (actual stay vs full booked stay).
  const [earlyChoice, setEarlyChoice] = useState<"actual_stay" | "full_booked" | null>(null);
  const [earlyBusy, setEarlyBusy] = useState(false);
  const [property, setProperty] = useState<{ checkout_grace_time: string | null } | null>(null);
  const { methods: payMethods } = usePaymentMethods(booking?.property_id ?? null);
  // Bill-To confirmation gate (Phase 13.3).
  const [billToCompany, setBillToCompany] = useState<{ name: string; gstin: string | null } | null>(null);
  const [billToConfirmed, setBillToConfirmed] = useState(false);
  // Deliberate "checkout with an outstanding balance" — replaces the old
  // "Bill On Hold" workaround. Requires a mandatory reason.
  const [markDue, setMarkDue] = useState(false);
  const [dueReason, setDueReason] = useState("");
  // Late-checkout prompt (staff decides; never auto-applied).
  const [latePrompt, setLatePrompt] = useState<
    { graceStr: string; rate: number; roomId: string | null; roomNo: string } | null
  >(null);
  const [lateChoice, setLateChoice] = useState<"full" | "custom">("full");
  const [lateCustom, setLateCustom] = useState("");
  const [lateBusy, setLateBusy] = useState(false);

  // Payment form
  const [splitMode, setSplitMode] = useState(false);
  const [singleMode, setSingleMode] = useState("cash");
  const [singleAmount, setSingleAmount] = useState("");
  const [singleRef, setSingleRef] = useState("");
  const [splits, setSplits] = useState<SplitRow[]>([
    { mode: "cash", amount: "", reference: "" },
    { mode: "upi", amount: "", reference: "" },
  ]);
  // Guard so the auto-seed effect can only execute once per dialog-open.
  // Without this, a failed / no-op insert leaves `charges` empty and the
  // effect keeps re-firing every time `loading` toggles, producing the
  // Checkout Summary "loading/loaded" flicker reported for all checkouts.
  const didSeedRoomCharges = useRef(false);
  // Guard so the late-checkout auto-charge only runs once per open.
  const didLateChargeCheck = useRef(false);

  const load = useCallback(async () => {
    if (!bookingId) return;
    setLoading(true);
    const { data: b, error } = await supabase
      .from("bookings")
      .select(
        `id,booking_number,status,check_in,check_out,property_id,advance_amount,custom_remark,billing_company_id,rate_type,
         guests(name,mobile),
         booking_rooms!booking_rooms_booking_id_fkey(id,room_id,rate,check_in,check_out,rooms!booking_rooms_room_id_fkey(id,room_number),room_categories(name))`,
      )
      .eq("id", bookingId)
      .single();
    if (error) {
      toastError(error);
      setLoading(false);
      return;
    }
    setBooking(b);

    // Load linked billing company (if any) for the Bill-To gate.
    if ((b as any)?.billing_company_id) {
      const { data: co, error: __qe1 } = await supabase
        .from("billing_companies")
        .select("name,gstin")
        .eq("id", (b as any).billing_company_id)
        .maybeSingle();
      if (__qe1) reportQueryError("billing companies", __qe1);
      setBillToCompany(co ? { name: (co as any).name, gstin: (co as any).gstin ?? null } : null);
    } else {
      setBillToCompany(null);
    }

    if ((b as any)?.property_id) {
      const { data: prop, error: __qe2 } = await supabase
        .from("properties")
        .select("checkout_grace_time")
        .eq("id", (b as any).property_id)
        .maybeSingle();
      if (__qe2) reportQueryError("properties", __qe2);
      setProperty(prop as any);
    }

    const { data: liveFolios, error: liveFoliosErr } = await supabase
      .from("folios")
      .select("*")
      .eq("booking_id", bookingId)
      .eq("is_deleted", false)
      .not("status", "in", "(void,refunded)");
    if (liveFoliosErr) {
      toastError(liveFoliosErr);
      setLoading(false);
      return;
    }

    let selectedFolio = pickCheckoutFolio((liveFolios ?? []) as any[]);
    setOtherFolios(
      payableFolios((liveFolios ?? []) as any[]).filter((f: any) => f.id !== selectedFolio?.id),
    );
    if (!selectedFolio) {
      const { data: folioId, error: fErr } = await supabase.rpc("get_or_create_folio", {
        _booking_id: bookingId,
      });
      if (fErr) {
        toastError(fErr);
        setLoading(false);
        return;
      }
      const { data: createdFolio, error: createdFolioErr } = await supabase
        .from("folios")
        .select("*")
        .eq("id", folioId as any)
        .single();
      if (createdFolioErr) {
        toastError(createdFolioErr);
        setLoading(false);
        return;
      }
      selectedFolio = createdFolio;
    }

    const folioId = selectedFolio.id;

    const [{ data: c, error: __qp1 }, { data: p, error: __qp2 }, { data: pk, error: __qp3 }, { data: pos, error: __qp4 }] = await Promise.all([
      supabase.from("folio_charges").select("*").eq("folio_id", folioId as any).eq("is_wiped", false),
      supabase.from("payments").select("*").eq("folio_id", folioId as any),
      supabase
        .from("kot_orders")
        .select("id,kot_number,status,total_amount,sub_total,gst_amount")
        .eq("booking_id", bookingId)
        .eq("is_wiped", false)
        .neq("kot_copy", "restaurant_copy")
        .not("status", "in", "(billed,cancelled,void)"),
      supabase
        .from("pos_charges")
        .select("id,category_name,description,qty,rate,amount,gst_rate,gst_amount")
        .eq("booking_id", bookingId)
        .eq("status", "pending"),
    ]);
    if (__qp1) reportQueryError("folio charges", __qp1);
    if (__qp2) reportQueryError("payments", __qp2);
    if (__qp3) reportQueryError("payment methods", __qp3);
    if (__qp4) reportQueryError("POS charges", __qp4);
    setFolio(selectedFolio);
    setCharges(c ?? []);
    // Unfiltered lookup (wiped rows included) purely for the late-fee guard.
    const { data: lateRows, error: __qe3 } = await supabase
      .from("folio_charges")
      .select("id,description,charge_type,source_table")
      .eq("folio_id", folioId as any);
    if (__qe3) reportQueryError("folio charges", __qe3);
    setHasAnyLateChargeRow(
      ((lateRows ?? []) as any[]).some(
        (c: any) =>
          c.source_table === "late_checkout" ||
          (typeof c.description === "string" && /late\s*checkout/i.test(c.description)),
      ),
    );
    setPayments(p ?? []);
    setPendingKots((pk ?? []) as unknown as PendingKot[]);
    setPendingPos((pos ?? []) as unknown as PendingPosCharge[]);
    const { data: segs, error: __qe4 } = await supabase.rpc("has_pending_segment_bills", { _booking_id: bookingId });
    if (__qe4) reportQueryError("has pending segment bills", __qe4);
    setPendingSegments(((segs ?? []) as any[]).map((s) => ({
      id: s.id, segment: s.segment, bill_number: s.bill_number,
      total_amount: Number(s.total_amount || 0),
      paid_amount: Number(s.paid_amount || 0),
      balance: Number(s.balance || 0),
    })));
    setLoading(false);
  }, [bookingId]);

  useEffect(() => {
    if (open && bookingId) {
      setSplitMode(false);
      setSingleAmount("");
      setSingleRef("");
      setSingleMode("cash");
      setBillToConfirmed(false);
      setEarlyChoice(null);
      setEarlyBusy(false);
      setMarkDue(false);
      setDueReason("");
      setLatePrompt(null);
      setLateChoice("full");
      setLateCustom("");
      setLateBusy(false);
      didSeedRoomCharges.current = false;
      didLateChargeCheck.current = false;
      load();
    }
  }, [open, bookingId, load]);

  // Auto seed room charges if missing
  useEffect(() => {
    if (!open || loading || !folio || !booking) return;
    if (didSeedRoomCharges.current) return;
    // A settled folio is final — never re-derive or re-seed charges on it.
    if (folio.status === "settled" || folio.status === "due" || folio.status === "void") {
      didSeedRoomCharges.current = true;
      return;
    }
    if (!booking.booking_rooms?.length) return;
    const existingRoomSourceIds = new Set(
      charges
        .filter((c: any) => c.charge_type === "room" && c.source_table === "booking_rooms" && c.source_id)
        .map((c: any) => c.source_id),
    );
    const missingAssignedRooms = booking.booking_rooms.filter(
      (br: any) => br.room_id && Number(br.rate) > 0 && !existingRoomSourceIds.has(br.id),
    );
    if (missingAssignedRooms.length === 0) {
      didSeedRoomCharges.current = true;
      return;
    }
    (async () => {
      const results = await Promise.all(
        missingAssignedRooms.map((br: any) =>
          (supabase as any).rpc("seed_room_charge_for_booking_room", { _booking_room_id: br.id }),
        ),
      );
      const seedErr = results.find((result: any) => result.error)?.error;
      if (seedErr) {
        console.error("[CheckoutDialog] room charge seed failed", seedErr);
        toastError(seedErr, "Room charge could not be added");
        return;
      }
      // Only mark seeded after a successful insert so transient failures
      // don't leave the dialog stuck showing ₹0. The DB trigger on
      // folio_charges now recomputes folio totals automatically.
      didSeedRoomCharges.current = true;
      load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, folio?.id, booking?.id]);

  // Late checkout: if the current time is past the property's configured grace
  // time on (or after) the scheduled checkout date, PROMPT staff (apply or
  // waive) instead of silently inserting a charge. Runs at most once per open
  // and never re-prompts once a late-checkout row exists (even a deleted one).
  useEffect(() => {
    if (!open || loading || !folio || !booking || !property) return;
    if (didLateChargeCheck.current) return;
    if (folio.status === "settled" || folio.status === "due" || folio.status === "void") {
      didLateChargeCheck.current = true;
      return;
    }
    if (!booking.booking_rooms?.length) return;

    const graceStr = (property.checkout_grace_time ?? "14:30").slice(0, 5);
    const [gh, gm] = graceStr.split(":").map((n) => parseInt(n, 10));
    const coDate = String(booking.check_out).slice(0, 10);
    const graceDeadline = new Date(`${coDate}T${String(gh).padStart(2, "0")}:${String(gm).padStart(2, "0")}:00`);
    const now = new Date();

    if (now <= graceDeadline) {
      didLateChargeCheck.current = true;
      return;
    }

    // Includes soft-deleted rows: a late fee staff explicitly removed must
    // never be re-inserted.
    if (hasAnyLateChargeRow) {
      didLateChargeCheck.current = true;
      return;
    }

    const primaryRoom = booking.booking_rooms.find((br: any) => Number(br.rate) > 0) ?? booking.booking_rooms[0];
    const rate = Number(primaryRoom?.rate ?? 0);
    if (rate <= 0) {
      didLateChargeCheck.current = true;
      return;
    }

    didLateChargeCheck.current = true;
    setLateChoice("full");
    setLateCustom(String(rate));
    setLatePrompt({
      graceStr,
      rate,
      roomId: primaryRoom?.id ?? null,
      roomNo: primaryRoom?.rooms?.room_number ? String(primaryRoom.rooms.room_number) : "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loading, folio?.id, booking?.id, property?.checkout_grace_time, hasAnyLateChargeRow]);

  async function waiveLateCheckout() {
    const p = latePrompt;
    setLatePrompt(null);
    if (!p || !booking) return;
    await logActivity({
      property_id: booking.property_id,
      user_id: user?.id ?? "",
      user_name: userDisplayName(user as any),
      ...ACTIVITY.LATE_CHECKOUT_WAIVED,
      reference_id: folio?.id ?? booking.id,
      reference_label: booking.booking_number ?? null,
      details: { grace_time: p.graceStr, room_number: p.roomNo || null, room_rate: p.rate },
    });
    toast.message("Late checkout charge waived");
  }

  async function applyLateCheckout() {
    const p = latePrompt;
    if (!p || !booking || !folio) return;
    const amount = lateChoice === "full" ? p.rate : Number(lateCustom);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid late checkout amount");
      return;
    }
    setLateBusy(true);
    try {
      const { data: slabRows, error: __qe5 } = await supabase
        .from("gst_slabs" as any)
        .select("from_amount,to_amount,gst_rate,charge_category,is_active,effective_from")
        .eq("property_id", booking.property_id);
      if (__qe5) reportQueryError("gst slabs", __qe5);
      const tax = computeRoomChargeTax(
        amount,
        (slabRows ?? []) as any,
        ((booking as any).rate_type ?? "exclusive") as "inclusive" | "exclusive",
      );
      if (tax == null) {
        toast.error("GST slab missing for late-checkout rate. Configure it in Master Data → GST Slabs.");
        return;
      }
      const roomNo = p.roomNo ? ` — Rm ${p.roomNo}` : "";
      const label =
        lateChoice === "full"
          ? `Late Checkout — 1 additional night${roomNo} (after ${p.graceStr})`
          : `Late Checkout charge${roomNo} (after ${p.graceStr})`;
      const { error } = await supabase.from("folio_charges").insert({
        folio_id: folio.id,
        charge_type: "room",
        description: label,
        qty: 1,
        rate: amount,
        amount: tax.amount,
        gst_rate: tax.gstRate,
        gst_amount: tax.gstAmount,
        charged_on: istToday(),
        source_table: "late_checkout",
        source_id: p.roomId,
        created_by: user?.id ?? null,
      } as any);
      if (error) {
        toastError(error, "Late checkout charge could not be added");
        return;
      }
      await logActivity({
        property_id: booking.property_id,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        ...ACTIVITY.LATE_CHECKOUT_APPLIED,
        reference_id: folio.id,
        reference_label: booking.booking_number ?? null,
        details: { grace_time: p.graceStr, mode: lateChoice, amount, room_rate: p.rate },
      });
      setLatePrompt(null);
      toast.success(`Late checkout charge added (${inr(amount)})`);
      load();
    } finally {
      setLateBusy(false);
    }
  }

  const totals = useMemo(() => {
    const rooms: SummaryRow[] = [];
    const food: SummaryRow[] = [];
    const other: SummaryRow[] = [];
    // Display-only: roll segment (food/laundry) items up into one line per bill
    // ref, matching the folio print / invoice templates. Totals below still
    // recompute from the raw charge rows.
    for (const c of consolidateSegmentCharges(charges as any)) {
      const row: SummaryRow = { label: c.description, amount: Number(c.amount) };
      if (c.charge_type === "room") rooms.push(row);
      else if (c.charge_type === "food") food.push(row);
      else other.push(row);
    }
    const sum = (rs: SummaryRow[]) => rs.reduce((s, r) => s + r.amount, 0);
    const roomTotal = sum(rooms);
    const foodTotal = sum(food);
    const otherTotal = sum(other);
    const gstMode = (folio?.gst_mode as "cash" | "gst") ?? "cash";
    // Bill-level discount lives on the folio (not materialised as a charge line).
    // Without it the client recompute inflates GST/total vs the stored totals.
    const billDisc: BillDiscount | null =
      (folio as any)?.discount_type && Number((folio as any)?.discount_value) > 0
        ? {
            type: (folio as any).discount_type as "percent" | "amount",
            value: Number((folio as any).discount_value),
          }
        : null;
    const recomp = recomputeFolio(charges as any, gstMode, billDisc);
    const grand = recomp.total_amount;
    // "Bill On Hold" is a marker, not collected money — it must not settle a bill.
    const paid = realPaidTotal(payments as any[]);
    const balance = Math.max(0, grand - paid);
    return { rooms, food, other, roomTotal, foodTotal, otherTotal, grand, paid, balance };
  }, [charges, payments, folio?.gst_mode, (folio as any)?.discount_type, (folio as any)?.discount_value]);

  // Settled folio with zero balance: trust folios.balance_amount as the source
  // of truth and skip the client-side charge re-derivation entirely.
  const settledZero =
    !!folio && (folio.status === "settled" || folio.status === "due") && Number(folio.balance_amount ?? 0) <= 0.01;

  // Pre-fill single amount once balance computed
  useEffect(() => {
    if (!loading && singleAmount === "" && totals.balance > 0) {
      setSingleAmount(String(Math.round(totals.balance)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, totals.balance]);

  async function addPendingToBill() {
    if (!folio || !booking || pendingKots.length === 0) return;
    setBusy(true);
    const existingSrc = new Set(
      charges.filter((c: any) => c.source_table === "kot_orders").map((c: any) => c.source_id),
    );
    const toAdd = pendingKots.filter((k) => !existingSrc.has(k.id));
    if (toAdd.length > 0) {
      const rows = toAdd.map((k) => ({
        folio_id: folio.id,
        charge_type: "food",
        description: `Food · ${k.kot_number}`,
        qty: 1,
        rate: Number(k.sub_total),
        amount: Number(k.sub_total),
        gst_rate:
          Number(k.sub_total) > 0
            ? Math.round((Number(k.gst_amount) / Number(k.sub_total)) * 100)
            : 5,
        gst_amount: Number(k.gst_amount),
        source_table: "kot_orders",
        source_id: k.id,
        created_by: user?.id ?? null,
      }));
      const { error } = await supabase.from("folio_charges").insert(rows as any);
      if (error) {
        setBusy(false);
        return toastError(error);
      }
    }
    await supabase
      .from("kot_orders")
      .update({ status: "billed", billed_at: new Date().toISOString() } as any)
      .in("id", pendingKots.map((k) => k.id));
    toast.success("Food orders added to bill");
    setBusy(false);
    load();
  }

  async function addPendingPosToBill() {
    if (!folio || !booking || pendingPos.length === 0) return;
    setBusy(true);
    for (const pc of pendingPos) {
      const { data: inserted, error: cErr } = await supabase
        .from("folio_charges")
        .insert({
          folio_id: folio.id,
          charge_type: "extra",
          description: `${pc.category_name} · ${pc.description}`,
          qty: pc.qty,
          rate: pc.rate,
          amount: pc.amount,
          gst_rate: pc.gst_rate,
          gst_amount: pc.gst_amount,
          source_table: "pos_charges",
          source_id: pc.id,
          created_by: user?.id ?? null,
        } as any)
        .select("id")
        .single();
      if (cErr) { setBusy(false); return toastError(cErr); }
      await supabase.from("pos_charges")
        .update({ status: "billed", folio_charge_id: (inserted as any).id, billed_at: new Date().toISOString() } as any)
        .eq("id", pc.id);
    }
    // Recompute folio totals after inserting
    const { data: allCharges, error: __qe6 } = await supabase.from("folio_charges").select("*").eq("folio_id", folio.id);
    if (__qe6) reportQueryError("folio charges", __qe6);
    const mode = (folio.gst_mode as "cash" | "gst") ?? "gst";
    const posBillDisc: BillDiscount | null =
      (folio as any)?.discount_type && Number((folio as any)?.discount_value) > 0
        ? { type: (folio as any).discount_type as "percent" | "amount", value: Number((folio as any).discount_value) }
        : null;
    const t = recomputeFolio((allCharges ?? []) as any[], mode, posBillDisc);
    const { data: pays, error: __qe7 } = await supabase.from("payments").select("amount,mode").eq("folio_id", folio.id);
    if (__qe7) reportQueryError("payments", __qe7);
    const paid = realPaidTotal((pays ?? []) as any[]);
    await supabase.from("folios").update({
      ...t,
      paid_amount: paid,
      balance_amount: Math.max(0, t.total_amount - paid),
    } as any).eq("id", folio.id);
    toast.success(`${pendingPos.length} POS charge(s) added to bill`);
    setBusy(false);
    load();
  }

  async function transferSegmentBillToFolio(bill: {
    id: string; segment: string; bill_number: string;
  }) {
    if (!folio || !booking) return;
    setBusy(true);
    try {
      // Shared with the folio page's Collect Payment flow so both screens
      // merge segment bills exactly the same way.
      await mergeSegmentBillToFolio({
        billId: bill.id,
        segment: bill.segment,
        billNumber: bill.bill_number,
        folioId: folio.id,
        userId: user?.id ?? null,
      });
      toast.success(`${bill.bill_number} added to room bill`);
      await load();
    } catch (e: any) {
      toastError(e, "Failed to transfer segment bill");
    } finally {
      setBusy(false);
    }
  }

  function setSplit(i: number, patch: Partial<SplitRow>) {
    setSplits((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function collectAndCheckout() {
    if (!folio || !booking) return;
    if (early && !earlyChoice) {
      return toast.error("Select an early-checkout billing option first");
    }
    if (pendingKots.length > 0) {
      return toast.error("Add pending food orders to bill first");
    }
    if (pendingPos.length > 0) {
      return toast.error("Add pending POS charges to bill first");
    }
    if (pendingSegments.length > 0) {
      return toast.error("Settle or transfer pending Food/Laundry bills before checkout");
    }

    // Build payment rows
    const rows: { amount: number; mode: string; reference_no: string | null }[] = [];
    // When the folio is already settled per the DB (settledZero), skip the
    // client-derived balance gate entirely and rely on the DB refresh below.
    if (!settledZero && totals.balance > 0.01) {
      if (splitMode) {
        for (const s of splits) {
          const a = Number(s.amount);
          if (a > 0) rows.push({ amount: a, mode: s.mode, reference_no: s.reference || null });
        }
      } else {
        const a = Number(singleAmount);
        if (a > 0) {
          rows.push({ amount: a, mode: singleMode, reference_no: singleRef || null });
        }
      }
      // Holds are markers, not money — they cannot satisfy the balance.
      const total = realPaidTotal(rows as any[]);
      const overErr = overpaymentError(total, totals.balance);
      if (overErr) return toast.error(overErr);
      if (total + 0.01 < totals.balance && !markDue) {
        return toast.error(
          `Pending balance ${inr(totals.balance - total)}. Collect full payment first.`,
        );
      }
      if (markDue && !dueReason.trim()) {
        return toast.error("Enter a reason for leaving the balance as due");
      }
    }

    setBusy(true);
    if (rows.length > 0) {
      const { error: payErr } = await supabase.from("payments").insert(
        rows.map((r) => ({
          property_id: booking.property_id,
          folio_id: folio.id,
          booking_id: booking.id,
          amount: r.amount,
          mode: r.mode,
          reference_no: r.reference_no,
          created_by: user?.id ?? null,
        })) as any,
      );
      if (payErr) {
        setBusy(false);
        return toastError(payErr);
      }
      for (const r of rows) {
        logActivity({
          property_id: booking.property_id,
          user_id: user?.id ?? "",
          user_name: userDisplayName(user as never),
          action_type: "PAYMENT_RECEIVED",
          module: "Billing",
          reference_id: folio.id,
          reference_label: booking.booking_number ?? null,
          details: {
            booking_id: booking.id,
            folio_id: folio.id,
            amount: r.amount,
            mode: r.mode,
            source: "checkout",
          },
        });
      }
    }

    // Refresh folio from DB — payments_sync trigger has already recomputed
    // paid_amount, balance_amount, and status from the actual payment rows.
    // This avoids any stale local state ever driving checkout.
    const { data: freshFolio, error: refErr } = await supabase
      .from("folios")
      .select("id,total_amount,paid_amount,balance_amount,status")
      .eq("id", folio.id)
      .single();
    if (refErr) { setBusy(false); return toastError(refErr); }
    const liveBalance = Number((freshFolio as any)?.balance_amount ?? 0);
    if (liveBalance > 0.01 && !markDue) {
      setBusy(false);
      return toast.error(`Pending balance ${inr(liveBalance)}. Collect payment first.`);
    }

    if (liveBalance > 0.01) {
      // Deliberate "Mark as Due": finalize the bill with a real outstanding
      // balance. The RPC recomputes paid from real (non-hold) payments only,
      // stamps status = 'due' and writes the audit entry.
      const { error: dueErr } = await supabase.rpc("mark_folio_due" as any, {
        _folio_id: folio.id,
        _reason: dueReason.trim(),
      } as any);
      if (dueErr) { setBusy(false); return toastError(dueErr); }
      logActivity({
        property_id: booking.property_id,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as never),
        action_type: "CHECKOUT_WITH_DUE_BALANCE",
        module: "Billing",
        reference_id: folio.id,
        reference_label: booking.booking_number ?? null,
        details: {
          folio_id: folio.id,
          booking_id: booking.id,
          amount_due: liveBalance,
          reason: dueReason.trim(),
        },
      });
    } else {
      // Balance is zero — explicitly finalize EVERY live folio of this booking
      // (a split bill has one child per portion). Runs through a SECURITY
      // DEFINER RPC so it can't be silently denied by RLS, and any failure
      // aborts the checkout instead of freeing the room with an unsettled bill.
      try {
        await finalizeBookingSettlement(booking.id, folio.id);
      } catch (e) {
        setBusy(false);
        console.error("[CheckoutDialog] settle failed", e);
        return toastError(e, "Checkout stopped — the bill could not be settled");
      }
    }

    const now = new Date().toISOString();

    if (booking.status !== "checked_out" && booking.status !== "cancelled") {
      const { error: bkErr } = await supabase
        .from("bookings")
        .update({
          status: "checked_out",
          checked_out_at: now,
          checked_out_by: user?.id ?? null,
        } as any)
        .eq("id", booking.id);
      if (bkErr) {
        setBusy(false);
        console.error("[CheckoutDialog] booking status update failed", bkErr);
        return toastError(bkErr, "Checkout failed");
      }
    }

    const roomIds: string[] = [];
    for (const br of booking.booking_rooms ?? []) {
      const { error: brErr } = await supabase
        .from("booking_rooms")
        .update({ actual_check_out: now } as any)
        .eq("id", br.id);
      if (brErr) {
        setBusy(false);
        console.error("[CheckoutDialog] booking_rooms update failed", brErr);
        return toast.error(`Checkout failed (room ${br.rooms?.room_number ?? ""}): ${brErr.message}`);
      }
      if (br.rooms?.id) roomIds.push(br.rooms.id);
    }
    if (roomIds.length > 0) {
      const priorStatuses = (booking.booking_rooms ?? [])
        .filter((br: any) => br.rooms?.id)
        .map((br: any) => ({
          room_id: br.rooms.id,
          room_number: br.rooms.room_number ?? null,
          old_status: br.rooms.status ?? "occupied",
        }));
      const { error: rmErr } = await supabase
        .from("rooms")
        .update({ status: "vacant", housekeeping_status: "dirty" } as any)
        .in("id", roomIds);
      if (rmErr) {
        setBusy(false);
        console.error("[CheckoutDialog] rooms status update failed", rmErr);
        return toastError(rmErr, "Checkout partial: room status not updated —");
      }
      for (const p of priorStatuses) {
        logActivity({
          property_id: booking.property_id,
          user_id: user?.id ?? "",
          user_name: userDisplayName(user as never),
          action_type: "ROOM_STATUS_CHANGED",
          module: "Rooms",
          reference_id: p.room_id,
          reference_label: p.room_number ? `Room ${p.room_number}` : null,
          details: {
            room_id: p.room_id,
            room_number: p.room_number,
            old_status: p.old_status,
            new_status: "vacant",
            booking_id: booking.id,
          },
        });
      }
    }

    try {
      if (booking.guests?.mobile) {
        fireTrigger("checkout_bill", {
          property_id: booking.property_id,
          booking_id: booking.id,
          phone: booking.guests.mobile,
        });
      }
    } catch {
      /* ignore */
    }

    // Banquet rooms: close the linked event_room_blocks rows so the event tile
    // does not stay "occupied" after checkout. Fires regardless of the screen
    // that initiated this checkout.
    try {
      const closed = await closeEventBlocksForBooking(booking.id, user?.id ?? "");
      for (const blk of closed) {
        logActivity({
          property_id: booking.property_id,
          user_id: user?.id ?? "",
          user_name: userDisplayName(user as never),
          action_type: "ROOM_STATUS_CHANGED",
          module: "Banquet",
          reference_id: blk.room_id ?? blk.id,
          reference_label: blk.room_number ? `Room ${blk.room_number}` : null,
          details: {
            room_id: blk.room_id,
            room_number: blk.room_number,
            event_block_id: blk.id,
            old_status: "checked_in",
            new_status: "checked_out",
            booking_id: booking.id,
          },
        });
      }
    } catch (e) {
      console.error("[CheckoutDialog] event block close failed", e);
    }

    setBusy(false);
    toast.success(liveBalance > 0.01 ? `Checked out — ${inr(liveBalance)} marked as due` : "Checked out");
    onOpenChange(false);
    onDone?.();

    // Phase 64 — jump to this booking's finalized invoice (Print / PDF / Email /
    // WhatsApp all live there). Checkout has already committed at this point, so
    // the folio reflects whatever the Phase 48b early-checkout choice repriced it
    // to. Skip when we are already on that folio page — onDone() refreshes it.
    const invoicePath = `/billing/folio/${booking.id}`;
    if (!skipInvoiceNavigation && currentPath !== invoicePath) {
      navigate({ to: "/billing/folio/$bookingId", params: { bookingId: booking.id } });
    }
  }

  const advance = Number(booking?.advance_amount ?? 0);
  const roomNumbers =
    booking?.booking_rooms?.map((br: any) => br.rooms?.room_number).filter(Boolean).join(", ") ||
    "—";
  const nights = booking
    ? Math.max(
        1,
        Math.round(
          (new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) /
            86400000,
        ),
      )
    : 0;

  // ---- Phase 48b: early checkout detection (IST) ----
  const istTodayStr = istToday();
  const early = (() => {
    if (!booking) return null;
    if (booking.status === "checked_out" || booking.status === "cancelled") return null;
    const ci = String(booking.check_in).slice(0, 10);
    const co = String(booking.check_out).slice(0, 10);
    if (!(istTodayStr < co)) return null;
    // Never allow a zero-night stay: minimum one night from the check-in date.
    const newCheckout =
      istTodayStr > ci ? istTodayStr : new Date(new Date(`${ci}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
    const actualNights = Math.max(
      1,
      Math.round((new Date(`${newCheckout}T00:00:00Z`).getTime() - new Date(`${ci}T00:00:00Z`).getTime()) / 86400000),
    );
    if (actualNights >= nights) return null;
    return { checkIn: ci, bookedCheckout: co, newCheckout, actualNights, bookedNights: nights };
  })();

  const roomChargeTotal = charges
    .filter((c: any) => c.charge_type === "room")
    .reduce((s: number, c: any) => s + Number(c.amount || 0) + Number(c.gst_amount || 0), 0);

  async function applyEarlyChoice(choice: "actual_stay" | "full_booked") {
    if (!early || !booking) return;
    setEarlyChoice(choice);
    const oldRoomTotal = roomChargeTotal;
    if (choice === "actual_stay") {
      setEarlyBusy(true);
      // Rate stays locked (booking_rooms.rate untouched) — only the night count
      // changes, letting trg_seed_room_charge_for_booking_room re-price in place.
      for (const br of booking.booking_rooms ?? []) {
        const { error } = await supabase
          .from("booking_rooms")
          .update({ check_out: early.newCheckout } as any)
          .eq("id", br.id);
        if (error) {
          setEarlyBusy(false);
          setEarlyChoice(null);
          return toastError(error, "Could not shorten stay");
        }
      }
      const { error: bkErr } = await supabase
        .from("bookings")
        .update({ check_out: early.newCheckout } as any)
        .eq("id", booking.id);
      if (bkErr) {
        setEarlyBusy(false);
        setEarlyChoice(null);
        return toastError(bkErr, "Could not shorten stay");
      }
      // Reload so folio totals / balance reflect the reduced amount before payment.
      await load();
      setSingleAmount("");
      setEarlyBusy(false);
      toast.success(`Re-priced to ${early.actualNights} night(s) at the original locked rate.`);
    }
    const { data: freshCharges, error: __qe9 } = await supabase
      .from("folio_charges")
      .select("charge_type,amount,gst_amount,is_wiped")
      .eq("folio_id", folio?.id as any);
    if (__qe9) reportQueryError("folio charges", __qe9);
    const newRoomTotal = (freshCharges ?? [])
      .filter((c: any) => c.charge_type === "room" && !c.is_wiped)
      .reduce((s: number, c: any) => s + Number(c.amount || 0) + Number(c.gst_amount || 0), 0);
    logActivity({
      property_id: booking.property_id,
      user_id: user?.id ?? "",
      user_name: userDisplayName(user as never),
      action_type: "EARLY_CHECKOUT_CHOICE",
      module: "Front Desk",
      reference_id: booking.id,
      reference_label: booking.booking_number ?? null,
      details: {
        choice,
        booking_id: booking.id,
        booking_number: booking.booking_number ?? null,
        booked_nights: early.bookedNights,
        actual_nights: early.actualNights,
        booked_check_out: early.bookedCheckout,
        applied_check_out: choice === "actual_stay" ? early.newCheckout : early.bookedCheckout,
        old_room_charge: Math.round(oldRoomTotal * 100) / 100,
        new_room_charge: Math.round(newRoomTotal * 100) / 100,
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Checkout Summary</DialogTitle>
        </DialogHeader>

        {loading || !booking || !folio ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading…
          </div>
        ) : pendingKots.length > 0 || pendingPos.length > 0 || pendingSegments.length > 0 ? (
          <div className="space-y-4">
            {pendingSegments.length > 0 && (
            <div className="rounded-md border border-destructive/60 bg-destructive/5 p-4">
              <div className="flex items-center gap-2 font-medium text-destructive mb-2">
                <AlertTriangle className="h-5 w-5" /> Pending Food/Laundry bills
              </div>
              <div className="space-y-1 text-sm">
                {pendingSegments.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 gap-2">
                    <span className="uppercase text-xs flex-1 min-w-0 truncate">
                      <Badge variant="outline" className="mr-1 text-[10px]">{s.segment}</Badge>
                      {s.bill_number}
                    </span>
                    <span className="text-sm font-medium">{inr(s.balance)}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => transferSegmentBillToFolio({
                        id: s.id, segment: s.segment, bill_number: s.bill_number,
                      })}
                    >
                      Add to bill
                    </Button>
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground mt-3">
                Transfer each pending {`${""}`}Food/Laundry bill into the room folio before checkout.
                {isOwnerRole && " Owner may override with a reason from the folio page."}
              </div>
            </div>
            )}
            {pendingKots.length > 0 && (
            <div className="rounded-md border border-destructive/60 bg-destructive/5 p-4">
              <div className="flex items-center gap-2 font-medium text-destructive mb-2">
                <AlertTriangle className="h-5 w-5" /> Cannot Checkout
              </div>
              <div className="text-sm mb-2">Unsettled food orders:</div>
              <div className="space-y-1 text-sm">
                {pendingKots.map((k) => (
                  <div key={k.id} className="flex justify-between">
                    <span>
                      {k.kot_number} <Badge variant="outline" className="ml-1 text-[10px] uppercase">{k.status}</Badge>
                    </span>
                    <span>{inr(k.total_amount)}</span>
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground mt-3">
                Please add these to the room bill before checkout.
              </div>
            </div>
            )}
            {pendingPos.length > 0 && (
            <div className="rounded-md border border-destructive/60 bg-destructive/5 p-4">
              <div className="flex items-center gap-2 font-medium text-destructive mb-2">
                <AlertTriangle className="h-5 w-5" /> {pendingPos.length} POS charge(s) not yet added to bill
              </div>
              <div className="text-sm mb-2">
                Categories: {Array.from(new Set(pendingPos.map((p) => p.category_name))).join(", ")}
              </div>
              <div className="space-y-1 text-sm">
                {pendingPos.map((p) => (
                  <div key={p.id} className="flex justify-between">
                    <span>
                      <Badge variant="outline" className="ml-0 mr-1 text-[10px] uppercase">{p.category_name}</Badge>
                      {p.description}
                    </span>
                    <span>{inr(p.amount + p.gst_amount)}</span>
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground mt-3">
                Add these to the room bill before checkout.
              </div>
            </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              {pendingKots.length > 0 && (
                <Button onClick={addPendingToBill} disabled={busy}>
                  {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Add Food to Bill
                </Button>
              )}
              {pendingPos.length > 0 && (
                <Button onClick={addPendingPosToBill} disabled={busy}>
                  {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Add POS to Bill
                </Button>
              )}
            </DialogFooter>
          </div>
        ) : settledZero ? (
          <div className="space-y-4 text-sm">
            <div className="rounded border p-3 bg-muted/30">
              <div className="font-medium">
                Room {roomNumbers} · {booking.guests?.name ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                Check-in: {booking.check_in} · Check-out: {booking.check_out} · {nights} Night{nights > 1 ? "s" : ""}
              </div>
            </div>
            <div className="rounded-md border-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 p-4">
              <div className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                Bill settled
              </div>
              <div className="mt-1 text-lg font-semibold text-emerald-700 dark:text-emerald-300">
                ₹0 due — ready to close
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">
                Invoice {billNo(folio.invoice_number, "—")} · Total {inrRound(Number(folio.total_amount ?? 0))} · Paid{" "}
                {inrRound(Number(folio.paid_amount ?? 0))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={collectAndCheckout} disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                Confirm Checkout
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="rounded border p-3 bg-muted/30">
              <div className="font-medium">
                Room {roomNumbers} · {booking.guests?.name ?? "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                Check-in: {booking.check_in} · Check-out: {booking.check_out} · {nights} Night{nights > 1 ? "s" : ""}
              </div>
            </div>

            {booking.custom_remark && booking.custom_remark.trim() && (
              <div className="rounded-md border-2 border-red-500 bg-amber-50 dark:bg-amber-950/40 p-3 flex gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-xs font-bold uppercase tracking-wide text-red-700 dark:text-red-400">
                    Custom Remark
                  </div>
                  <div className="text-sm font-bold text-red-700 dark:text-red-400 whitespace-pre-wrap break-words">
                    {booking.custom_remark}
                  </div>
                </div>
              </div>
            )}

            <Section title="Room Charges" rows={totals.rooms} total={totals.roomTotal} />
            <div>
              <Section title="Food & Restaurant Bill" rows={totals.food} total={totals.foodTotal} empty="No food charges" />
            </div>
            <Section title="Other Charges" rows={totals.other} total={totals.otherTotal} empty="—" />

            <div className="flex justify-between border-t-2 border-foreground pt-2 font-semibold text-base">
              <span>GRAND TOTAL</span>
              <span>{inrRound(totals.grand)}</span>
            </div>

            {early && (
              <div className="rounded-md border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/40 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4" /> Early checkout — choose billing
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Booked till {early.bookedCheckout} ({early.bookedNights} night
                  {early.bookedNights > 1 ? "s" : ""}); checking out today ({istTodayStr}). Rate stays as
                  originally booked.
                </div>
                <label className="flex items-start gap-2 cursor-pointer text-sm">
                  <input
                    type="radio"
                    name="early-checkout-choice"
                    className="mt-1"
                    disabled={earlyBusy}
                    checked={earlyChoice === "actual_stay"}
                    onChange={() => applyEarlyChoice("actual_stay")}
                  />
                  <span>
                    Charge for actual stay ({early.actualNights} night{early.actualNights > 1 ? "s" : ""})
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer text-sm">
                  <input
                    type="radio"
                    name="early-checkout-choice"
                    className="mt-1"
                    disabled={earlyBusy}
                    checked={earlyChoice === "full_booked"}
                    onChange={() => applyEarlyChoice("full_booked")}
                  />
                  <span>
                    Charge for full booked stay ({early.bookedNights} night
                    {early.bookedNights > 1 ? "s" : ""})
                  </span>
                </label>
                {earlyBusy && (
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Re-pricing folio…
                  </div>
                )}
                {!earlyChoice && !earlyBusy && (
                  <div className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
                    Select an option to enable Collect &amp; Checkout.
                  </div>
                )}
              </div>
            )}

            <div className="rounded border p-3 space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase">Payment Received</div>
              {/* Advance is already inserted into `payments` at check-in, so it shows in the
                  list below. Do NOT render a separate advance row here (avoid double count). */}
              {payments
                .filter((p) => Number(p.amount) > 0)
                .map((p) => (
                  <div key={p.id} className="flex justify-between">
                    <span className="capitalize">
                      {p.mode}
                      {p.notes ? ` · ${p.notes}` : ""}
                    </span>
                    <span>{inr(p.amount)}</span>
                  </div>
                ))}
              {payments.length === 0 && (
                <div className="text-xs text-muted-foreground">No payments yet</div>
              )}
              <div className="flex justify-between border-t pt-2 font-semibold">
                <span>Balance Due</span>
                <span className={totals.balance > 0 ? "text-destructive" : "text-emerald-600"}>
                  {inrRound(totals.balance)}
                </span>
              </div>
              {otherFolios.length > 0 && (
                <div className="border-t pt-2 space-y-1">
                  <div className="text-[11px] uppercase text-muted-foreground">
                    Other portions of this booking
                  </div>
                  {otherFolios.map((f: any) => (
                    <div key={f.id} className="flex justify-between text-xs">
                      <span>
                        {f.invoice_number ? billNo(f.invoice_number) : "Provisional"}
                        {" · "}
                        <span className="capitalize">{f.status}</span>
                      </span>
                      <span className={Number(f.balance_amount ?? 0) > 0.01 ? "text-destructive" : "text-emerald-600"}>
                        {inrRound(Number(f.total_amount ?? 0))}
                        {Number(f.balance_amount ?? 0) > 0.01
                          ? ` · due ${inrRound(Number(f.balance_amount))}`
                          : " · paid"}
                      </span>
                    </div>
                  ))}
                  <div className="text-[11px] text-muted-foreground">
                    This portion only is being collected here; settled portions are not re-charged.
                  </div>
                </div>
              )}
            </div>

            {totals.balance > 0.01 && (
              <div className="rounded border p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">Collect Payment</div>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={splitMode}
                      onChange={(e) => setSplitMode(e.target.checked)}
                    />
                    Split payment
                  </label>
                </div>

                {!splitMode ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div>
                      <Label className="text-xs">Amount</Label>
                      <Input
                        type="number"
                        value={singleAmount}
                        onChange={(e) => setSingleAmount(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Mode</Label>
                      <Select value={singleMode} onValueChange={setSingleMode}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {payMethods.map((m) => (
                            <SelectItem key={m.id} value={m.name}>
                              {formatPaymentMethodLabel(m.name)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Reference</Label>
                      <Input value={singleRef} onChange={(e) => setSingleRef(e.target.value)} />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {splits.map((s, i) => (
                      <div key={i} className="grid grid-cols-1 gap-2 items-end sm:grid-cols-[1fr_1fr_1fr_auto]">
                        <div>
                          <Label className="text-xs">Mode</Label>
                          <Select value={s.mode} onValueChange={(v) => setSplit(i, { mode: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {payMethods.map((m) => (
                                <SelectItem key={m.id} value={m.name}>
                                  {formatPaymentMethodLabel(m.name)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">Amount</Label>
                          <Input
                            type="number"
                            value={s.amount}
                            onChange={(e) => setSplit(i, { amount: e.target.value })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Reference</Label>
                          <Input
                            value={s.reference}
                            onChange={(e) => setSplit(i, { reference: e.target.value })}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setSplits((rs) => rs.filter((_, idx) => idx !== i))}
                          disabled={splits.length <= 1}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSplits((rs) => [...rs, { mode: "cash", amount: "", reference: "" }])}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Add payment row
                    </Button>
                    <div className="text-xs text-muted-foreground">
                      Split total: {inr(splits.reduce((s, r) => s + (Number(r.amount) || 0), 0))} ·
                      Required: {inr(totals.balance)}
                    </div>
                  </div>
                )}

              </div>
            )}

            <div className="mb-2 flex flex-col gap-2 sm:flex-row">
              {totals.balance > 0.01 && (
                <div className={`flex-1 min-w-0 rounded-md border-2 p-2.5 ${markDue ? "border-red-400 bg-red-50" : "border-dashed"}`}>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={markDue}
                      onChange={(e) => { setMarkDue(e.target.checked); if (!e.target.checked) setDueReason(""); }}
                    />
                    <div className="text-sm">
                      <div className="font-semibold">
                        Mark remaining {inr(Math.max(0, totals.balance - (splitMode
                          ? splits.reduce((s, r) => s + (Number(r.amount) || 0), 0)
                          : Number(singleAmount) || 0)))} as Due
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        Checkout without full payment — tracked in Dues.
                      </div>
                    </div>
                  </label>
                  {markDue && (
                    <div className="mt-2">
                      <Label className="text-xs">Reason (required)</Label>
                      <Input
                        value={dueReason}
                        onChange={(e) => setDueReason(e.target.value)}
                        placeholder="e.g. Company to settle by NEFT on 12th"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className={`flex-1 min-w-0 rounded-md border-2 p-2.5 ${billToConfirmed ? "border-emerald-500 bg-emerald-50" : "border-amber-500 bg-amber-50"}`}>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={billToConfirmed}
                    onChange={(e) => setBillToConfirmed(e.target.checked)}
                  />
                  <div className="text-sm">
                    <div className="font-semibold">
                      Confirm: bill will be raised to{" "}
                      <span className="text-primary">
                        {billToCompany
                          ? `${billToCompany.name}${billToCompany.gstin ? ` (${billToCompany.gstin})` : ""}`
                          : (booking?.guests?.name ?? "Guest")}
                      </span>
                    </div>
                    {!billToConfirmed && (
                      <div className="text-[11px] text-amber-800 mt-0.5">Tick to enable Collect &amp; Checkout.</div>
                    )}
                  </div>
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              {canSplit && totals.grand > 0 && (
                <Button variant="outline" onClick={() => setSplitOpen(true)} disabled={busy}>
                  <SplitSquareHorizontal className="h-4 w-4 mr-1" /> Split Bill
                </Button>
              )}
              <Button
                onClick={collectAndCheckout}
                disabled={busy || !billToConfirmed || earlyBusy || (!!early && !earlyChoice) || (markDue && !dueReason.trim())}
              >
                {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {markDue ? "Checkout with Due Balance" : "Collect & Checkout"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
      <SplitBillDialog
        open={splitOpen}
        onOpenChange={setSplitOpen}
        folio={folio}
        booking={booking}
        charges={charges as any}
        onDone={() => {
          setSplitOpen(false);
          onOpenChange(false);
          onDone?.();
        }}
      />
      <Dialog open={!!latePrompt} onOpenChange={(o) => { if (!o && !lateBusy) setLatePrompt(null); }}>
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle>Late checkout</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Guest is checking out after the grace time ({latePrompt?.graceStr}). Apply a late checkout charge?
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={lateChoice === "full"}
                  onChange={() => setLateChoice("full")}
                />
                <span>Full night ({inr(latePrompt?.rate ?? 0)} — room's current rate)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={lateChoice === "custom"}
                  onChange={() => setLateChoice("custom")}
                />
                <span>Custom amount</span>
              </label>
              {lateChoice === "custom" && (
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={lateCustom}
                  onChange={(e) => setLateCustom(e.target.value)}
                  placeholder="Enter amount"
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={lateBusy} onClick={waiveLateCheckout}>
              No — waive
            </Button>
            <Button disabled={lateBusy} onClick={applyLateCheckout}>
              {lateBusy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Yes — apply charge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function Section({
  title,
  rows,
  total,
  empty,
}: {
  title: string;
  rows: SummaryRow[];
  total: number;
  empty?: string;
}) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground uppercase mb-1">{title}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-muted-foreground italic">{empty ?? "—"}</div>
      ) : (
        <div className="space-y-1">
          {rows.map((r, i) => (
            <div key={i} className="flex justify-between">
              <span className="truncate pr-2">{r.label}</span>
              <span>{inr(r.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1 font-medium">
            <span>{title.split(" ")[0]} Total</span>
            <span>{inr(total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}