import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, hasRole } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { usePaymentMethods, formatPaymentMethodLabel } from "@/hooks/use-payment-methods";
import { toast } from "sonner";
import {
  FOLIO_STATUS_TONE,
  inr,
  recomputeFolio,
  computeBillDiscountAmount,
  type BillDiscount,
 inrRound,
} from "@/lib/billing";
import { ArrowLeft, Plus, Printer, Trash2, CheckCircle2, Ban, Hotel, Download, Mail, MessageCircle, Percent } from "lucide-react";
import { AlertTriangle, ShieldAlert, ArrowRightLeft } from "lucide-react";
import { verifyManagerPassword } from "@/lib/manager-verify";
import { CheckoutDialog } from "@/components/CheckoutDialog";
import { ShiftToMisDialog } from "@/components/ShiftToMisDialog";
import { ACTIVITY, logActivity, userDisplayName } from "@/lib/activityLog";
import {
  renderInvoiceHtml,
  openInvoiceWindow,
  resolveLogoUrl,
  type InvoiceProperty,
} from "@/lib/invoiceTemplates";
import { fetchPrinterPaperSize, withPrintStyles } from "@/lib/printStyles";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/billing/folio/$bookingId")({
  head: () => ({ meta: [{ title: "Folio — HotelPilot" }] }),
  component: () => (<RequirePermission module="invoices"><FolioPage /></RequirePermission>),
});

interface Charge {
  id: string; charge_type: string; description: string;
  qty: number; rate: number; amount: number;
  gst_rate: number; gst_amount: number; charged_on: string;
  source_table: string | null; source_id: string | null;
  discount_type?: "percent" | "amount" | null;
  discount_value?: number | null;
  discount_amount?: number | null;
}
interface Payment {
  id: string; amount: number; mode: string; reference_no: string | null;
  paid_at: string; notes: string | null;
}
interface Folio {
  id: string; invoice_number: string; gst_mode: string; status: string;
  sub_total: number; discount_amount: number; gst_amount: number;
  total_amount: number; paid_amount: number; balance_amount: number;
  guest_gstin: string | null; guest_company: string | null;
  notes: string | null; property_id: string; bill_type: string | null;
  discount_type?: "percent" | "amount";
  discount_value?: number;
  round_off_amount?: number;
  complimentary_food_used?: number;
}
interface BookingCtx {
  id: string; booking_number: string; status: string;
  check_in: string; check_out: string; total_amount: number;
  property_id: string; adults: number | null; children: number | null;
  guests: {
    name: string; mobile: string | null; gst_number: string | null; company: string | null; address: string | null;
    id_proof_type: string | null; id_proof_number: string | null; nationality: string | null;
  } | null;
  booking_rooms: {
    id: string; rate: number; check_in: string; check_out: string;
    actual_check_in?: string | null; actual_check_out?: string | null;
    rooms: { room_number: string } | null;
    room_categories: { name: string; gst_rate: number | null } | null;
  }[];
}
type PropertyInfo = InvoiceProperty & {
  address?: string | null; // legacy
  pincode?: string | null; // legacy
  use_gst_slabs?: boolean | null;
};

interface GstSlab {
  from_amount: number;
  to_amount: number;
  gst_rate: number;
}

/** Resolve the GST% for a room whose nightly tariff is `nightlyRate`.
 * When the property has "Custom GST Slabs" enabled, look up the matching
 * slab row (from_amount ≤ nightlyRate ≤ to_amount). Otherwise fall back to
 * the room category's configured gst_rate, then to 12%. */
function resolveRoomGstRate(
  nightlyRate: number,
  useSlabs: boolean,
  slabs: GstSlab[],
  categoryGst: number | null | undefined,
): number {
  if (useSlabs && slabs.length > 0) {
    const hit = slabs.find(
      (s) => Number(nightlyRate) >= Number(s.from_amount)
          && Number(nightlyRate) <= Number(s.to_amount),
    );
    if (hit) return Number(hit.gst_rate);
  }
  const cat = Number(categoryGst);
  return Number.isFinite(cat) && cat > 0 ? cat : 12;
}
interface PendingKot {
  id: string; kot_number: string; status: string;
  total_amount: number; sub_total: number;
  items: { id: string; item_name: string; qty: number; rate: number }[];
}

/** Format a date/timestamp as "14 Jul 2026, 12:00 PM".
 *  If `value` is already an ISO timestamp, use it directly; if only a date is
 *  available, combine it with the property's default check-in/out time. */
function fmtDateTime(value: string | null | undefined, fallbackTime?: string | null): string {
  if (!value) return "—";
  const isTs = value.includes("T") || value.length > 10;
  const t = (fallbackTime && fallbackTime.length >= 5) ? fallbackTime.slice(0, 5) : "12:00";
  const d = isTs ? new Date(value) : new Date(`${value}T${t}:00`);
  if (isNaN(d.getTime())) return String(value);
  const date = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}, ${time}`;
}

function FolioPage() {
  const { bookingId } = Route.useParams();
  const router = useRouter();
  const { user, roles } = useAuth();
  const { can } = usePermissions();
  // Cash Bill toggle is strictly owner-only. Superadmin does NOT get this
  // toggle, even in impersonation mode. All other roles silently default to
  // GST Invoice — the toggle component itself is not rendered.
  const isOwnerStrict = roles.includes("owner") && !roles.includes("superadmin");
  const [booking, setBooking] = useState<BookingCtx | null>(null);
  const [property, setProperty] = useState<PropertyInfo | null>(null);
  const [gstSlabs, setGstSlabs] = useState<GstSlab[]>([]);
  const [folio, setFolio] = useState<Folio | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [foodBillNumber, setFoodBillNumber] = useState<string | null>(null);
  const [maxDiscPct, setMaxDiscPct] = useState<number>(100);
  const { methods: payMethods } = usePaymentMethods(folio?.property_id ?? booking?.property_id ?? null);

  // Guards so auto-seed effects run at most once per folio load.
  // Without these, a silent unique-constraint (409) failure on insert
  // triggers load() → charges refresh → effect re-runs → infinite flicker.
  const didSeedRoomChargesRef = useRef<string | null>(null);
  const didPullKotChargesRef = useRef<string | null>(null);

  // dialogs
  const [addOpen, setAddOpen] = useState(false);
  const [addDesc, setAddDesc] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [addRate, setAddRate] = useState("0");
  const [addType, setAddType] = useState<"extra" | "discount">("extra");
  const [addGst, setAddGst] = useState("0");

  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMode, setPayMode] = useState<string>("cash");
  const [payRef, setPayRef] = useState("");
  const [payNote, setPayNote] = useState("");

  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");

  // Discount dialog (bill-level or line-item)
  const [discOpen, setDiscOpen] = useState(false);
  const [discTarget, setDiscTarget] = useState<
    | { kind: "bill" }
    | { kind: "line"; chargeId: string; base: number; description: string }
  >({ kind: "bill" });
  const [discType, setDiscType] = useState<"percent" | "amount">("percent");
  const [discValue, setDiscValue] = useState<string>("");

  // Pending KOT lock state
  const [pendingKots, setPendingKots] = useState<PendingKot[]>([]);
  // Pending POS charges (custom expenses awaiting Add to Bill)
  const [pendingPos, setPendingPos] = useState<Array<{
    id: string; category_name: string; description: string;
    qty: number; rate: number; amount: number; gst_rate: number; gst_amount: number;
  }>>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [mgrEmail, setMgrEmail] = useState("");
  const [mgrPass, setMgrPass] = useState("");
  const [mgrReason, setMgrReason] = useState("");
  const [mgrBusy, setMgrBusy] = useState(false);
  const [overrideApproved, setOverrideApproved] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [draftMode, setDraftMode] = useState(false);
  const [misOpen, setMisOpen] = useState(false);
  const [misFoodOnly, setMisFoodOnly] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  // PDF download uses browser print dialog — no async state needed.

  const load = useCallback(async () => {
    setLoading(true);
    const { data: b, error: be } = await supabase
      .from("bookings")
      .select(`id,booking_number,status,check_in,check_out,total_amount,property_id,adults,children,
        guests(name,mobile,gst_number,company,address,id_proof_type,id_proof_number,nationality),
        booking_rooms(id,rate,check_in,check_out,actual_check_in,actual_check_out,rooms!booking_rooms_room_id_fkey(room_number),room_categories(name,gst_rate))`)
      .eq("id", bookingId).single();
    if (be) { toast.error(be.message); setLoading(false); return; }
    const bk = b as unknown as BookingCtx;
    setBooking(bk);

    const { data: prop } = await supabase.from("properties")
      .select(`name,legal_entity_name,tagline,gstin,pan_number,state,state_code,
        address_line1,address_line2,city,pin_code,phone,email,website,wa_number,logo_url,
        invoice_prefix,invoice_footer,invoice_primary_color,invoice_template,
        invoice_show_hsn,invoice_show_gst_breakup,invoice_show_signature,invoice_show_powered_by,
        default_checkin_time,default_checkout_time,
        food_gst_rate,sundry_gst_rate,use_gst_slabs,
        address,pincode`)
      .eq("id", bk.property_id).single();
    setProperty((prop ?? null) as PropertyInfo | null);
    // Resolve logo storage path -> signed URL for on-screen + print capture.
    if ((prop as any)?.logo_url) {
      resolveLogoUrl((prop as any).logo_url).then((url) => {
        if (url) setProperty((cur) => cur ? { ...cur, logo_url: url } : cur);
      });
    }

    // Load custom GST slabs for this property (used to resolve room-charge GST%).
    const { data: sl } = await supabase
      .from("gst_slabs" as any)
      .select("from_amount,to_amount,gst_rate")
      .eq("property_id", bk.property_id);
    const slabRows = ((sl ?? []) as unknown as GstSlab[]);
    setGstSlabs(slabRows);
    const useSlabs = !!(prop as any)?.use_gst_slabs;

    // get or create folio
    const { data: folioId, error: fe } = await supabase
      .rpc("get_or_create_folio", { _booking_id: bookingId });
    if (fe) { toast.error(fe.message); setLoading(false); return; }
    const fId = folioId as unknown as string;

    const [{ data: f }, { data: c }, { data: p }] = await Promise.all([
      supabase.from("folios").select("*").eq("id", fId).single(),
      supabase.from("folio_charges").select("*").eq("folio_id", fId).order("charged_on").order("created_at"),
      supabase.from("payments").select("*").eq("folio_id", fId).order("paid_at", { ascending: false }),
    ]);
    setFolio((f ?? null) as unknown as Folio);
    // Auto-correct any room charge whose stored gst_rate doesn't match the
    // property's current slab configuration. This repairs folios seeded
    // before Custom GST Slabs were enabled (or when a hardcoded fallback
    // of 12% was applied).
    const rawCharges = ((c ?? []) as unknown as Charge[]);
    const fixes: Array<{ id: string; gst_rate: number; gst_amount: number }> = [];
    const correctedCharges = rawCharges.map((ch) => {
      if (ch.charge_type !== "room") return ch;
      const catGst = bk.booking_rooms.find((br) => br.id === ch.source_id)
        ?.room_categories?.gst_rate ?? null;
      const nightly = Number(ch.rate);
      const want = resolveRoomGstRate(nightly, useSlabs, slabRows, catGst);
      if (Math.abs(Number(ch.gst_rate) - want) < 0.01) return ch;
      const amt = Number(ch.amount);
      const nextGstAmt = Math.round(amt * want) / 100;
      fixes.push({ id: ch.id, gst_rate: want, gst_amount: nextGstAmt });
      return { ...ch, gst_rate: want, gst_amount: nextGstAmt };
    });
    if (fixes.length > 0) {
      await Promise.all(fixes.map((fx) =>
        supabase.from("folio_charges")
          .update({ gst_rate: fx.gst_rate, gst_amount: fx.gst_amount })
          .eq("id", fx.id),
      ));
      // Re-persist folio totals so the stored sub_total / gst_amount /
      // total_amount reflect the corrected slab-based GST rows.
      const fRow = f as any;
      if (fRow) {
        const mode = (fRow.gst_mode as "cash" | "gst");
        const billDisc = fRow.discount_type && Number(fRow.discount_value) > 0
          ? { type: fRow.discount_type as "percent" | "amount", value: Number(fRow.discount_value) }
          : null;
        const t = recomputeFolio(correctedCharges as any, mode, billDisc);
        const paid = (p ?? []).reduce((s: number, pp: any) => s + Number(pp.amount), 0);
        await supabase.from("folios").update({
          ...t,
          paid_amount: paid,
          balance_amount: Math.max(0, t.total_amount - paid),
        }).eq("id", fRow.id);
        setFolio({ ...fRow, ...t, paid_amount: paid, balance_amount: Math.max(0, t.total_amount - paid) } as any);
      }
    }
    setCharges(correctedCharges);
    setPayments(((p ?? []) as unknown as Payment[]));

    // Load the linked Food Bill number (FB-XXXX) if any food charge exists.
    const hasFood = correctedCharges.some((c) => c.charge_type === "food");
    if (hasFood && bk?.id) {
      const { data: fb } = await supabase
        .from("food_bills" as any)
        .select("food_bill_number")
        .eq("booking_id", bk.id)
        .maybeSingle();
      setFoodBillNumber((fb as any)?.food_bill_number ?? null);
    } else {
      setFoodBillNumber(null);
    }

    // Resolve current user's max-discount % for this property.
    try {
      if (user?.id) {
        const { data: pct } = await supabase.rpc("user_max_discount_pct", {
          _user_id: user.id, _property_id: bk.property_id,
        });
        const n = Number(pct);
        setMaxDiscPct(Number.isFinite(n) ? n : 0);
      }
    } catch { /* keep default */ }

    // Load pending KOTs (not served/billed/cancelled, not wiped)
    const { data: pk } = await supabase
      .from("kot_orders")
      .select("id,kot_number,status,total_amount,sub_total,kot_items(id,item_name,qty,rate)")
      .eq("booking_id", bookingId)
      .eq("is_wiped", false)
      .neq("kot_copy", "restaurant_copy")
      .not("status", "in", "(billed,cancelled,void)");
    setPendingKots(((pk ?? []) as unknown as PendingKot[]));

    // Load pending POS charges (custom expenses awaiting add-to-bill)
    const { data: pos } = await supabase
      .from("pos_charges")
      .select("id,category_name,description,qty,rate,amount,gst_rate,gst_amount")
      .eq("booking_id", bookingId)
      .eq("status", "pending");
    setPendingPos((pos ?? []) as any);

    setLoading(false);
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);

  // Reset seed guards when navigating between folios
  useEffect(() => {
    didSeedRoomChargesRef.current = null;
    didPullKotChargesRef.current = null;
  }, [bookingId]);

  // Auto-seed room charges if none present
  useEffect(() => {
    if (!folio || !booking || loading) return;
    if (charges.some((c) => c.charge_type === "room")) return;
    if (booking.booking_rooms.length === 0) return;
    if (didSeedRoomChargesRef.current === folio.id) return;
    didSeedRoomChargesRef.current = folio.id;
    (async () => {
      const rows = booking.booking_rooms.map((br) => {
        const nights = Math.max(1, Math.round(
          (new Date(br.check_out).getTime() - new Date(br.check_in).getTime()) / 86400000,
        ));
        const amt = nights * Number(br.rate);
        const gstR = resolveRoomGstRate(
          Number(br.rate),
          !!property?.use_gst_slabs,
          gstSlabs,
          br.room_categories?.gst_rate ?? null,
        );
        return {
          folio_id: folio.id,
          charge_type: "room",
          description: `Room ${br.rooms?.room_number ?? ""} · ${br.room_categories?.name ?? ""} · ${nights} night(s)`,
          qty: nights,
          rate: Number(br.rate),
          amount: amt,
          gst_rate: gstR,
          gst_amount: Math.round(amt * gstR) / 100,
          source_table: "booking_rooms",
          source_id: br.id,
          created_by: user?.id ?? null,
        };
      }).filter((r) => Number(r.rate) > 0);
      if (rows.length === 0) return;
      const { error } = await supabase.from("folio_charges").insert(rows as any);
      if (error) {
        // 23505 = unique_violation → charge already exists, no-op.
        if ((error as any).code !== "23505") {
          console.warn("[folio] auto-seed room charges failed:", error.message);
        }
        return;
      }
      load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folio?.id, booking?.id, loading]);

  // Auto-pull served/billed food KOTs that haven't been added to the folio yet
  useEffect(() => {
    if (!folio || !booking || loading) return;
    if (folio.status !== "open") return;
    if (didPullKotChargesRef.current === folio.id) return;
    (async () => {
      const { data: kots } = await supabase
        .from("kot_orders")
        .select("id,kot_number,sub_total,gst_amount,status")
        .eq("booking_id", booking.id)
        .eq("is_wiped", false)
        .neq("kot_copy", "restaurant_copy")
        .in("status", ["served", "billed"]);
      if (!kots || kots.length === 0) return;
      const existing = new Set(
        charges.filter((c) => c.source_table === "kot_orders").map((c) => c.source_id),
      );
      const toAdd = (kots as any[]).filter((k) => !existing.has(k.id));
      if (toAdd.length === 0) {
        didPullKotChargesRef.current = folio.id;
        return;
      }
      didPullKotChargesRef.current = folio.id;
      const rows = toAdd.map((k) => ({
        folio_id: folio.id,
        charge_type: "food",
        description: `Food · ${k.kot_number}`,
        qty: 1,
        rate: Number(k.sub_total),
        amount: Number(k.sub_total),
        gst_rate: Number(k.sub_total) > 0
          ? Math.round((Number(k.gst_amount) / Number(k.sub_total)) * 100) : 5,
        gst_amount: Number(k.gst_amount),
        source_table: "kot_orders",
        source_id: k.id,
        created_by: user?.id ?? null,
      }));
      const { error } = await supabase.from("folio_charges").insert(rows as any);
      if (error) {
        if ((error as any).code !== "23505") {
          console.warn("[folio] auto-pull KOT charges failed:", error.message);
        }
        return;
      }
      await supabase.from("kot_orders")
        .update({ status: "billed", billed_at: new Date().toISOString() })
        .in("id", toAdd.map((k: any) => k.id));
      load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folio?.id, booking?.id, loading]);

  async function pullFoodCharges() {
    if (!folio || !booking) return;
    const { data: kots } = await supabase
      .from("kot_orders")
      .select("id,kot_number,sub_total,gst_amount,total_amount,status")
      .eq("booking_id", booking.id)
      .in("status", ["served", "billed"]);
    if (!kots || kots.length === 0) return toast.info("No food KOTs to pull");
    const existing = new Set(charges.filter((c) => c.source_table === "kot_orders").map((c) => c.source_id));
    const toAdd = (kots as any[]).filter((k) => !existing.has(k.id));
    if (toAdd.length === 0) return toast.info("All KOTs already added");
    const rows = toAdd.map((k) => ({
      folio_id: folio.id,
      charge_type: "food",
      description: `Food · ${k.kot_number}`,
      qty: 1,
      rate: Number(k.sub_total),
      amount: Number(k.sub_total),
      gst_rate: Number(k.sub_total) > 0 ? Math.round((Number(k.gst_amount) / Number(k.sub_total)) * 100) : 5,
      gst_amount: Number(k.gst_amount),
      source_table: "kot_orders",
      source_id: k.id,
      created_by: user?.id ?? null,
    }));
    const { error } = await supabase.from("folio_charges").insert(rows as any);
    if (error) return toast.error(error.message);
    await supabase.from("kot_orders").update({ status: "billed", billed_at: new Date().toISOString() })
      .in("id", toAdd.map((k: any) => k.id));
    toast.success(`Pulled ${toAdd.length} KOT(s)`);
    load();
  }

  async function persistTotals(nextCharges: Charge[], nextPayments: Payment[], extraFolioPatch: Partial<Folio> = {}) {
    if (!folio) return;
    const mode = (extraFolioPatch.gst_mode as "cash" | "gst") ?? (folio.gst_mode as "cash" | "gst");
    const nextDiscType = (extraFolioPatch.discount_type as "percent" | "amount" | undefined)
      ?? (folio.discount_type as "percent" | "amount" | undefined);
    const nextDiscValue = extraFolioPatch.discount_value ?? folio.discount_value ?? 0;
    const billDisc: BillDiscount | null = nextDiscType && nextDiscValue > 0
      ? { type: nextDiscType, value: Number(nextDiscValue) }
      : null;
    const t = recomputeFolio(nextCharges, mode, billDisc);
    const paid = nextPayments.reduce((s, p) => s + Number(p.amount), 0);
    await supabase.from("folios").update({
      ...t,
      paid_amount: paid,
      balance_amount: Math.max(0, t.total_amount - paid),
      ...extraFolioPatch,
    }).eq("id", folio.id);
  }

  async function toggleMode(mode: "cash" | "gst") {
    if (!folio) return;
    if (mode === "cash" && !isOwnerStrict) {
      toast.error("Only the property owner can generate a Cash Bill");
      return;
    }
    const bill_type = mode === "gst" ? "gst_invoice" : "cash_bill";
    await persistTotals(charges, payments, { gst_mode: mode, bill_type } as Partial<Folio>);
    if (mode === "cash" && booking && user) {
      logActivity({
        property_id: folio.property_id,
        user_id: user.id,
        user_name: userDisplayName(user as any),
        action_type: "CASH_BILL_GENERATED",
        module: "Billing",
        reference_id: folio.id,
        reference_label: folio.invoice_number,
        details: {
          bill_number: folio.invoice_number,
          amount: Number(folio.total_amount ?? 0),
          guest_name: booking?.guests?.name ?? null,
          generated_by: user.id,
        },
      });
    }
    toast.success(`Mode: ${mode === "gst" ? "GST tax invoice" : "Cash bill"}`);
    load();
  }

  async function addCharge() {
    if (!folio) return;
    if (!addDesc.trim()) return toast.error("Description required");
    if (!isOpen && !canEditAnyStatus) return toast.error("Only manager/owner can edit a settled bill");
    const qty = Number(addQty) || 1;
    const rate = Number(addRate) || 0;
    const amt = qty * rate;
    const gstR = addType === "discount" ? 0 : Number(addGst) || 0;
    if (addType === "discount") {
      const unlimited = hasRole(roles, "owner") || hasRole(roles, "superadmin");
      const capPct = unlimited ? 100 : Math.max(0, Math.min(100, maxDiscPct));
      const base = Number(folio.sub_total || 0);
      const capAmt = (base * capPct) / 100;
      if (!unlimited && Math.abs(amt) > capAmt + 0.01) {
        return toast.error(`Your role allows maximum ${capPct}% discount (₹${capAmt.toLocaleString("en-IN", { maximumFractionDigits: 2 })}).`);
      }
    }
    const { error } = await supabase.from("folio_charges").insert({
      folio_id: folio.id,
      charge_type: addType,
      description: addDesc,
      qty,
      rate,
      amount: addType === "discount" ? -Math.abs(amt) : amt,
      gst_rate: gstR,
      gst_amount: Math.round(amt * gstR) / 100,
      created_by: user?.id ?? null,
    } as any);
    if (error) return toast.error(error.message);
    setAddOpen(false);
    setAddDesc(""); setAddQty("1"); setAddRate("0"); setAddGst("0"); setAddType("extra");
    const next = await refetchCharges();
    const prevTotal = Number(folio.total_amount);
    await persistTotals(next, payments);
    if (!isOpen) {
      toast.warning("Bill amount changed — payment records may need adjustment");
      logActivity({
        property_id: booking?.property_id ?? "",
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "BILL_EDITED",
        module: "Billing",
        reference_id: folio.id,
        reference_label: folio.invoice_number,
        details: {
          bill_number: folio.invoice_number,
          previous_amount: prevTotal,
          new_amount: recomputeFolio(next as any, (folio.gst_mode as "cash" | "gst")).total_amount,
          edited_by: userDisplayName(user as any),
          previous_status: folio.status,
        },
      });
    }
    load();
  }

  async function refetchCharges() {
    if (!folio) return charges;
    const { data } = await supabase.from("folio_charges").select("*").eq("folio_id", folio.id);
    return ((data ?? []) as unknown as Charge[]);
  }

  async function removeCharge(id: string) {
    if (!folio) return;
    if (!isOpen && !canEditAnyStatus) return toast.error("Only manager/owner can edit a settled bill");
    if (!confirm("Remove this charge?")) return;
    await supabase.from("folio_charges").delete().eq("id", id);
    const next = await refetchCharges();
    const prevTotal = Number(folio.total_amount);
    await persistTotals(next, payments);
    if (!isOpen) {
      toast.warning("Bill amount changed — payment records may need adjustment");
      logActivity({
        property_id: booking?.property_id ?? "",
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "BILL_EDITED",
        module: "Billing",
        reference_id: folio.id,
        reference_label: folio.invoice_number,
        details: {
          bill_number: folio.invoice_number,
          previous_amount: prevTotal,
          new_amount: recomputeFolio(next as any, (folio.gst_mode as "cash" | "gst")).total_amount,
          edited_by: userDisplayName(user as any),
          previous_status: folio.status,
        },
      });
    }
    load();
  }

  // ---------- DISCOUNT HANDLERS ----------
  const unlimitedDisc = () => hasRole(roles, "owner") || hasRole(roles, "superadmin");
  const capPctForRole = () => (unlimitedDisc() ? 100 : Math.max(0, Math.min(100, Number(maxDiscPct) || 0)));
  const round2 = (n: number) => Math.round(n * 100) / 100;

  function openBillDiscount() {
    if (!folio) return;
    setDiscTarget({ kind: "bill" });
    setDiscType((folio.discount_type as "percent" | "amount") ?? "percent");
    setDiscValue(String(folio.discount_value ?? ""));
    setDiscOpen(true);
  }
  function openLineDiscount(c: Charge) {
    setDiscTarget({ kind: "line", chargeId: c.id, base: Number(c.amount), description: c.description });
    setDiscType((c.discount_type as "percent" | "amount") ?? "percent");
    setDiscValue(String(c.discount_value ?? ""));
    setDiscOpen(true);
  }

  /** Convert (type,value,base) to a positive rupee amount, clamped to base. */
  function discountToRupees(type: "percent" | "amount", value: number, base: number): number {
    if (!value || value <= 0 || base <= 0) return 0;
    if (type === "percent") return Math.max(0, Math.min(100, value)) * base / 100;
    return Math.min(value, base);
  }
  /** Effective % of a base regardless of input type. */
  function effectivePct(type: "percent" | "amount", value: number, base: number): number {
    if (base <= 0 || !value || value <= 0) return 0;
    if (type === "percent") return Math.max(0, Math.min(100, value));
    return (value / base) * 100;
  }

  async function saveDiscount() {
    if (!folio || !booking) return;
    const val = Number(discValue);
    if (!Number.isFinite(val) || val < 0) return toast.error("Enter a valid discount");
    if (!isOpen && !canEditAnyStatus) return toast.error("Only manager/owner can edit a settled bill");

    const cap = capPctForRole();

    if (discTarget.kind === "bill") {
      // base = sum of non-discount lines minus their per-line discounts
      const base = charges.reduce((s, c) => {
        if (c.charge_type === "discount" || c.charge_type === "tax") return s;
        const amt = Math.abs(Number(c.amount) || 0);
        const ld = Math.min(Number(c.discount_amount) || 0, amt);
        return s + (amt - ld);
      }, 0);
      const pct = effectivePct(discType, val, base);
      if (val > 0 && pct > cap + 0.01 && !unlimitedDisc()) {
        return toast.error(`Max discount allowed for your role is ${cap}%`);
      }
      const rupees = discountToRupees(discType, val, base);
      const { error } = await supabase.from("folios").update({
        discount_type: val > 0 ? discType : null,
        discount_value: val > 0 ? val : 0,
      } as any).eq("id", folio.id);
      if (error) return toast.error(error.message);
      await persistTotals(charges, payments, {
        discount_type: val > 0 ? discType : undefined,
        discount_value: val > 0 ? val : 0,
      } as Partial<Folio>);
      logActivity({
        property_id: booking.property_id,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "DISCOUNT_APPLIED",
        module: "Billing",
        reference_id: folio.id,
        reference_label: folio.invoice_number,
        details: {
          bill_number: folio.invoice_number,
          level: "bill",
          discount_type: discType,
          discount_value: val,
          discount_amount: round2(rupees),
          applied_by: userDisplayName(user as any),
          role: roles.join(","),
        },
      });
      toast.success(val > 0 ? "Bill discount applied" : "Bill discount cleared");
    } else {
      const base = Math.abs(discTarget.base);
      const pct = effectivePct(discType, val, base);
      if (val > 0 && pct > cap + 0.01 && !unlimitedDisc()) {
        return toast.error(`Max discount allowed for your role is ${cap}%`);
      }
      const rupees = discountToRupees(discType, val, base);
      const { error } = await supabase.from("folio_charges").update({
        discount_type: val > 0 ? discType : null,
        discount_value: val > 0 ? val : 0,
        discount_amount: round2(rupees),
      } as any).eq("id", discTarget.chargeId);
      if (error) return toast.error(error.message);
      const next = await refetchCharges();
      await persistTotals(next, payments);
      logActivity({
        property_id: booking.property_id,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "DISCOUNT_APPLIED",
        module: "Billing",
        reference_id: folio.id,
        reference_label: folio.invoice_number,
        details: {
          bill_number: folio.invoice_number,
          level: "line_item",
          line_description: discTarget.description,
          discount_type: discType,
          discount_value: val,
          discount_amount: round2(rupees),
          applied_by: userDisplayName(user as any),
          role: roles.join(","),
        },
      });
      toast.success(val > 0 ? "Line discount applied" : "Line discount cleared");
    }
    setDiscOpen(false);
    setDiscValue("");
    load();
  }

  async function addPayment() {
    if (!folio || !booking) return;
    const amt = Number(payAmount);
    if (!amt || amt <= 0) return toast.error("Amount must be positive");
    const { error } = await supabase.from("payments").insert({
      property_id: booking.property_id,
      folio_id: folio.id,
      booking_id: booking.id,
      amount: amt,
      mode: payMode,
      reference_no: payRef || null,
      notes: payNote || null,
      created_by: user?.id ?? null,
    } as any);
    if (error) return toast.error(error.message);
    setPayOpen(false);
    setPayAmount(""); setPayRef(""); setPayNote(""); setPayMode("cash");
    const { data } = await supabase.from("payments").select("*").eq("folio_id", folio.id);
    const nextP = ((data ?? []) as unknown as Payment[]);
    await persistTotals(charges, nextP);
    toast.success("Payment recorded");
    logActivity({
      property_id: booking.property_id,
      user_id: user?.id ?? "",
      user_name: userDisplayName(user as any),
      ...ACTIVITY.PAYMENT_RECEIVED,
      reference_id: booking.id,
      reference_label: `${booking.booking_number} — ₹${amt} via ${payMode}`,
      details: { amount: amt, mode: payMode, folio_id: folio.id },
    });
    // WhatsApp payment receipt (best-effort)
    try {
      if (booking.guests?.mobile) {
        const { fireTrigger } = await import("@/lib/whatsapp");
        fireTrigger("payment_receipt", {
          property_id: booking.property_id,
          booking_id: booking.id,
          phone: booking.guests.mobile,
        });
      }
    } catch { /* ignore */ }
    load();
  }

  async function settle() {
    if (!folio) return;
    if (Number(folio.balance_amount) > 0.01) return toast.error("Balance not zero");
    if (pendingKots.length > 0 && !overrideApproved) {
      return toast.error("Resolve pending food orders before settling");
    }
    const now = new Date().toISOString();
    // 1. Settle folio
    const { error: fErr } = await supabase.from("folios").update({
      status: "settled", settled_at: now,
    }).eq("id", folio.id);
    if (fErr) return toast.error(fErr.message);

    if (booking) {
      // 2. Mark booking checked_out (if still active)
      if (booking.status !== "checked_out" && booking.status !== "cancelled") {
        await supabase.from("bookings").update({
          status: "checked_out",
          checked_out_at: now,
          checked_out_by: user?.id ?? null,
        } as any).eq("id", booking.id);
      }

      // 3. Stamp actual_check_out on every booking_room + free + mark room dirty
      for (const br of booking.booking_rooms) {
        await supabase.from("booking_rooms")
          .update({ actual_check_out: now } as any)
          .eq("id", br.id);
        const roomNumber = br.rooms?.room_number;
        if (roomNumber) {
          // Look up the room id via the join we already have? rooms in BookingCtx
          // only have room_number, so re-query by booking_rooms.id
        }
      }
      const { data: brs } = await supabase
        .from("booking_rooms")
        .select("room_id")
        .eq("booking_id", booking.id);
      const roomIds = (brs ?? []).map((x: any) => x.room_id).filter(Boolean) as string[];
      if (roomIds.length > 0) {
        await supabase.from("rooms").update({
          status: "vacant",
          housekeeping_status: "dirty",
        } as any).in("id", roomIds);
      }

      // 4. Best-effort WhatsApp receipt
      try {
        if (booking.guests?.mobile) {
          const { fireTrigger } = await import("@/lib/whatsapp");
          fireTrigger("checkout_bill", {
            property_id: booking.property_id,
            booking_id: booking.id,
            phone: booking.guests.mobile,
          });
        }
      } catch { /* ignore */ }
    }

    toast.success("Folio settled & guest checked out");
    if (booking) logActivity({
      property_id: booking.property_id,
      user_id: user?.id ?? "",
      user_name: userDisplayName(user as any),
      ...ACTIVITY.BILL_CREATED,
      reference_id: booking.id,
      reference_label: `${booking.booking_number} — ${booking.guests?.name ?? ""}`,
      details: { total: folio.total_amount, bill_type: folio.bill_type },
    });
    load();
  }

  async function voidFolio() {
    if (!folio) return;
    if (!voidReason.trim()) return toast.error("Reason required");
    await supabase.from("folios").update({
      status: "void", voided_at: new Date().toISOString(), void_reason: voidReason,
    }).eq("id", folio.id);
    setVoidOpen(false);
    toast.success("Folio voided");
    load();
  }

  async function printInvoice() {
    if (!folio || !booking || !property) return;
    const logoDataUrl = await resolveLogoUrl(property.logo_url);
    const html = renderInvoiceHtml({
      property: { ...property, logo_url: logoDataUrl },
      folio, booking, charges, payments, draft: false, logoDataUrl,
    });
    openInvoiceWindow(html);
  }

  async function printDraft() {
    if (!folio || !booking || !property) return;
    // Reuse the same on-screen Tax Invoice layout so Draft Bill stays
    // pixel-identical to the final invoice. Only the title and bill
    // number swap while draftMode is on.
    setDraftMode(true);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    try {
      await handleDownloadPDF();
    } finally {
      setTimeout(() => setDraftMode(false), 800);
    }
  }

  if (loading) return <AppShell title="Folio"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!folio || !booking) return <AppShell title="Folio"><p className="text-sm text-muted-foreground">Not found.</p></AppShell>;

  const isOpen = folio.status === "open";
  const pendingTotal = pendingKots.reduce((s, k) => s + Number(k.total_amount || 0), 0);
  const hasPending = pendingKots.length > 0;
  const canVoid = can("invoices", "delete");
  const canShiftMis = can("billing", "mis_shift");
  // Feature 2: any role granted invoices/edit may edit ANY bill regardless of status
  // (Owner + Manager by default). Previously this was mistakenly wired to invoices/delete,
  // which hid the edit UI on settled/paid bills whenever a role had edit but not delete.
  const canEditAnyStatus = can("invoices", "edit");
  const canEditNow = isOpen || canEditAnyStatus;

  async function markAllServed() {
    const ids = pendingKots.map((k) => k.id);
    if (ids.length === 0) return;
    const { error } = await supabase.from("kot_orders")
      .update({ status: "served" }).in("id", ids);
    if (error) return toast.error(error.message);
    toast.success(`Marked ${ids.length} KOT(s) as served`);
    load();
  }

  async function cancelPending() {
    if (!cancelReason.trim()) return toast.error("Reason required");
    const ids = pendingKots.map((k) => k.id);
    const { error } = await supabase.from("kot_orders")
      .update({ status: "cancelled", notes: `Cancelled at checkout: ${cancelReason}` })
      .in("id", ids);
    if (error) return toast.error(error.message);
    setCancelOpen(false); setCancelReason("");
    toast.success("Pending orders cancelled");
    load();
  }

  async function submitOverride() {
    if (!mgrEmail || !mgrPass) return toast.error("Manager email & password required");
    if (!mgrReason.trim()) return toast.error("Reason required");
    setMgrBusy(true);
    const res = await verifyManagerPassword(mgrEmail.trim(), mgrPass);
    setMgrBusy(false);
    if (!res.ok) return toast.error(res.reason ?? "Incorrect manager password");
    if (!folio || !booking) return;
    await supabase.from("checkout_overrides").insert({
      property_id: booking.property_id,
      booking_id: booking.id,
      folio_id: folio.id,
      requested_by: user?.id ?? null,
      approved_by: res.userId ?? null,
      approver_email: mgrEmail,
      reason: mgrReason,
      pending_kot_ids: pendingKots.map((k) => k.id),
      pending_amount: pendingTotal,
    } as any);
    setOverrideApproved(true);
    setOverrideOpen(false);
    setMgrEmail(""); setMgrPass(""); setMgrReason("");
    toast.success("Manager override approved — checkout unlocked");
  }

  const isGst = folio.gst_mode === "gst";
  const propAddrLine = [property?.address, property?.city, property?.state, property?.pincode]
    .filter(Boolean).join(", ");
  const nights = booking.booking_rooms.reduce((acc, br) => {
    const n = Math.max(1, Math.round(
      (new Date(br.check_out).getTime() - new Date(br.check_in).getTime()) / 86400000,
    ));
    return Math.max(acc, n);
  }, 1);

  // Group charges
  const groups: Record<string, Charge[]> = { room: [], food: [], sundry: [], extra: [], discount: [] };
  charges.forEach((c) => {
    const key = (groups as any)[c.charge_type] ? c.charge_type : "extra";
    (groups as any)[key].push(c);
  });
  const subtotalOf = (arr: Charge[]) => arr.reduce((s, c) => s + Number(c.amount), 0);
  const subRoom = subtotalOf(groups.room);
  const subFood = subtotalOf(groups.food);
  const subSundry = subtotalOf(groups.sundry);
  const subOther = subtotalOf(groups.extra) + subtotalOf(groups.discount);

  async function shareOnWhatsApp() {
    if (!folio || !booking) return;
    const phone = booking.guests?.mobile?.replace(/\D/g, "") ?? "";
    const lines = [
      `*${property?.name ?? "Hotel"}*`,
      `${isGst ? "Tax Invoice" : "Cash Bill"}: ${folio.invoice_number}`,
      `Guest: ${booking.guests?.name ?? "—"}`,
      `Stay: ${booking.check_in} → ${booking.check_out}`,
      ``,
      `Room charges: ${inr(subRoom)}`,
      subFood > 0 ? `Food & beverage: ${inr(subFood)}` : "",
      subSundry > 0 ? `Sundry: ${inr(subSundry)}` : "",
      isGst ? `GST: ${inr(folio.gst_amount)}` : "",
      `*Grand total: ${inrRound(folio.total_amount)}*`,
      `Paid: ${inr(folio.paid_amount)}`,
      `Balance: ${inrRound(folio.balance_amount)}`,
      ``,
      `Thank you for staying with us.`,
    ].filter(Boolean).join("\n");
    // Best-effort AiSensy fire-and-forget
    try {
      if (phone) {
        const { sendWhatsApp } = await import("@/lib/whatsapp");
        await sendWhatsApp({
          property_id: booking.property_id,
          phone,
          message: lines,
          template_key: "folio_share",
          booking_id: booking.id,
        } as any);
      }
    } catch { /* ignore — falls back to wa.me */ }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(lines)}`;
    window.open(url, "_blank");
  }

  async function handleVoidClick() {
    if (!canVoid) return toast.error("Only owner or manager can void");
    setVoidOpen(true);
  }

  async function handleCheckout() {
    if (!folio) return;
    if (hasPending && !overrideApproved) {
      return toast.error("Resolve pending food orders before checkout");
    }
    if (pendingPos.length > 0) {
      return toast.error(`Add ${pendingPos.length} pending POS charge(s) to bill before checkout`);
    }
    if (Number(folio.balance_amount) > 0.01) {
      return toast.error(`Collect ${inrRound(folio.balance_amount)} before checkout`);
    }
    setCheckoutOpen(true);
  }

  async function addPendingPosToBill(ids?: string[]) {
    if (!folio || !booking) return;
    const targets = ids && ids.length > 0
      ? pendingPos.filter((p) => ids.includes(p.id))
      : pendingPos;
    if (targets.length === 0) return;
    for (const pc of targets) {
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
      if (cErr) return toast.error(cErr.message);
      await supabase.from("pos_charges")
        .update({ status: "billed", folio_charge_id: (inserted as any).id, billed_at: new Date().toISOString() } as any)
        .eq("id", pc.id);
    }
    const next = await refetchCharges();
    await persistTotals(next, payments);
    toast.success(`${targets.length} POS charge(s) added to bill`);
    load();
  }

  async function handleDownloadPDF() {
    if (!folio || !booking) return;
    // Ensure totals reflect the current charges/discount BEFORE the print
    // capture runs — the capture reads DOM text, so stale folio state
    // would print as ₹0. Recompute in-memory, sync to DB in parallel,
    // apply to state, and wait for React to flush before printing.
    const mode = folio.gst_mode as "cash" | "gst";
    const billDisc = folio.discount_type && Number(folio.discount_value) > 0
      ? { type: folio.discount_type as "percent" | "amount", value: Number(folio.discount_value) }
      : null;
    const t = recomputeFolio(charges as any, mode, billDisc);
    const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
    const refreshedFolio = {
      ...folio,
      ...t,
      paid_amount: paid,
      balance_amount: Math.max(0, t.total_amount - paid),
    } as Folio;
    setFolio(refreshedFolio);
    void persistTotals(charges, payments);
    // Wait two frames so React commits the new folio state into the DOM.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    console.log("[bill-print] totals at capture time", {
      sub_total: refreshedFolio.sub_total,
      gst_amount: refreshedFolio.gst_amount,
      discount_amount: refreshedFolio.discount_amount,
      total_amount: refreshedFolio.total_amount,
      chargeCount: charges.length,
    });
    const prevTitle = document.title;
    const safeName = (booking.guests?.name ?? "guest").replace(/[^\w]+/g, "");
    document.title = `INV-${folio.invoice_number}-${safeName}`;
    const paperSize = await fetchPrinterPaperSize(booking.property_id, "bill");
    // Invoice/Bill uses the browser's native print dialog — QZ Tray's
    // HTML-to-pixel pipeline caused persistent A4 table cutoff issues.
    withPrintStyles(paperSize, () => window.print());
    setTimeout(() => { document.title = prevTitle; }, 500);
  }

  function openEmail() {
    if (!folio || !booking) return;
    const isGst = folio.gst_mode === "gst";
    setEmailTo("");
    setEmailSubject(`${isGst ? "Tax Invoice" : "Receipt"} from ${property?.name ?? "Hotel"} - ${folio.invoice_number}`);
    setEmailBody(
      `Dear ${booking.guests?.name ?? "Guest"},\n\n` +
      `Please find your ${isGst ? "tax invoice" : "receipt"} ${folio.invoice_number} for ` +
      `your stay from ${booking.check_in} to ${booking.check_out}.\n\n` +
      `Grand Total: ${inrRound(folio.total_amount)}\n` +
      `Paid: ${inr(folio.paid_amount)}\n` +
      `Balance: ${inrRound(folio.balance_amount)}\n\n` +
      `Thank you for staying with us.\n${property?.name ?? ""}`
    );
    setEmailOpen(true);
  }

  function sendEmail() {
    if (!emailTo.trim()) return toast.error("Recipient email required");
    const url = `mailto:${encodeURIComponent(emailTo)}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
    window.location.href = url;
    setEmailOpen(false);
    toast.success("Opening email client — please attach the downloaded PDF before sending");
  }

  const TEAL = (property as any)?.invoice_primary_color || "#1D9E75";
  // simple darken: drop hex by ~15%
  const darken = (hex: string, amt = 0.15) => {
    const h = hex.replace("#", "");
    if (h.length !== 6) return hex;
    const num = parseInt(h, 16);
    const r = Math.max(0, Math.floor(((num >> 16) & 0xff) * (1 - amt)));
    const g = Math.max(0, Math.floor(((num >> 8) & 0xff) * (1 - amt)));
    const b = Math.max(0, Math.floor((num & 0xff) * (1 - amt)));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  };
  const TEAL_DARK = darken(TEAL, 0.18);
  // Premium is the only template now.
  const isPremium = true;
  const isSettled = folio.status === "settled";
  const isVoid = folio.status === "void";

  return (
    <AppShell title={`Folio ${folio.invoice_number}`}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #invoice-print-area, #invoice-print-area * { visibility: visible !important; }
          #invoice-print-area {
            position: fixed !important; top: 0; left: 0;
            width: 100% !important; max-width: 100% !important;
            box-sizing: border-box !important;
            padding: 0 !important;
            background: white; box-shadow: none !important; border: none !important;
          }
          #invoice-print-area * { box-sizing: border-box !important; }
          #invoice-print-area .totals-box { width: 55% !important; max-width: 55% !important; margin-left: auto !important; }
          #invoice-print-area .totals-box table { width: 100% !important; table-layout: fixed !important; }
          #invoice-print-area .totals-box table td:first-child { width: 55% !important; }
          #invoice-print-area .totals-box table td:last-child { width: 45% !important; text-align: right !important; }
          #invoice-print-area .grand-total-row { width: 100% !important; box-sizing: border-box !important; }
          .no-print, [data-no-print], .sidebar, nav, header {
            display: none !important; visibility: hidden !important;
          }
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          @page { size: A4 portrait; margin: 10mm; }
        }
        /* Force hex colors inside the invoice — html2canvas (PDF export)
           cannot parse Tailwind v4 oklch() values. Keep this in sync. */
        #invoice-print-area { color: #111111; background-color: #ffffff; }
        #invoice-print-area * { border-color: #e5e7eb; }
        #invoice-print-area .bg-white { background-color: #ffffff !important; }
        #invoice-print-area .text-muted-foreground { color: #6b7280 !important; }
        #invoice-print-area .text-gray-400 { color: #9ca3af !important; }
        #invoice-print-area .text-gray-500 { color: #6b7280 !important; }
        #invoice-print-area .text-gray-600 { color: #4b5563 !important; }
        #invoice-print-area .text-gray-700 { color: #374151 !important; }
        #invoice-print-area .border-gray-400 { border-color: #9ca3af !important; }
        #invoice-print-area table { border-collapse: collapse; width: 100%; }
        #invoice-print-area th, #invoice-print-area td { padding: 8px 10px; font-size: 12px; }
        #invoice-print-area .zebra tr:nth-child(even) td { background: #F7FBF9; }
      `}</style>
      <div className="max-w-5xl space-y-4">
        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.history.back()}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Badge variant="outline" className={FOLIO_STATUS_TONE[folio.status]}>
            {folio.status.toUpperCase()}
          </Badge>
          {isSettled && (
            <Badge style={{ background: TEAL, color: "#fff" }} className="border-0">PAID</Badge>
          )}
          <div className="text-sm text-muted-foreground">
            Booking {booking.booking_number} · {booking.guests?.name ?? "—"}
          </div>
          <div className="ml-auto flex flex-wrap gap-2 no-print">
            <Button variant="outline" size="sm" onClick={printDraft}>
              <Printer className="h-4 w-4 mr-1" /> Print Draft
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadPDF}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownloadPDF}>
              <Download className="h-4 w-4 mr-1" /> Download PDF
            </Button>
            <Button variant="outline" size="sm" onClick={openEmail}>
              <Mail className="h-4 w-4 mr-1" /> Email
            </Button>
            <Button variant="outline" size="sm" onClick={shareOnWhatsApp}>
              <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp
            </Button>
          </div>
        </div>

        {isOpen && hasPending && (
          <Card className="border-destructive/60 bg-destructive/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                {pendingKots.length} food order(s) worth {inr(pendingTotal)} are pending
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="space-y-2">
                {pendingKots.map((k) => (
                  <div key={k.id} className="rounded border bg-background p-2">
                    <div className="flex justify-between font-medium">
                      <span>{k.kot_number} <span className="text-xs uppercase text-muted-foreground ml-1">({k.status})</span></span>
                      <span>{inr(k.total_amount)}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {(k.items ?? []).map((i) => `${i.qty}× ${i.item_name}`).join(", ") || "—"}
                    </div>
                  </div>
                ))}
              </div>
              {overrideApproved ? (
                <div className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-amber-900 text-xs">
                  <ShieldAlert className="inline h-3.5 w-3.5 mr-1" />
                  Manager override approved — you may proceed with checkout.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={markAllServed}>Mark All as Served</Button>
                  <Button size="sm" variant="outline" onClick={() => setCancelOpen(true)}>Cancel Pending Orders</Button>
                  <Button size="sm" variant="outline" className="border-amber-500 text-amber-700"
                    onClick={() => setOverrideOpen(true)}>
                    <ShieldAlert className="h-4 w-4 mr-1" /> Manager Override
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {isOpen && pendingPos.length > 0 && (
          <Card className="border-amber-400 bg-amber-50/60 no-print">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-5 w-5" />
                {pendingPos.length} POS charge(s) not yet added to bill
                {" · "}
                {Array.from(new Set(pendingPos.map((p) => p.category_name))).join(", ")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="space-y-2">
                {pendingPos.map((p) => (
                  <div key={p.id} className="rounded border bg-background p-2 flex items-center gap-2">
                    <div className="flex-1">
                      <div className="font-medium">
                        <Badge variant="outline" className="mr-1 text-[10px] uppercase">{p.category_name}</Badge>
                        {p.description}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p.qty} × {inr(p.rate)}
                        {p.gst_rate > 0 ? ` + ${p.gst_rate}% GST` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{inr(p.amount + p.gst_amount)}</div>
                    </div>
                    <Button size="sm" variant="outline"
                      onClick={() => addPendingPosToBill([p.id])}>
                      Add to Bill
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={() => addPendingPosToBill()}>
                  Add All to Bill
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bill Type controls (screen only) */}
        <Card className="print:hidden no-print">
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            {isOwnerStrict && (
              <div className="flex gap-2 rounded-md border p-1 bg-muted/30">
                <button type="button" disabled={!isOpen} onClick={() => toggleMode("gst")}
                  className={`rounded px-3 py-1.5 text-sm font-medium transition ${isGst ? "text-white shadow" : "hover:bg-background"}`}
                  style={isGst ? { background: TEAL } : undefined}>
                  GST Invoice
                </button>
                <button type="button" disabled={!isOpen} onClick={() => toggleMode("cash")}
                  className={`rounded px-3 py-1.5 text-sm font-medium transition ${!isGst ? "text-white shadow" : "hover:bg-background"}`}
                  style={!isGst ? { background: TEAL } : undefined}>
                  Cash Bill
                </button>
              </div>
            )}
            {isGst && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Guest GSTIN</Label>
                  <Input className="h-9 w-56" value={folio.guest_gstin ?? ""} disabled={!isOpen}
                    onChange={async (e) => {
                      setFolio({ ...folio, guest_gstin: e.target.value });
                      await supabase.from("folios").update({ guest_gstin: e.target.value }).eq("id", folio.id);
                    }} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Company Name</Label>
                  <Input className="h-9 w-64" value={folio.guest_company ?? ""} disabled={!isOpen}
                    onChange={async (e) => {
                      setFolio({ ...folio, guest_company: e.target.value });
                      await supabase.from("folios").update({ guest_company: e.target.value }).eq("id", folio.id);
                    }} />
                </div>
              </>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              {canEditNow && (
                <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Add charge
                </Button>
              )}
              {isOpen && (
                <Button size="sm" onClick={handleCheckout} style={{ background: TEAL, color: "#fff" }}>
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Checkout
                </Button>
              )}
              {isOpen && canVoid && (
                <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={handleVoidClick}>
                  <Ban className="h-4 w-4 mr-1" /> Void
                </Button>
              )}
              {isOpen && canShiftMis && (
                <Button size="sm" variant="outline" onClick={() => { setMisFoodOnly(false); setMisOpen(true); }}>
                  <ArrowRightLeft className="h-4 w-4 mr-1" /> Shift to MIS
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* INVOICE DOCUMENT */}
        <div id="invoice-print-area" className="relative mx-auto w-full bg-white shadow-md ring-1 ring-black/5 print:shadow-none print:ring-0">
          {isSettled && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div style={{
                transform: "rotate(-25deg)",
                border: `8px solid ${TEAL}`,
                color: TEAL,
                padding: "12px 48px",
                fontSize: "72px",
                fontWeight: 900,
                letterSpacing: "8px",
                opacity: 0.18,
                borderRadius: 12,
              }}>SETTLED</div>
            </div>
          )}
          {isVoid && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div style={{
                transform: "rotate(-25deg)",
                border: "8px solid #dc2626",
                color: "#dc2626",
                padding: "12px 64px",
                fontSize: "72px",
                fontWeight: 900,
                letterSpacing: "8px",
                opacity: 0.18,
                borderRadius: 12,
              }}>VOID</div>
            </div>
          )}

          {/* Header */}
          {isPremium ? (
            <>
              <div className="invoice-header-bg flex items-center justify-between gap-6 px-10 py-7"
                   style={{ background: TEAL, color: "#ffffff", borderRadius: 0 }}>
                <div className="flex items-center gap-4 min-w-0">
                  {property?.logo_url ? (
                    <div style={{ background: "#ffffff", padding: 8, borderRadius: 0 }}>
                      <img src={property.logo_url} alt="" style={{ height: 96, width: 96, objectFit: "contain", display: "block" }} />
                    </div>
                  ) : (
                    <div style={{ background: "#ffffff", color: TEAL_DARK, height: 112, width: 112, display: "grid", placeItems: "center", fontWeight: 900, fontSize: 34, letterSpacing: 2 }}>
                      {(property?.name ?? "HP").split(/\s+/).slice(0, 2).map(s => s[0]).join("").toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 0.3, color: "#ffffff", lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {property?.name ?? "Hotel"}
                    </div>
                    <div style={{ fontSize: 11, color: "#ffffff", opacity: 0.95, marginTop: 6, lineHeight: 1.6 }}>
                      {propAddrLine && <div>{propAddrLine}</div>}
                      {(property?.phone || property?.email) && (
                        <div style={{ marginTop: 2 }}>
                          {property?.phone ? `Ph: ${property.phone}` : ""}
                          {property?.phone && property?.email ? "  |  " : ""}
                          {property?.email ?? ""}
                        </div>
                      )}
                      {property?.gstin && <div style={{ marginTop: 2 }}>GSTIN: {property.gstin}</div>}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "right", color: "#ffffff" }}>
                  <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 2, lineHeight: 1 }}>
                    {draftMode ? "DRAFT BILL" : (isGst ? "TAX INVOICE" : "CASH BILL")}
                  </div>
                  <div style={{ fontSize: 13, marginTop: 8, fontWeight: 700 }}>Bill No: <span style={{ fontWeight: 700 }}>{draftMode ? "—" : folio.invoice_number}</span></div>
                  <div style={{ fontSize: 12 }}>Date: <b>{new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</b></div>
                  <div style={{ fontSize: 12 }}>Booking: <b>{booking.booking_number}</b></div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ background: TEAL, color: "#fff" }} className="flex items-center gap-5 px-8 py-6">
              {property?.logo_url ? (
                <img src={property.logo_url} alt="" className="h-20 w-20 rounded-md object-cover ring-2 ring-white/40" />
              ) : (
                <div className="grid h-20 w-20 shrink-0 place-items-center rounded-md bg-white/15 ring-2 ring-white/40">
                  <span className="text-2xl font-extrabold tracking-wider">
                    {(property?.name ?? "HP").split(/\s+/).slice(0, 2).map(s => s[0]).join("").toUpperCase()}
                  </span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h1 className="truncate text-3xl font-extrabold tracking-tight">{property?.name ?? "Hotel"}</h1>
                {propAddrLine && <div className="text-sm opacity-95">{propAddrLine}</div>}
                <div className="mt-1 flex flex-wrap gap-x-4 text-xs opacity-95">
                  {property?.phone && <span>Ph: {property.phone}</span>}
                  {property?.email && <span>Email: {property.email}</span>}
                  {property?.gstin && <span>GSTIN: {property.gstin}</span>}
                </div>
              </div>
            </div>
          )}

          {/* Title bar */}
          {!isPremium && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-y px-8 py-3" style={{ background: "#F0FAF6" }}>
            <div className="text-lg font-bold tracking-wide" style={{ color: TEAL_DARK }}>
              {draftMode ? "DRAFT BILL" : (isGst ? "TAX INVOICE" : "CASH BILL / RECEIPT")}
            </div>
            <div className="text-xs text-right">
              <div><span className="text-muted-foreground">Invoice No:</span> <span className="font-semibold">{draftMode ? "—" : folio.invoice_number}</span>{!draftMode && isSettled && <span className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ background: TEAL }}>PAID</span>}</div>
              <div><span className="text-muted-foreground">Date:</span> <span className="font-semibold">{new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
              <div><span className="text-muted-foreground">Booking:</span> <span className="font-semibold">{booking.booking_number}</span></div>
              {foodBillNumber && (
                <div><span className="text-muted-foreground">Food Bill Ref:</span> <span className="font-semibold">{foodBillNumber}</span></div>
              )}
            </div>
          </div>
          )}

          {/* Bill To + Stay */}
          <div className="grid grid-cols-1 gap-0 border-b sm:grid-cols-2">
            <div className="border-r px-8 py-4">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: TEAL_DARK }}>Bill To</div>
              <div className="text-base font-semibold">{booking.guests?.name ?? "—"}</div>
              {booking.guests?.mobile && <div className="text-xs text-gray-700">Mobile: {booking.guests.mobile}</div>}
              {(folio.guest_company || booking.guests?.company) && (
                <>
                  <div className="mt-3 mb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: TEAL_DARK }}>Company To</div>
                  <div className="text-sm font-semibold">{folio.guest_company || booking.guests?.company}</div>
                  {(folio.guest_gstin || booking.guests?.gst_number) && (
                    <div className="text-xs text-gray-700">GSTIN: {folio.guest_gstin || booking.guests?.gst_number}</div>
                  )}
                  {booking.guests?.address && (
                    <div className="text-xs text-gray-700">{booking.guests.address}</div>
                  )}
                </>
              )}
            </div>
            <div className="px-8 py-4">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: TEAL_DARK }}>Stay Details</div>
              {booking.booking_rooms[0] && (
                <>
                  <div className="text-xs">Room: <span className="font-semibold">{booking.booking_rooms[0].rooms?.room_number ?? "—"}</span></div>
                  <div className="text-xs">Category: <span className="font-semibold">{booking.booking_rooms[0].room_categories?.name ?? "—"}</span></div>
                </>
              )}
              <div className="text-xs">Check-in: <span className="font-semibold">{fmtDateTime(booking.booking_rooms[0]?.actual_check_in ?? booking.check_in, property?.default_checkin_time)}</span></div>
              <div className="text-xs">Check-out: <span className="font-semibold">{fmtDateTime(booking.booking_rooms[0]?.actual_check_out ?? booking.check_out, property?.default_checkout_time)}</span></div>
              <div className="text-xs">Duration: <span className="font-semibold">{nights} Night{nights > 1 ? "s" : ""}</span> · {booking.adults ?? 1} Adult{(booking.adults ?? 1) > 1 ? "s" : ""}{booking.children ? ` · ${booking.children} Child` : ""}</div>
            </div>
          </div>

          {/* Charges */}
          <div className="px-8 py-5">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: TEAL_DARK }}>Charges</div>
            <table data-print-table="charges" data-print-has-hsn={isGst ? "1" : "0"}>
              <thead>
                <tr style={{ background: TEAL, color: "#fff" }}>
                  <th style={{ textAlign: "left", width: 40 }}>#</th>
                  <th style={{ textAlign: "left" }}>Description</th>
                  {isGst && <th style={{ textAlign: "left", width: 80 }}>HSN</th>}
                  <th style={{ textAlign: "right", width: 50 }}>Qty</th>
                  <th style={{ textAlign: "right", width: 90 }}>Rate</th>
                  <th style={{ textAlign: "right", width: 110 }}>Amount</th>
                  {canEditNow && <th className="print:hidden" style={{ width: 40 }}></th>}
                </tr>
              </thead>
              <tbody className="zebra">
                {charges.length === 0 ? (
                  <tr><td colSpan={isGst ? 7 : 6} style={{ textAlign: "center", color: "#666", padding: 16 }}>No charges yet.</td></tr>
                ) : charges.map((c, i) => (
                  <tr key={c.id}>
                    <td>{i + 1}</td>
                    <td>
                      <div>{c.description}</div>
                      {isGst && <div style={{ fontSize: 10, color: "#666" }}>GST {Number(c.gst_rate)}%</div>}
                      {Number(c.discount_amount) > 0 && (
                        <div style={{ fontSize: 10, color: "#059669" }}>
                          Discount {c.discount_type === "percent" ? `${Number(c.discount_value)}%` : `₹${Number(c.discount_value)}`}
                          {" — "}-{inr(Number(c.discount_amount))}
                        </div>
                      )}
                    </td>
                    {isGst && (
                      <td style={{ fontSize: 11 }}>
                        {(c as any).hsn_code ?? (c.charge_type === "room" ? "996311" : c.charge_type === "food" ? "996331" : "9963")}
                      </td>
                    )}
                    <td style={{ textAlign: "right" }}>{Number(c.qty)}</td>
                    <td style={{ textAlign: "right" }}>{inr(c.rate)}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>
                      {Number(c.discount_amount) > 0 ? (
                        <>
                          <span style={{ textDecoration: "line-through", color: "#999", fontWeight: 400, marginRight: 6 }}>{inr(c.amount)}</span>
                          {inr(Number(c.amount) - Number(c.discount_amount))}
                        </>
                      ) : inr(c.amount)}
                    </td>
                    {canEditNow && (
                      <td className="print:hidden" style={{ textAlign: "right" }}>
                        <div className="flex items-center justify-end gap-1">
                          {c.charge_type !== "discount" && c.charge_type !== "tax" && (
                            <button
                              type="button"
                              onClick={() => openLineDiscount(c)}
                              className="text-emerald-700"
                              title="Apply line-item discount"
                            >
                              <Percent className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button onClick={() => removeCharge(c.id)} className="text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* GST breakup */}
            {isGst && Number(folio.gst_amount) > 0 && (
              <div className="mt-5">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: TEAL_DARK }}>GST Breakup</div>
                <table data-print-table="gst-breakup">
                  <thead>
                    <tr style={{ background: TEAL, color: "#fff" }}>
                      <th style={{ textAlign: "left" }}>Category</th>
                      <th style={{ textAlign: "right" }}>Taxable</th>
                      <th style={{ textAlign: "right" }}>CGST</th>
                      <th style={{ textAlign: "right" }}>SGST</th>
                      <th style={{ textAlign: "right" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody className="zebra">
                    {(["room", "food", "sundry", "extra"] as const).map((key) => {
                      const arr = (groups as any)[key] as Charge[];
                      const taxable = arr.reduce((s, c) => s + Number(c.amount), 0);
                      const gst = arr.reduce((s, c) => s + Number(c.gst_amount || 0), 0);
                      if (gst <= 0) return null;
                      const label = key === "room" ? "Accommodation" : key === "food" ? "Food & Beverage" : key === "sundry" ? "Sundry / POS" : "Others";
                      return (
                        <tr key={key}>
                          <td>{label}</td>
                          <td style={{ textAlign: "right" }}>{inr(taxable)}</td>
                          <td style={{ textAlign: "right" }}>{inr(gst / 2)}</td>
                          <td style={{ textAlign: "right" }}>{inr(gst / 2)}</td>
                          <td style={{ textAlign: "right", fontWeight: 600 }}>{inr(gst)}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: `2px solid ${TEAL}` }}>
                      <td colSpan={4} style={{ textAlign: "right", fontWeight: 700 }}>Total GST</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: TEAL_DARK }}>{inr(folio.gst_amount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Totals box */}
            <div className="mt-5 ml-auto totals-box" style={{ maxWidth: 360, width: "100%", boxSizing: "border-box" }}>
              <table style={{ width: "100%", tableLayout: "fixed" }}>
                <tbody>
                  <tr><td style={{ color: "#555" }}>Sub-total</td><td style={{ textAlign: "right" }}>{inr(folio.sub_total)}</td></tr>
                  {Number(folio.discount_amount) > 0 && (
                    <tr>
                      <td style={{ color: "#555" }}>
                        Discount
                        {folio.discount_type && Number(folio.discount_value) > 0 && (
                          <span style={{ color: "#888", marginLeft: 4 }}>
                            ({folio.discount_type === "percent" ? `${Number(folio.discount_value)}%` : `₹${Number(folio.discount_value)}`})
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>- {inr(folio.discount_amount)}</td>
                    </tr>
                  )}
                  {Number(folio.complimentary_food_used ?? 0) > 0 && (
                    <tr>
                      <td style={{ color: "#555" }}>Complimentary (MAP/AP)</td>
                      <td style={{ textAlign: "right" }}>- {inr(Number(folio.complimentary_food_used))}</td>
                    </tr>
                  )}
                  {isGst && <tr><td style={{ color: "#555" }}>GST</td><td style={{ textAlign: "right" }}>{inr(folio.gst_amount)}</td></tr>}
                  {Number(folio.round_off_amount ?? 0) !== 0 && (
                    <tr>
                      <td style={{ color: "#555" }}>Round Off</td>
                      <td style={{ textAlign: "right" }}>
                        {Number(folio.round_off_amount) >= 0 ? "+ " : "- "}
                        {inr(Math.abs(Number(folio.round_off_amount ?? 0)))}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {canEditNow && (
                <div className="print:hidden mt-2 flex justify-end">
                  <Button size="sm" variant="outline" onClick={openBillDiscount}>
                    <Percent className="h-3.5 w-3.5 mr-1" />
                    {Number(folio.discount_amount) > 0 ? "Edit bill discount" : "Apply bill discount"}
                  </Button>
                </div>
              )}
              <div style={{ background: TEAL, color: "#fff", boxSizing: "border-box", width: "100%" }} className="grand-total-row mt-2 flex items-center justify-between rounded px-4 py-3">
                <span className="text-sm font-bold uppercase tracking-wider">Grand Total</span>
                <span className="text-2xl font-extrabold tabular-nums">{inrRound(folio.total_amount)}</span>
              </div>
              {!isGst && (
                <div className="mt-1 text-right text-[10px] italic text-gray-500">Amount includes all applicable taxes</div>
              )}
            </div>

            {/* Payments */}
            <div className="mt-6">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider" style={{ color: TEAL_DARK }}>Payment Details</div>
              {payments.length === 0 ? (
                <div className="text-xs text-gray-500">No payments recorded.</div>
              ) : (
                <table>
                  <tbody className="zebra">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td style={{ textTransform: "capitalize" }}>{p.mode.replace(/_/g, " ")}</td>
                        <td style={{ fontSize: 11, color: "#666" }}>{new Date(p.paid_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                        <td style={{ fontSize: 11, color: "#666" }}>{p.reference_no ?? ""}</td>
                        <td style={{ textAlign: "right" }}>{inr(p.amount)}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: "2px solid #ddd" }}>
                      <td colSpan={3} style={{ fontWeight: 700 }}>Total Paid</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{inr(folio.paid_amount)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3} style={{ fontWeight: 700, color: Number(folio.balance_amount) > 0.01 ? "#dc2626" : TEAL_DARK }}>Balance Due</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: Number(folio.balance_amount) > 0.01 ? "#dc2626" : TEAL_DARK }}>{inrRound(folio.balance_amount)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer */}
            <div className="mt-8 border-t pt-4 text-center text-sm text-gray-700">
              Thank you for staying with us! We hope to see you again.
            </div>
            <div className="mt-10 flex justify-between gap-12 text-xs text-gray-600">
              <div className="flex-1 border-t border-gray-400 pt-1">Received by</div>
              <div className="flex-1 border-t border-gray-400 pt-1 text-right">Guest Signature</div>
            </div>
            <div className="mt-6 text-center text-[10px] text-gray-400">
              Powered by HotelPilot.in
            </div>
          </div>
          {isPremium && (
            <div style={{ background: "#f1f3f5", color: "#495057", fontSize: 11, padding: "8px 40px", textAlign: "center", borderTop: "1px solid #dee2e6" }}>
              {[property?.name, property?.email, (property as any)?.website, property?.phone].filter(Boolean).join("  |  ")}
            </div>
          )}
        </div>

        {/* Collect payment (screen only) */}
        {canEditNow && Number(folio.balance_amount) > 0.01 && (
          <Card className="print:hidden">
            <CardHeader className="pb-3"><CardTitle className="text-sm uppercase tracking-wider">Collect Payment</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">Amount</Label>
                <Input type="number" value={payAmount}
                  placeholder={String(folio.balance_amount)}
                  onFocus={() => { if (!payAmount) setPayAmount(String(folio.balance_amount)); }}
                  onChange={(e) => setPayAmount(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mode</Label>
                <Select value={payMode} onValueChange={setPayMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {payMethods.map((m) => <SelectItem key={m.id} value={m.name}>{formatPaymentMethodLabel(m.name)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reference</Label>
                <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Txn id, last 4, etc." />
              </div>
              <div className="flex items-end">
                <Button className="w-full" onClick={addPayment} style={{ background: TEAL, color: "#fff" }}>
                  <Plus className="h-4 w-4 mr-1" /> Add payment
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* EMAIL DIALOG */}
        <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Email invoice</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">To *</Label>
                <Input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="guest@example.com" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Subject</Label>
                <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Message</Label>
                <Textarea rows={6} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
              </div>
              <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                Download the PDF first, then attach it in your email client.
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEmailOpen(false)}>Cancel</Button>
              <Button onClick={sendEmail} style={{ background: TEAL, color: "#fff" }}>
                <Mail className="h-4 w-4 mr-1" /> Open email client
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* DISCOUNT (bill-level or line-item) */}
        <Dialog open={discOpen} onOpenChange={setDiscOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {discTarget.kind === "bill" ? "Apply bill-level discount" : "Apply line-item discount"}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {discTarget.kind === "line" && (
                <div className="rounded-md border bg-muted/30 p-2 text-xs">
                  <div className="font-medium">{discTarget.description}</div>
                  <div className="text-muted-foreground">Line amount: {inr(discTarget.base)}</div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Discount type</Label>
                  <Select value={discType} onValueChange={(v) => setDiscType(v as any)}>
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
                    type="number"
                    min="0"
                    step={discType === "percent" ? "0.01" : "1"}
                    value={discValue}
                    onChange={(e) => setDiscValue(e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>
              {!unlimitedDisc() && (
                <div className="text-xs text-muted-foreground">
                  Max discount allowed for your role: {capPctForRole()}%
                </div>
              )}
              {(() => {
                const val = Number(discValue) || 0;
                const base = discTarget.kind === "line"
                  ? Math.abs(discTarget.base)
                  : charges.reduce((s, c) => {
                      if (c.charge_type === "discount" || c.charge_type === "tax") return s;
                      const amt = Math.abs(Number(c.amount) || 0);
                      const ld = Math.min(Number(c.discount_amount) || 0, amt);
                      return s + (amt - ld);
                    }, 0);
                const rupees = discountToRupees(discType, val, base);
                if (rupees <= 0) return null;
                return (
                  <div className="rounded-md border bg-emerald-50 p-2 text-xs text-emerald-800">
                    Discount: -{inr(rupees)} on {inr(base)}
                  </div>
                );
              })()}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setDiscOpen(false); setDiscValue(""); }}>
                Cancel
              </Button>
              {((discTarget.kind === "bill" && Number(folio.discount_value) > 0) ||
                (discTarget.kind === "line" && Number(discValue) > 0)) && (
                <Button variant="ghost" onClick={() => { setDiscValue("0"); void saveDiscount(); }}>
                  Remove
                </Button>
              )}
              <Button onClick={saveDiscount}>Apply</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ADD CHARGE */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add charge</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={addType} onValueChange={(v) => setAddType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="extra">Extra charge</SelectItem>
                    <SelectItem value="discount">Discount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Description *</Label>
                <Input value={addDesc} onChange={(e) => setAddDesc(e.target.value)} placeholder="e.g. Laundry, Mini-bar, Festive discount" />
              </div>
              {addType === "discount" && !(hasRole(roles, "owner") || hasRole(roles, "superadmin")) && (
                <div className="text-xs text-muted-foreground">
                  Your role allows maximum {Math.max(0, Math.min(100, maxDiscPct))}% discount.
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Qty</Label>
                  <Input type="number" value={addQty} onChange={(e) => setAddQty(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Rate</Label>
                  <Input type="number" value={addRate} onChange={(e) => setAddRate(e.target.value)} />
                </div>
                {addType === "extra" && (
                  <div className="space-y-1">
                    <Label className="text-xs">GST %</Label>
                    <Input type="number" value={addGst} onChange={(e) => setAddGst(e.target.value)} />
                  </div>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={addCharge}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ADD PAYMENT */}
        <Dialog open={payOpen} onOpenChange={setPayOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Record payment</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Amount *</Label>
                <Input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0.00" />
                <div className="text-xs text-muted-foreground">Balance due: {inr(folio.balance_amount)}</div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mode</Label>
                <Select value={payMode} onValueChange={setPayMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {payMethods.map((m) => <SelectItem key={m.id} value={m.name}>{formatPaymentMethodLabel(m.name)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reference</Label>
                <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Txn id, last 4, etc." />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Textarea rows={2} value={payNote} onChange={(e) => setPayNote(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPayOpen(false)}>Cancel</Button>
              <Button onClick={addPayment}>Save payment</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* VOID */}
        <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Void folio</DialogTitle></DialogHeader>
            <div className="space-y-1">
              <Label className="text-xs">Reason *</Label>
              <Textarea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setVoidOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={voidFolio}>Void</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* CANCEL PENDING KOTs */}
        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Cancel pending food orders</DialogTitle></DialogHeader>
            <div className="space-y-1">
              <Label className="text-xs">Reason *</Label>
              <Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Guest declined / kitchen unable to fulfil / etc." />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button>
              <Button variant="destructive" onClick={cancelPending}>Cancel orders</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MANAGER OVERRIDE */}
        <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Manager override — unlock checkout</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                A manager / owner must approve checkout while {pendingKots.length} food order(s)
                worth {inr(pendingTotal)} remain unfulfilled. This override is logged.
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Manager email *</Label>
                <Input type="email" autoComplete="off" value={mgrEmail}
                  onChange={(e) => setMgrEmail(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Manager password *</Label>
                <Input type="password" autoComplete="off" value={mgrPass}
                  onChange={(e) => setMgrPass(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Reason *</Label>
                <Textarea rows={2} value={mgrReason}
                  onChange={(e) => setMgrReason(e.target.value)}
                  placeholder="Why is this checkout being overridden?" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOverrideOpen(false)}>Cancel</Button>
              <Button onClick={submitOverride} disabled={mgrBusy}>
                {mgrBusy ? "Verifying…" : "Approve override"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <CheckoutDialog
        bookingId={bookingId}
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        onDone={() => { load(); router.navigate({ to: "/front-desk/bookings" }); }}
      />
      <ShiftToMisDialog
        open={misOpen}
        onOpenChange={setMisOpen}
        folio={folio}
        booking={booking as any}
        charges={charges as any}
        preselectFoodOnly={misFoodOnly}
        onShifted={() => load()}
      />
    </AppShell>
  );
}

function Row({ k, v, bold, highlight }: { k: string; v: React.ReactNode; bold?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""} ${highlight ? "text-amber-700" : ""}`}>
      <span className={bold ? "" : "text-muted-foreground"}>{k}</span>
      <span>{v}</span>
    </div>
  );
}

function ChargeGroup({
  title, rows, subtotal, isOpen, onRemove, isGst,
}: {
  title: string;
  rows: Charge[];
  subtotal: number;
  isOpen: boolean;
  onRemove: (id: string) => void;
  isGst: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between border-b pb-1">
        <h4 className="text-xs font-bold uppercase tracking-wider text-foreground/80">{title}</h4>
      </div>
      <div className="divide-y">
        {rows.map((c) => (
          <div key={c.id} className="flex items-start gap-2 py-1.5 text-sm">
            <div className="flex-1 min-w-0">
              <div className="truncate">{c.description}</div>
              <div className="text-[11px] text-muted-foreground">
                {Number(c.qty)} × {inr(c.rate)}
                {isGst && c.charge_type !== "discount" ? ` · GST ${Number(c.gst_rate)}%` : ""}
              </div>
            </div>
            <div className={`w-28 text-right tabular-nums ${c.charge_type === "discount" ? "text-emerald-700" : ""}`}>
              {inr(c.amount)}
            </div>
            {isOpen && (
              <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive shrink-0" onClick={() => onRemove(c.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between border-t pt-1 text-sm font-semibold">
        <span className="text-muted-foreground">Subtotal</span>
        <span className="tabular-nums">{inr(subtotal)}</span>
      </div>
    </div>
  );
}