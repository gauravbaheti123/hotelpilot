import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
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
import { toast } from "sonner";
import {
  FOLIO_STATUS_TONE,
  PAYMENT_MODES,
  inr,
  recomputeFolio,
} from "@/lib/billing";
import { ArrowLeft, Plus, Printer, Trash2, CheckCircle2, Ban, Hotel, Download, Mail, MessageCircle } from "lucide-react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { verifyManagerPassword } from "@/lib/manager-verify";
import { CheckoutDialog } from "@/components/CheckoutDialog";

export const Route = createFileRoute("/_authenticated/billing/folio/$bookingId")({
  head: () => ({ meta: [{ title: "Folio — HotelPilot" }] }),
  component: FolioPage,
});

interface Charge {
  id: string; charge_type: string; description: string;
  qty: number; rate: number; amount: number;
  gst_rate: number; gst_amount: number; charged_on: string;
  source_table: string | null; source_id: string | null;
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
}
interface BookingCtx {
  id: string; booking_number: string; status: string;
  check_in: string; check_out: string; total_amount: number;
  property_id: string; adults: number | null; children: number | null;
  guests: {
    name: string; mobile: string | null; gst_number: string | null; company: string | null;
    id_proof_type: string | null; id_proof_number: string | null; nationality: string | null;
  } | null;
  booking_rooms: { id: string; rate: number; check_in: string; check_out: string; rooms: { room_number: string } | null; room_categories: { name: string } | null }[];
}
interface PropertyInfo {
  name: string; gst_number: string | null; address: string | null;
  city: string | null; state: string | null; pincode: string | null;
  phone: string | null; email: string | null; wa_number: string | null;
  logo_url: string | null;
}
interface PendingKot {
  id: string; kot_number: string; status: string;
  total_amount: number; sub_total: number;
  items: { id: string; item_name: string; qty: number; rate: number }[];
}

function FolioPage() {
  const { bookingId } = Route.useParams();
  const router = useRouter();
  const { user, roles } = useAuth();
  const [booking, setBooking] = useState<BookingCtx | null>(null);
  const [property, setProperty] = useState<PropertyInfo | null>(null);
  const [folio, setFolio] = useState<Folio | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

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

  // Pending KOT lock state
  const [pendingKots, setPendingKots] = useState<PendingKot[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [mgrEmail, setMgrEmail] = useState("");
  const [mgrPass, setMgrPass] = useState("");
  const [mgrReason, setMgrReason] = useState("");
  const [mgrBusy, setMgrBusy] = useState(false);
  const [overrideApproved, setOverrideApproved] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: b, error: be } = await supabase
      .from("bookings")
      .select(`id,booking_number,status,check_in,check_out,total_amount,property_id,adults,children,
        guests(name,mobile,gst_number,company,id_proof_type,id_proof_number,nationality),
        booking_rooms(id,rate,check_in,check_out,rooms(room_number),room_categories(name))`)
      .eq("id", bookingId).single();
    if (be) { toast.error(be.message); setLoading(false); return; }
    const bk = b as unknown as BookingCtx;
    setBooking(bk);

    const { data: prop } = await supabase.from("properties")
      .select("name,gst_number,address,city,state,pincode,phone,email,wa_number,logo_url")
      .eq("id", bk.property_id).single();
    setProperty((prop ?? null) as PropertyInfo | null);

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
    setCharges(((c ?? []) as unknown as Charge[]));
    setPayments(((p ?? []) as unknown as Payment[]));

    // Load pending KOTs (not served/billed/cancelled, not wiped)
    const { data: pk } = await supabase
      .from("kot_orders")
      .select("id,kot_number,status,total_amount,sub_total,kot_items(id,item_name,qty,rate)")
      .eq("booking_id", bookingId)
      .eq("is_wiped", false)
      .not("status", "in", "(served,billed,cancelled)");
    setPendingKots(((pk ?? []) as unknown as PendingKot[]));

    setLoading(false);
  }, [bookingId]);

  useEffect(() => { load(); }, [load]);

  // Auto-seed room charges if none present
  useEffect(() => {
    if (!folio || !booking || loading) return;
    if (charges.some((c) => c.charge_type === "room")) return;
    if (booking.booking_rooms.length === 0) return;
    (async () => {
      const rows = booking.booking_rooms.map((br) => {
        const nights = Math.max(1, Math.round(
          (new Date(br.check_out).getTime() - new Date(br.check_in).getTime()) / 86400000,
        ));
        const amt = nights * Number(br.rate);
        return {
          folio_id: folio.id,
          charge_type: "room",
          description: `Room ${br.rooms?.room_number ?? ""} · ${br.room_categories?.name ?? ""} · ${nights} night(s)`,
          qty: nights,
          rate: Number(br.rate),
          amount: amt,
          gst_rate: 12,
          gst_amount: Math.round(amt * 12) / 100,
          source_table: "booking_rooms",
          source_id: br.id,
          created_by: user?.id ?? null,
        };
      });
      await supabase.from("folio_charges").insert(rows as any);
      load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folio?.id, booking?.id, loading]);

  // Auto-pull served/billed food KOTs that haven't been added to the folio yet
  useEffect(() => {
    if (!folio || !booking || loading) return;
    if (folio.status !== "open") return;
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
      if (toAdd.length === 0) return;
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
      if (error) return;
      await supabase.from("kot_orders")
        .update({ status: "billed", billed_at: new Date().toISOString() })
        .in("id", toAdd.map((k: any) => k.id));
      load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folio?.id, booking?.id, loading, charges.length]);

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
    const t = recomputeFolio(nextCharges, mode);
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
    const bill_type = mode === "gst" ? "gst_invoice" : "cash_bill";
    await persistTotals(charges, payments, { gst_mode: mode, bill_type } as Partial<Folio>);
    toast.success(`Mode: ${mode === "gst" ? "GST tax invoice" : "Cash bill"}`);
    load();
  }

  async function addCharge() {
    if (!folio) return;
    if (!addDesc.trim()) return toast.error("Description required");
    const qty = Number(addQty) || 1;
    const rate = Number(addRate) || 0;
    const amt = qty * rate;
    const gstR = addType === "discount" ? 0 : Number(addGst) || 0;
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
    await persistTotals(next, payments);
    load();
  }

  async function refetchCharges() {
    if (!folio) return charges;
    const { data } = await supabase.from("folio_charges").select("*").eq("folio_id", folio.id);
    return ((data ?? []) as unknown as Charge[]);
  }

  async function removeCharge(id: string) {
    if (!folio) return;
    if (!confirm("Remove this charge?")) return;
    await supabase.from("folio_charges").delete().eq("id", id);
    const next = await refetchCharges();
    await persistTotals(next, payments);
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

  function printInvoice() {
    if (!folio || !booking) return;
    const esc = (s: unknown) => String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    const isGst = (folio.bill_type ?? folio.gst_mode) === "gst_invoice" || folio.gst_mode === "gst";
    const title = isGst ? "TAX INVOICE" : "RECEIPT";
    const receiptNo = isGst ? folio.invoice_number : `RCPT-${folio.invoice_number.replace(/^INV-/, "")}`;
    const html = `
      <html><head><title>${esc(folio.invoice_number)}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:12px;padding:24px;max-width:780px;margin:0 auto;color:#111}
        h1{font-size:18px;margin:0 0 4px;text-align:center;letter-spacing:1px}
        h2{font-size:14px;margin:0}
        table{width:100%;border-collapse:collapse;margin-top:8px}
        th,td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;font-size:11px}
        th{background:#f3f4f6}
        .right{text-align:right}
        .totals{margin-top:8px;width:50%;margin-left:auto}
        .totals td{border:none;padding:3px 8px}
        .totals .grand{font-weight:bold;font-size:13px;border-top:2px solid #111}
        .meta{display:flex;justify-content:space-between;margin:12px 0;gap:24px}
        .meta>div{flex:1}
        .small{font-size:10px;color:#555}
      </style></head><body>
      <h1>${title}</h1>
      <div style="text-align:center"><strong>${esc(property?.name ?? "")}</strong></div>
      <div class="small" style="text-align:center">${esc(property?.address ?? "")}${isGst && property?.gst_number ? ` · GSTIN: ${esc(property.gst_number)}` : ""}</div>
      <hr/>
      <div class="meta">
        <div>
          <div><strong>Guest:</strong> ${esc(booking.guests?.name ?? "")}</div>
          <div>${esc(booking.guests?.mobile ?? "")}</div>
          ${isGst && folio.guest_gstin ? `<div>GSTIN: ${esc(folio.guest_gstin)}</div>` : ""}
          ${isGst && folio.guest_company ? `<div>${esc(folio.guest_company)}</div>` : ""}
        </div>
        <div class="right">
          <div><strong>${isGst ? "Invoice" : "Receipt"}:</strong> ${esc(receiptNo)}</div>
          <div>Booking: ${esc(booking.booking_number)}</div>
          <div>Stay: ${esc(booking.check_in)} → ${esc(booking.check_out)}</div>
          <div>Date: ${new Date().toLocaleDateString()}</div>
        </div>
      </div>
      ${isGst ? `<table>
        <thead><tr>
          <th>Description</th><th>HSN/SAC</th><th class="right">Qty</th><th class="right">Rate</th>
          <th class="right">Amount</th><th class="right">CGST</th><th class="right">SGST</th>
        </tr></thead>
        <tbody>
          ${charges.map((c: any) => `<tr>
            <td>${esc(c.description)}</td>
            <td>${esc(c.hsn_code ?? (c.charge_type === "room" ? "996311" : c.charge_type === "food" ? "996331" : ""))}</td>
            <td class="right">${Number(c.qty).toLocaleString("en-IN")}</td>
            <td class="right">${inr(c.rate)}</td>
            <td class="right">${inr(c.amount)}</td>
            <td class="right">${(Number(c.gst_rate) / 2).toFixed(1)}% · ${inr(Number(c.gst_amount) / 2)}</td>
            <td class="right">${(Number(c.gst_rate) / 2).toFixed(1)}% · ${inr(Number(c.gst_amount) / 2)}</td>
          </tr>`).join("")}
        </tbody>
      </table>` : `<table>
        <thead><tr><th>Service description</th><th class="right">Amount</th></tr></thead>
        <tbody>
          ${charges.map((c) => `<tr>
            <td>${esc(c.description)}</td>
            <td class="right">${inr(Number(c.amount) + Number(c.gst_amount || 0))}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      <p class="small" style="margin-top:6px"><em>Amount includes all applicable taxes.</em></p>`}
      <table class="totals">
        ${isGst ? `<tr><td>Sub-total</td><td class="right">${inr(folio.sub_total)}</td></tr>` : ""}
        ${isGst && Number(folio.discount_amount) > 0 ? `<tr><td>Discount</td><td class="right">- ${inr(folio.discount_amount)}</td></tr>` : ""}
        ${isGst ? `<tr><td>CGST</td><td class="right">${inr(Number(folio.gst_amount) / 2)}</td></tr>` : ""}
        ${isGst ? `<tr><td>SGST</td><td class="right">${inr(Number(folio.gst_amount) / 2)}</td></tr>` : ""}
        <tr class="grand"><td>Total</td><td class="right">${inr(folio.total_amount)}</td></tr>
        <tr><td>Paid</td><td class="right">${inr(folio.paid_amount)}</td></tr>
        <tr><td>Balance</td><td class="right">${inr(folio.balance_amount)}</td></tr>
      </table>
      ${payments.length > 0 ? `<h2 style="margin-top:16px">Payments</h2>
        <table><thead><tr><th>Date</th><th>Mode</th><th>Ref</th><th class="right">Amount</th></tr></thead>
        <tbody>${payments.map((p) => `<tr>
          <td>${new Date(p.paid_at).toLocaleString()}</td>
          <td>${esc(p.mode.toUpperCase())}</td>
          <td>${esc(p.reference_no ?? "")}</td>
          <td class="right">${inr(p.amount)}</td>
        </tr>`).join("")}</tbody></table>` : ""}
      <p class="small" style="margin-top:24px;text-align:center">Thank you for staying with ${esc(property?.name ?? "us")}.</p>
      <div style="margin-top:48px;display:flex;justify-content:space-between;gap:48px">
        <div style="flex:1;border-top:1px solid #111;padding-top:4px;font-size:11px">Received by</div>
        <div style="flex:1;border-top:1px solid #111;padding-top:4px;font-size:11px;text-align:right">Guest signature</div>
      </div>
      </body></html>`;
    const w = window.open("", "_blank", "width=900,height=900");
    if (!w) return;
    w.document.write(html); w.document.close(); w.focus(); w.print();
  }

  if (loading) return <AppShell title="Folio"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!folio || !booking) return <AppShell title="Folio"><p className="text-sm text-muted-foreground">Not found.</p></AppShell>;

  const isOpen = folio.status === "open";
  const pendingTotal = pendingKots.reduce((s, k) => s + Number(k.total_amount || 0), 0);
  const hasPending = pendingKots.length > 0;
  const canVoid = hasRole(roles, "superadmin") || hasRole(roles, "owner") || hasRole(roles, "manager");

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
      `*Grand total: ${inr(folio.total_amount)}*`,
      `Paid: ${inr(folio.paid_amount)}`,
      `Balance: ${inr(folio.balance_amount)}`,
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
    if (Number(folio.balance_amount) > 0.01) {
      return toast.error(`Collect ${inr(folio.balance_amount)} before checkout`);
    }
    setCheckoutOpen(true);
  }

  return (
    <AppShell title={`Folio ${folio.invoice_number}`}>
      <div className="max-w-7xl space-y-4">
        {/* Top bar */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.history.back()}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Badge variant="outline" className={FOLIO_STATUS_TONE[folio.status]}>
            {folio.status.toUpperCase()}
          </Badge>
          <div className="text-sm text-muted-foreground">
            Booking {booking.booking_number} · {booking.guests?.name ?? "—"}
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

        <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
          {/* ============ LEFT: INVOICE ============ */}
          <Card className="overflow-hidden border-2 shadow-sm">
            {/* Hotel header */}
            <div className="border-b bg-gradient-to-br from-muted/40 to-background p-6">
              <div className="flex items-start gap-4">
                {property?.logo_url ? (
                  <img src={property.logo_url} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-border" />
                ) : (
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-border">
                    <Hotel className="h-7 w-7" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-2xl font-bold tracking-tight">{property?.name ?? "Hotel"}</h2>
                  {propAddrLine && <div className="text-xs text-muted-foreground">{propAddrLine}</div>}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                    {property?.phone && <span>Phone: {property.phone}</span>}
                    {property?.email && <span>Email: {property.email}</span>}
                    {property?.gst_number && <span className="font-medium text-foreground">GSTIN: {property.gst_number}</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Invoice title block */}
            <div className="flex flex-wrap items-end justify-between gap-3 border-b bg-background px-6 py-4">
              <div>
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                  {isGst ? "Tax Invoice" : "Cash Bill / Receipt"}
                </div>
                <div className="flex items-center gap-2 text-lg font-semibold">
                  {isGst ? <FileText className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
                  {folio.invoice_number}
                </div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div>Date: <span className="font-medium text-foreground">{new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
                <div>Booking: <span className="font-medium text-foreground">{booking.booking_number}</span></div>
              </div>
            </div>

            {/* Guest + Stay */}
            <div className="grid grid-cols-1 gap-4 border-b bg-muted/20 px-6 py-4 sm:grid-cols-2">
              <div className="space-y-0.5 text-sm">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Guest details</div>
                <div className="font-semibold">{booking.guests?.name ?? "—"}</div>
                {booking.booking_rooms[0] && (
                  <div className="text-xs text-muted-foreground">
                    Room {booking.booking_rooms[0].rooms?.room_number} · {booking.booking_rooms[0].room_categories?.name}
                  </div>
                )}
                {booking.guests?.mobile && <div className="text-xs">Mobile: {booking.guests.mobile}</div>}
                {booking.guests?.id_proof_type && (
                  <div className="text-xs">ID: {booking.guests.id_proof_type} {booking.guests?.id_proof_number ?? ""}</div>
                )}
                {isGst && folio.guest_gstin && <div className="text-xs">GSTIN: {folio.guest_gstin}</div>}
              </div>
              <div className="space-y-0.5 text-sm sm:text-right">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Stay</div>
                <div className="text-xs">Check-in: <span className="font-medium text-foreground">{new Date(booking.check_in).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
                <div className="text-xs">Check-out: <span className="font-medium text-foreground">{new Date(booking.check_out).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span></div>
                <div className="text-xs">{nights} night{nights > 1 ? "s" : ""} · {booking.adults ?? 1} adult{(booking.adults ?? 1) > 1 ? "s" : ""}{booking.children ? ` · ${booking.children} child` : ""}</div>
              </div>
            </div>

            {/* Charges breakdown */}
            <CardContent className="p-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Charges breakdown</h3>
                {isOpen && (
                  <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add charge
                  </Button>
                )}
              </div>

              {charges.length === 0 ? (
                <p className="text-sm text-muted-foreground">No charges yet.</p>
              ) : (
                <div className="space-y-4">
                  <ChargeGroup title="Room Charges" rows={groups.room} subtotal={subRoom} isOpen={isOpen} onRemove={removeCharge} isGst={isGst} />
                  {groups.food.length > 0 && (
                    <ChargeGroup title="Food & Beverage" rows={groups.food} subtotal={subFood} isOpen={isOpen} onRemove={removeCharge} isGst={isGst} />
                  )}
                  {groups.sundry.length > 0 && (
                    <ChargeGroup title="Sundry / POS" rows={groups.sundry} subtotal={subSundry} isOpen={isOpen} onRemove={removeCharge} isGst={isGst} />
                  )}
                  {(groups.extra.length + groups.discount.length) > 0 && (
                    <ChargeGroup title="Other Charges" rows={[...groups.extra, ...groups.discount]} subtotal={subOther} isOpen={isOpen} onRemove={removeCharge} isGst={isGst} />
                  )}
                </div>
              )}

              {/* GST breakup */}
              {isGst && Number(folio.gst_amount) > 0 && (
                <div className="mt-5 rounded-md border bg-muted/20 p-3">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">GST breakup</div>
                  <div className="grid grid-cols-2 gap-1 text-sm">
                    <span>CGST</span><span className="text-right">{inr(Number(folio.gst_amount) / 2)}</span>
                    <span>SGST</span><span className="text-right">{inr(Number(folio.gst_amount) / 2)}</span>
                    <span className="border-t pt-1 font-semibold">Total GST</span>
                    <span className="border-t pt-1 text-right font-semibold">{inr(folio.gst_amount)}</span>
                  </div>
                </div>
              )}

              {/* Grand total bar */}
              <div className="mt-5 flex items-center justify-between rounded-md bg-primary px-4 py-3 text-primary-foreground">
                <span className="text-sm font-semibold uppercase tracking-wider">Grand Total</span>
                <span className="text-xl font-bold tabular-nums">{inr(folio.total_amount)}</span>
              </div>
            </CardContent>
          </Card>

          {/* ============ RIGHT: ACTIONS ============ */}
          <div className="space-y-4">
            {/* Bill Type */}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm uppercase tracking-wider">Bill type</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 rounded-md border p-1 bg-muted/30">
                  <button type="button" disabled={!isOpen} onClick={() => toggleMode("gst")}
                    className={`flex flex-col items-start rounded px-3 py-2 text-left text-sm transition ${
                      isGst ? "bg-primary text-primary-foreground shadow" : "hover:bg-background"
                    }`}>
                    <span className="flex items-center gap-2 font-semibold">
                      <span className={`h-3 w-3 rounded-full border ${isGst ? "bg-primary-foreground border-primary-foreground" : "border-muted-foreground"}`} />
                      GST Invoice
                    </span>
                    <span className={`text-[10px] mt-0.5 ${isGst ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                      Tax invoice · HSN · CGST+SGST
                    </span>
                  </button>
                  <button type="button" disabled={!isOpen} onClick={() => toggleMode("cash")}
                    className={`flex flex-col items-start rounded px-3 py-2 text-left text-sm transition ${
                      !isGst ? "bg-primary text-primary-foreground shadow" : "hover:bg-background"
                    }`}>
                    <span className="flex items-center gap-2 font-semibold">
                      <span className={`h-3 w-3 rounded-full border ${!isGst ? "bg-primary-foreground border-primary-foreground" : "border-muted-foreground"}`} />
                      Cash Bill
                    </span>
                    <span className={`text-[10px] mt-0.5 ${!isGst ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                      Receipt · taxes included
                    </span>
                  </button>
                </div>
                {isGst && (
                  <div className="grid grid-cols-1 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Guest GSTIN</Label>
                      <Input value={folio.guest_gstin ?? ""} disabled={!isOpen}
                        onChange={async (e) => {
                          setFolio({ ...folio, guest_gstin: e.target.value });
                          await supabase.from("folios").update({ guest_gstin: e.target.value }).eq("id", folio.id);
                        }} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Company</Label>
                      <Input value={folio.guest_company ?? ""} disabled={!isOpen}
                        onChange={async (e) => {
                          setFolio({ ...folio, guest_company: e.target.value });
                          await supabase.from("folios").update({ guest_company: e.target.value }).eq("id", folio.id);
                        }} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Summary */}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm uppercase tracking-wider">Summary</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <Row k="Room charges" v={inr(subRoom)} />
                {subFood > 0 && <Row k="Food & beverage" v={inr(subFood)} />}
                {subSundry > 0 && <Row k="Sundry / POS" v={inr(subSundry)} />}
                {subOther !== 0 && <Row k="Other charges" v={inr(subOther)} />}
                {isGst && <Row k="GST" v={inr(folio.gst_amount)} />}
                <div className="mt-2 flex justify-between border-t pt-2 text-base font-bold">
                  <span>Grand Total</span><span className="tabular-nums">{inr(folio.total_amount)}</span>
                </div>
                <div className="mt-3 border-t pt-2">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Payments received</div>
                  {payments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No payments yet.</p>
                  ) : (
                    payments.map((p) => (
                      <div key={p.id} className="flex justify-between text-xs">
                        <span className="capitalize text-muted-foreground">{p.mode} · {new Date(p.paid_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                        <span className="tabular-nums">{inr(p.amount)}</span>
                      </div>
                    ))
                  )}
                  <div className="mt-1 flex justify-between text-sm font-medium">
                    <span>Total paid</span><span className="tabular-nums">{inr(folio.paid_amount)}</span>
                  </div>
                </div>
                <div className={`mt-2 flex items-center justify-between rounded-md px-3 py-2 text-base font-bold ${
                  Number(folio.balance_amount) > 0.01
                    ? "bg-destructive/10 text-destructive"
                    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                }`}>
                  <span>Balance Due</span><span className="tabular-nums">{inr(folio.balance_amount)}</span>
                </div>
              </CardContent>
            </Card>

            {/* Collect payment inline */}
            {isOpen && Number(folio.balance_amount) > 0.01 && (
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-sm uppercase tracking-wider">Collect payment</CardTitle></CardHeader>
                <CardContent className="space-y-2">
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
                        {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m.toUpperCase()}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Reference</Label>
                    <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Txn id, last 4, etc." />
                  </div>
                  <Button className="w-full" onClick={addPayment}>
                    <Plus className="h-4 w-4 mr-1" /> Add payment
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Actions */}
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm uppercase tracking-wider">Actions</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-2">
                <Button variant="outline" onClick={printInvoice}>
                  <Printer className="h-4 w-4 mr-2" /> Print bill
                </Button>
                <Button variant="outline" onClick={shareOnWhatsApp}>
                  <Send className="h-4 w-4 mr-2" /> Share on WhatsApp
                </Button>
                {isOpen && (
                  <Button onClick={handleCheckout}>
                    <CheckCircle2 className="h-4 w-4 mr-2" /> Checkout
                  </Button>
                )}
                {isOpen && canVoid && (
                  <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10" onClick={handleVoidClick}>
                    <Ban className="h-4 w-4 mr-2" /> Void folio
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

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
                    {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m.toUpperCase()}</SelectItem>)}
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