import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/BackButton";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Printer, Download, MessageCircle, Plus, Trash2, Percent } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth, hasRole } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  inr,
  inrRound,
  roundHalfUp,
  computeBillDiscountAmount,
  type BillDiscount,
} from "@/lib/billing";
import { resolveTaxType } from "@/lib/gst";
import { DiscountDialog, type DiscType } from "@/components/DiscountDialog";
import { useDiscountLimit } from "@/hooks/use-discount-limit";
import { fmtDate } from "@/lib/reportExports";
import { fetchPrinterPaperSize, withPrintStyles } from "@/lib/printStyles";
import { resolveLogoUrl } from "@/lib/invoiceTemplates";
import { usePaymentMethods, formatPaymentMethodLabel } from "@/hooks/use-payment-methods";
import {
  loadEventBooking, patchEventBooking, loadEventPayments, recordEventPayments,
  type EventIds,
} from "@/lib/banquetEvent";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/banquet/bill/$id")({
  head: () => ({ meta: [{ title: "Event Bill — HotelPilot" }] }),
  component: () => (
    <RequirePermission module="banquet">
      <BanquetBillPage />
    </RequirePermission>
  ),
});

interface Bq {
  id: string;
  booking_id: string;
  property_id: string;
  banquet_number: string;
  function_type: string;
  event_date: string;
  start_time: string;
  end_time: string;
  pax: number;
  package_rate: number;
  hall_charge: number;
  fb_charge: number;
  extra_charge: number;
  discount_amount: number;
  total_amount: number;
  advance_amount: number;
  balance_amount: number;
  status: string;
  notes: string | null;
  event_name: string | null;
  bill_type: string;
  discount_type?: DiscType | null;
  discount_value?: number | null;
  line_discounts?: Record<string, { type: DiscType; value: number; amount: number }> | null;
  halls: { name: string } | null;
  guests: {
    name: string;
    mobile: string | null;
    email: string | null;
    gst_number: string | null;
    company: string | null;
  } | null;
  host_name?: string | null;
  host_mobile?: string | null;
  host_email?: string | null;
}
interface Bulk {
  id: string;
  rate: number;
  nights: number;
  check_in: string;
  check_out: string;
  rooms: { room_number: string } | null;
  room_categories: { name: string } | null;
  discount_type?: DiscType | null;
  discount_value?: number | null;
  discount_amount?: number | null;
}
interface ExtraCharge {
  id: string;
  point_name: string;
  amount: number;
  discount_type: DiscType | null;
  discount_value: number | null;
  discount_amount: number | null;
}
interface PropertyInfo {
  name: string;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  wa_number: string | null;
  logo_url: string | null;
}

const TEAL = "#1D9E75";

interface EventPayment {
  id: string;
  amount: number;
  payment_mode: string;
  reference: string | null;
  paid_at: string;
  notes: string | null;
}

function BanquetBillPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { user, roles } = useAuth();
  const { can } = usePermissions();
  const [b, setB] = useState<Bq | null>(null);
  // Unified model: header is read from the bookings row; `b.id` stays the
  // legacy id so extras / bulk rooms / event payments keep resolving.
  const [ids, setIds] = useState<EventIds | null>(null);
  const [bulk, setBulk] = useState<Bulk[]>([]);
  const [extras, setExtras] = useState<ExtraCharge[]>([]);
  const [property, setProperty] = useState<PropertyInfo | null>(null);
  const [billType, setBillType] = useState<"gst_invoice" | "cash_bill">("gst_invoice");
  const [loading, setLoading] = useState(true);
  const [pays, setPays] = useState<EventPayment[]>([]);
  // payment-collection state
  const [payMode, setPayMode] = useState("cash");
  const [payAmt, setPayAmt] = useState("");
  const [payRef, setPayRef] = useState("");
  const [splitOn, setSplitOn] = useState(false);
  const [splitRows, setSplitRows] = useState<
    Array<{ mode: string; amount: string; reference: string }>
  >([
    { mode: "cash", amount: "", reference: "" },
    { mode: "upi", amount: "", reference: "" },
  ]);
  const [maxDiscPct, setMaxDiscPct] = useState<number>(100);
  const { limit: discountLimit } = useDiscountLimit();
  const { methods: payMethods } = usePaymentMethods(b?.property_id ?? null);
  const [discOpen, setDiscOpen] = useState(false);
  const [discTarget, setDiscTarget] = useState<
    | { kind: "bill" }
    | { kind: "line"; lineKey: string; base: number; description: string }
    | { kind: "room"; rowId: string; base: number; description: string }
    | { kind: "extra"; rowId: string; base: number; description: string }
  >({ kind: "bill" });

  const load = useCallback(async () => {
    setLoading(true);
    let bq: Bq;
    try {
      const ev = await loadEventBooking(id);
      if (!ev) {
        setLoading(false);
        return;
      }
      setIds({ bookingId: ev.booking_id, legacyId: ev.legacy_id });
      bq = ev as unknown as Bq;
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load event");
      setLoading(false);
      return;
    }
    setB(bq);
    setBillType((bq.bill_type as "gst_invoice" | "cash_bill") ?? "gst_invoice"); // historical only; no UI toggle

    const [{ data: p }] = await Promise.all([
      supabase
        .from("properties")
        .select("name,gstin,state_code,address,city,state,pincode,phone,email,wa_number,logo_url")
        .eq("id", bq.property_id)
        .single(),
    ]);
    // Bulk room rows were retired in Part 5 — event rooms live on
    // event_room_blocks / booking_rooms in the unified model.
    setBulk([]);
    setProperty((p ?? null) as PropertyInfo | null);
    if ((p as any)?.logo_url) {
      resolveLogoUrl((p as any).logo_url).then((url) => {
        if (url) setProperty((cur) => (cur ? { ...cur, logo_url: url } : cur));
      });
    }
    const { data: ex } = await supabase
      .from("banquet_extra_charges")
      .select("id,point_name,amount,discount_type,discount_value,discount_amount")
      .eq("banquet_booking_id", bq.id)
      .order("sort_order", { ascending: true });
    setExtras((ex ?? []) as unknown as ExtraCharge[]);
    try {
      setPays((await loadEventPayments(bq.booking_id)) as unknown as EventPayment[]);
    } catch {
      setPays([]);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Resolve current user's max-discount % for this property.
  useEffect(() => {
    (async () => {
      if (!user?.id || !b?.property_id) return;
      const { data: pct } = await supabase.rpc("user_max_discount_pct", {
        _user_id: user.id,
        _property_id: b.property_id,
      });
      const n = Number(pct);
      setMaxDiscPct(Number.isFinite(n) ? n : 0);
    })();
  }, [user?.id, b?.property_id]);

  if (loading)
    return (
      <AppShell title="Event Bill">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </AppShell>
    );
  if (!b)
    return (
      <AppShell title="Event Bill">
        <p className="text-sm text-muted-foreground">Not found.</p>
      </AppShell>
    );

  const isGst = billType === "gst_invoice";
  const packageAmount = Number(b.package_rate || 0) * Number(b.pax || 0);
  // Line-item base amounts
  const lineBase: Record<string, number> = {
    hall: Number(b.hall_charge || 0),
    package: packageAmount,
    fb: Number(b.fb_charge || 0),
    extra: Number(b.extra_charge || 0),
  };
  const lineDiscMap = (b.line_discounts ?? {}) as Record<
    string,
    { type: DiscType; value: number; amount: number }
  >;
  const lineDiscAmt = (key: string) => {
    const base = lineBase[key] ?? 0;
    const raw = Number(lineDiscMap?.[key]?.amount ?? 0);
    return Math.max(0, Math.min(raw, base));
  };
  const roomDiscAmt = (r: Bulk) => {
    const base = Number(r.rate || 0) * Number(r.nights || 0);
    const raw = Number(r.discount_amount ?? 0);
    return Math.max(0, Math.min(raw, base));
  };
  const roomSubtotalGross = bulk.reduce(
    (s, r) => s + Number(r.rate || 0) * Number(r.nights || 0),
    0,
  );
  const roomLineDiscTotal = bulk.reduce((s, r) => s + roomDiscAmt(r), 0);
  const extraDiscAmt = (e: ExtraCharge) => {
    const base = Number(e.amount || 0);
    const raw = Number(e.discount_amount ?? 0);
    return Math.max(0, Math.min(raw, base));
  };
  const extrasSubtotalGross = extras.reduce((s, e) => s + Number(e.amount || 0), 0);
  const extrasLineDiscTotal = extras.reduce((s, e) => s + extraDiscAmt(e), 0);
  const subtotal =
    lineBase.hall +
    lineBase.package +
    lineBase.fb +
    lineBase.extra +
    roomSubtotalGross +
    extrasSubtotalGross;
  const fixedLineDiscTotal =
    lineDiscAmt("hall") + lineDiscAmt("package") + lineDiscAmt("fb") + lineDiscAmt("extra");
  const totalLineDisc = fixedLineDiscTotal + roomLineDiscTotal + extrasLineDiscTotal;
  const netSubtotal = Math.max(0, subtotal - totalLineDisc);
  const billDisc: BillDiscount | null =
    b.discount_type && Number(b.discount_value) > 0
      ? { type: b.discount_type, value: Number(b.discount_value) }
      : null;
  const billDiscAmt = computeBillDiscountAmount(netSubtotal, billDisc);
  const discount = Math.round((totalLineDisc + billDiscAmt) * 100) / 100;
  const taxable = Math.max(0, netSubtotal - billDiscAmt);
  const gstRate = 0.05;
  const gstTotal = isGst ? Math.round(taxable * gstRate * 100) / 100 : 0;
  const { taxType: banquetTaxType } = resolveTaxType(
    {
      gstin: (b.guests as { gst_number?: string | null } | null)?.gst_number ?? null,
      stateCode: (b.guests as { state_code?: string | null } | null)?.state_code ?? null,
      state: (b.guests as { state?: string | null } | null)?.state ?? null,
    },
    {
      gstin: (property as { gstin?: string | null } | null)?.gstin ?? null,
      stateCode: (property as { state_code?: string | null } | null)?.state_code ?? null,
      state: (property as { state?: string | null } | null)?.state ?? null,
    },
  );
  const isIgstBill = banquetTaxType === "igst";
  const igst = isIgstBill ? gstTotal : 0;
  const cgst = isIgstBill ? 0 : Math.round((gstTotal / 2) * 100) / 100;
  const sgst = cgst;
  const totalRaw = Math.round((taxable + gstTotal) * 100) / 100;
  const total = roundHalfUp(totalRaw);
  const roundOff = Math.round((total - totalRaw) * 100) / 100;
  const advance = Number(b.advance_amount || 0);
  const paidViaEventPayments = pays.reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalPaid = advance + paidViaEventPayments;
  const balance = Math.max(0, total - totalPaid);
  const isSettled = balance < 0.01;

  // ---------- DISCOUNT HANDLERS ----------
  const unlimitedDisc = () => hasRole(roles, "owner") || hasRole(roles, "superadmin");
  const round2 = (n: number) => Math.round(n * 100) / 100;

  function openBillDiscount() {
    setDiscTarget({ kind: "bill" });
    setDiscOpen(true);
  }
  function openLineDiscount(lineKey: string, base: number, description: string) {
    if (base <= 0) return;
    setDiscTarget({ kind: "line", lineKey, base, description });
    setDiscOpen(true);
  }
  function openRoomDiscount(rowId: string, base: number, description: string) {
    if (base <= 0) return;
    setDiscTarget({ kind: "room", rowId, base, description });
    setDiscOpen(true);
  }
  function openExtraDiscount(rowId: string, base: number, description: string) {
    if (base <= 0) return;
    setDiscTarget({ kind: "extra", rowId, base, description });
    setDiscOpen(true);
  }

  async function persistBanquetDiscount(patch: Partial<Bq>) {
    if (!b) return { error: null as any };
    // Recompute total_amount and balance based on new state
    const nextLineDiscMap = (patch.line_discounts ?? b.line_discounts ?? {}) as Record<
      string,
      { type: DiscType; value: number; amount: number }
    >;
    const nextDiscType = (patch.discount_type as DiscType | undefined) ?? b.discount_type ?? null;
    const nextDiscValue =
      patch.discount_value !== undefined
        ? Number(patch.discount_value)
        : Number(b.discount_value ?? 0);
    const nextFixedLineDisc =
      Math.min(Number(nextLineDiscMap?.hall?.amount ?? 0), lineBase.hall) +
      Math.min(Number(nextLineDiscMap?.package?.amount ?? 0), lineBase.package) +
      Math.min(Number(nextLineDiscMap?.fb?.amount ?? 0), lineBase.fb) +
      Math.min(Number(nextLineDiscMap?.extra?.amount ?? 0), lineBase.extra);
    const nextNetSubtotal = Math.max(0, subtotal - nextFixedLineDisc - roomLineDiscTotal);
    const nextBillDisc: BillDiscount | null =
      nextDiscType && nextDiscValue > 0 ? { type: nextDiscType, value: nextDiscValue } : null;
    const nextBillDiscAmt = computeBillDiscountAmount(nextNetSubtotal, nextBillDisc);
    const nextTaxable = Math.max(0, nextNetSubtotal - nextBillDiscAmt);
    const nextGst = isGst ? round2(nextTaxable * gstRate) : 0;
    const nextTotalRaw = round2(nextTaxable + nextGst);
    const nextTotal = roundHalfUp(nextTotalRaw);
    const nextRoundOff = round2(nextTotal - nextTotalRaw);
    const nextDiscountAmount = round2(nextFixedLineDisc + roomLineDiscTotal + nextBillDiscAmt);
    const nextBalance = Math.max(0, round2(nextTotal - totalPaid));
    if (!ids) return { error: null as any };
    try {
      await patchEventBooking(ids, {
        ...patch,
        discount_amount: nextDiscountAmount,
        total_amount: nextTotal,
        round_off_amount: nextRoundOff,
        balance_amount: nextBalance,
      } as any);
      return { error: null as any };
    } catch (e: any) {
      return { error: e };
    }
  }

  async function saveDiscount({
    type,
    value,
    rupees,
  }: {
    type: DiscType;
    value: number;
    rupees: number;
  }) {
    if (!b || !user) return;
    if (discTarget.kind === "bill") {
      const patch: Partial<Bq> = {
        discount_type: value > 0 ? type : null,
        discount_value: value > 0 ? value : 0,
      };
      const { error } = await persistBanquetDiscount(patch);
      if (error) {
        toast.error(error.message);
        return;
      }
      logActivity({
        property_id: b.property_id,
        user_id: user.id,
        user_name: userDisplayName(user as any),
        action_type: "DISCOUNT_APPLIED",
        module: "Banquet",
        reference_id: b.id,
        reference_label: b.banquet_number,
        details: {
          bill_number: b.banquet_number,
          level: "bill",
          discount_type: type,
          discount_value: value,
          discount_amount: rupees,
          applied_by: userDisplayName(user as any),
          role: roles.join(","),
        },
      });
      toast.success(value > 0 ? "Bill discount applied" : "Bill discount cleared");
    } else if (discTarget.kind === "line") {
      const nextMap = { ...(b.line_discounts ?? {}) } as Record<
        string,
        { type: DiscType; value: number; amount: number }
      >;
      if (value > 0) nextMap[discTarget.lineKey] = { type, value, amount: rupees };
      else delete nextMap[discTarget.lineKey];
      const { error } = await persistBanquetDiscount({ line_discounts: nextMap });
      if (error) {
        toast.error(error.message);
        return;
      }
      logActivity({
        property_id: b.property_id,
        user_id: user.id,
        user_name: userDisplayName(user as any),
        action_type: "DISCOUNT_APPLIED",
        module: "Banquet",
        reference_id: b.id,
        reference_label: b.banquet_number,
        details: {
          bill_number: b.banquet_number,
          level: "line_item",
          line_description: discTarget.description,
          discount_type: type,
          discount_value: value,
          discount_amount: rupees,
          applied_by: userDisplayName(user as any),
          role: roles.join(","),
        },
      });
      toast.success(value > 0 ? "Line discount applied" : "Line discount cleared");
    } else if (discTarget.kind === "room") {
      // Room lines now come from the unified model; per-room bulk discounts
      // were retired with banquet_bulk_rooms in Part 5.
      // Recompute total on the event booking to keep in sync
      // Refresh room list first, then persist totals (uses in-scope roomLineDiscTotal only after reload)
      await persistBanquetDiscount({});
      logActivity({
        property_id: b.property_id,
        user_id: user.id,
        user_name: userDisplayName(user as any),
        action_type: "DISCOUNT_APPLIED",
        module: "Banquet",
        reference_id: b.id,
        reference_label: b.banquet_number,
        details: {
          bill_number: b.banquet_number,
          level: "line_item",
          line_description: discTarget.description,
          discount_type: type,
          discount_value: value,
          discount_amount: rupees,
          applied_by: userDisplayName(user as any),
          role: roles.join(","),
        },
      });
      toast.success(value > 0 ? "Line discount applied" : "Line discount cleared");
    } else if (discTarget.kind === "extra") {
      const { error: eerr } = await supabase
        .from("banquet_extra_charges")
        .update({
          discount_type: value > 0 ? type : null,
          discount_value: value > 0 ? value : 0,
          discount_amount: value > 0 ? rupees : 0,
        } as any)
        .eq("id", discTarget.rowId);
      if (eerr) {
        toast.error(eerr.message);
        return;
      }
      await persistBanquetDiscount({});
      logActivity({
        property_id: b.property_id,
        user_id: user.id,
        user_name: userDisplayName(user as any),
        action_type: "DISCOUNT_APPLIED",
        module: "Banquet",
        reference_id: b.id,
        reference_label: b.banquet_number,
        details: {
          bill_number: b.banquet_number,
          level: "line_item",
          line_description: discTarget.description,
          discount_type: type,
          discount_value: value,
          discount_amount: rupees,
          applied_by: userDisplayName(user as any),
          role: roles.join(","),
        },
      });
      toast.success(value > 0 ? "Line discount applied" : "Line discount cleared");
    }
    load();
  }

  const discBase =
    discTarget.kind === "bill"
      ? netSubtotal
      : discTarget.kind === "line"
        ? discTarget.base
        : discTarget.kind === "room"
          ? discTarget.base
          : discTarget.kind === "extra"
            ? discTarget.base
            : 0;
  const discInitial: { type: DiscType; value: number } = (() => {
    if (discTarget.kind === "bill") {
      return {
        type: (b.discount_type as DiscType) ?? "percent",
        value: Number(b.discount_value ?? 0),
      };
    }
    if (discTarget.kind === "line") {
      const d = lineDiscMap?.[discTarget.lineKey];
      return { type: (d?.type as DiscType) ?? "percent", value: Number(d?.value ?? 0) };
    }
    if (discTarget.kind === "room") {
      const r = bulk.find((x) => x.id === discTarget.rowId);
      return {
        type: (r?.discount_type as DiscType) ?? "percent",
        value: Number(r?.discount_value ?? 0),
      };
    }
    if (discTarget.kind === "extra") {
      const e = extras.find((x) => x.id === discTarget.rowId);
      return {
        type: (e?.discount_type as DiscType) ?? "percent",
        value: Number(e?.discount_value ?? 0),
      };
    }
    return { type: "percent", value: 0 };
  })();
  const discHasExisting =
    (discTarget.kind === "bill" && Number(b.discount_value ?? 0) > 0) ||
    (discTarget.kind === "line" && Number(lineDiscMap?.[discTarget.lineKey]?.value ?? 0) > 0) ||
    (discTarget.kind === "room" &&
      Number(bulk.find((x) => x.id === discTarget.rowId)?.discount_value ?? 0) > 0) ||
    (discTarget.kind === "extra" &&
      Number(extras.find((x) => x.id === discTarget.rowId)?.discount_value ?? 0) > 0);

  async function handlePrint() {
    if (!b) return;
    const prev = document.title;
    const safe = (b.host_name ?? b.guests?.name ?? b.event_name ?? b.banquet_number).replace(
      /[^\w]+/g,
      "",
    );
    document.title = `INV-${b.banquet_number}-${safe}`;
    const paperSize = await fetchPrinterPaperSize(b.property_id, "bill");
    // Invoice/Bill uses the browser's native print dialog — QZ Tray's
    // HTML-to-pixel pipeline caused persistent A4 table cutoff issues.
    withPrintStyles(paperSize, () => window.print());
    setTimeout(() => {
      document.title = prev;
    }, 500);
  }

  function printDraft() {
    if (!b) return;
    const bk = b;
    const esc = (s: unknown) =>
      String(s ?? "").replace(
        /[&<>"']/g,
        (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]!,
      );
    const rows = [
      ["Hall Rent", bk.hall_charge],
      [`Package (${bk.pax} pax × ${inr(bk.package_rate)})`, packageAmount],
      ["F&B Charges", bk.fb_charge],
      ...bulk.map(
        (r) =>
          [
            `Room ${r.rooms?.room_number ?? r.room_categories?.name ?? "—"} (${r.nights} night × ${inr(r.rate)})`,
            Number(r.rate) * Number(r.nights),
          ] as [string, number],
      ),
      ["Extra Charges", bk.extra_charge],
    ].filter((r) => Number(r[1]) > 0);
    const html = `<!doctype html><html><head><title>DRAFT — ${esc(bk.event_name ?? bk.function_type)}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:12px;padding:24px;max-width:780px;margin:0 auto;color:#111;position:relative}
        h1{font-size:18px;margin:0 0 4px;text-align:center;letter-spacing:1px}
        table{width:100%;border-collapse:collapse;margin-top:8px}
        th,td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;font-size:11px}
        th{background:#f3f4f6}
        .right{text-align:right}
        .totals{margin-top:8px;width:50%;margin-left:auto}
        .totals td{border:none;padding:3px 8px}
        .totals .grand{font-weight:bold;font-size:13px;border-top:2px solid #111}
        .draft-watermark{position:fixed;top:50%;left:50%;
          transform:translate(-50%,-50%) rotate(-45deg);
          font-size:72px;font-weight:700;color:#000;opacity:0.10;
          white-space:nowrap;pointer-events:none;z-index:9999}
      </style></head><body>
      <div class="draft-watermark">DRAFT — NOT A TAX INVOICE</div>
      <h1>DRAFT EVENT BILL</h1>
      <div style="text-align:center"><strong>${esc(property?.name ?? "")}</strong></div>
      <div style="text-align:center;font-size:11px;color:#555">${esc(property?.address ?? "")}</div>
      <hr/>
      <div style="display:flex;justify-content:space-between;gap:16px;margin:8px 0">
        <div>
          <div><strong>Event:</strong> ${esc(bk.event_name ?? bk.function_type)}</div>
          <div>Host: ${esc(bk.host_name ?? bk.guests?.name ?? "—")}</div>
          <div>${esc(bk.host_mobile ?? bk.guests?.mobile ?? "")}</div>
        </div>
        <div class="right">
          <div><strong>Bill No:</strong> <span style="color:#999;letter-spacing:4px">- - - - - -</span></div>
          <div>Hall: ${esc(bk.halls?.name ?? "—")}</div>
          <div>Date: ${esc(bk.event_date)}</div>
        </div>
      </div>
      <table>
        <thead><tr><th>Description</th><th class="right">Amount</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${esc(r[0])}</td><td class="right">${inr(r[1])}</td></tr>`).join("")}</tbody>
      </table>
      <table class="totals">
        <tr><td>Subtotal</td><td class="right">${inr(subtotal)}</td></tr>
        ${discount > 0 ? `<tr><td>Discount</td><td class="right">- ${inr(discount)}</td></tr>` : ""}
        ${
          isGst
            ? isIgstBill
              ? `<tr><td>IGST 5%</td><td class="right">${inr(igst)}</td></tr>`
              : `<tr><td>CGST 2.5%</td><td class="right">${inr(cgst)}</td></tr>
                   <tr><td>SGST 2.5%</td><td class="right">${inr(sgst)}</td></tr>`
            : ""
        }
        ${Math.abs(roundOff) >= 0.01 ? `<tr><td>Round Off</td><td class="right">${roundOff >= 0 ? "+ " : "- "}${inr(Math.abs(roundOff))}</td></tr>` : ""}
        <tr class="grand"><td>Total</td><td class="right">${inrRound(total)}</td></tr>
        <tr><td>Advance</td><td class="right">- ${inr(advance)}</td></tr>
        <tr><td>Balance Due</td><td class="right">${inrRound(balance)}</td></tr>
      </table>
      <p style="margin-top:24px;text-align:center;font-size:10px;color:#666">This is a draft for verification only.</p>
      </body></html>`;
    const w = window.open("", "_blank", "width=900,height=900");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  async function collectPayment() {
    if (!b) return;
    const rows = splitOn
      ? splitRows
          .filter((r) => Number(r.amount) > 0)
          .map((r) => ({
            mode: r.mode,
            amount: Number(r.amount),
            reference: r.reference,
          }))
      : [{ mode: payMode, amount: Number(payAmt), reference: payRef }];
    const valid = rows.filter((r) => Number.isFinite(r.amount) && r.amount > 0);
    if (valid.length === 0) return toast.error("Enter a valid amount");
    const inserts = valid.map((r) => ({
      event_id: b.id,
      property_id: b.property_id,
      amount: r.amount,
      payment_mode: r.mode,
      reference: r.reference || null,
      created_by: user?.id ?? null,
    }));
    const { error } = await supabase.from("event_payments" as any).insert(inserts as any);
    if (error) return toast.error(error.message);
    toast.success("Payment recorded");
    setPayAmt("");
    setPayRef("");
    setSplitRows([
      { mode: "cash", amount: "", reference: "" },
      { mode: "upi", amount: "", reference: "" },
    ]);
    load();
  }

  async function whatsappToHost() {
    if (!b) return;
    const phone = (b.host_mobile ?? b.guests?.mobile)?.replace(/\D/g, "") ?? "";
    const lines = [
      `*${property?.name ?? "Hotel"}*`,
      `${isGst ? "Event Tax Invoice" : "Event Cash Bill"}: ${b.banquet_number}`,
      `Event: ${b.event_name ?? b.function_type}`,
      `Date: ${b.event_date}`,
      ``,
      `Hall: ${inr(b.hall_charge)}`,
      packageAmount > 0 ? `Package: ${inr(packageAmount)}` : "",
      Number(b.fb_charge) > 0 ? `F&B: ${inr(b.fb_charge)}` : "",
      roomSubtotalGross > 0 ? `Rooms: ${inr(roomSubtotalGross)}` : "",
      isGst ? `GST: ${inr(gstTotal)}` : "",
      `*Total: ${inrRound(total)}*`,
      `Advance: ${inr(advance)}`,
      `Balance Due: ${inrRound(balance)}`,
    ]
      .filter(Boolean)
      .join("\n");
    try {
      if (phone) {
        const { sendWhatsApp } = await import("@/lib/whatsapp");
        await sendWhatsApp({
          property_id: b.property_id,
          phone,
          message: lines,
          template_key: "event_bill_share",
        } as any);
      }
    } catch {
      /* fallback */
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(lines)}`;
    window.open(url, "_blank");
  }

  const propAddrLine = [property?.address, property?.city, property?.state, property?.pincode]
    .filter(Boolean)
    .join(", ");

  return (
    <AppShell title={`Event Bill ${b.banquet_number}`}>
      <style>{`
        #invoice-print-area { color: #111111; background-color: #ffffff; }
        #invoice-print-area * { border-color: #e5e7eb; }
        #invoice-print-area table { border-collapse: collapse; width: 100%; }
        #invoice-print-area th, #invoice-print-area td { padding: 8px 10px; font-size: 12px; }
        #invoice-print-area .zebra tr:nth-child(even) td { background: #F7FBF9; }
      `}</style>

      <div className="max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center gap-3 no-print">
          <BackButton fallbackTo="/banquet/bookings" />
          <Badge variant="outline">{b.banquet_number}</Badge>
          <div className="text-sm text-muted-foreground">
            {b.event_name ?? b.function_type} · {fmtDate(b.event_date)}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={printDraft}>
              <Printer className="h-4 w-4 mr-1" /> Print Draft
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Download className="h-4 w-4 mr-1" /> Download PDF
            </Button>
            <Button variant="outline" size="sm" onClick={whatsappToHost}>
              <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp to Host
            </Button>
            {isSettled && (
              <Badge style={{ background: "#1D9E75", color: "#fff" }} className="border-0">
                PAID
              </Badge>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div id="invoice-print-area" className="relative p-8 bg-white">
              {isSettled && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                  <div
                    style={{
                      transform: "rotate(-25deg)",
                      border: `8px solid ${TEAL}`,
                      color: TEAL,
                      padding: "12px 48px",
                      fontSize: 64,
                      fontWeight: 900,
                      letterSpacing: 8,
                      opacity: 0.18,
                      borderRadius: 12,
                    }}
                  >
                    SETTLED
                  </div>
                </div>
              )}
              {/* Header */}
              <div
                className="flex justify-between items-start border-b pb-4 mb-4"
                style={{ borderColor: TEAL }}
              >
                <div>
                  {property?.logo_url && (
                    <img src={property.logo_url} alt="" className="h-12 mb-2" />
                  )}
                  <div className="text-lg font-bold" style={{ color: TEAL }}>
                    {property?.name}
                  </div>
                  <div className="text-xs text-gray-600 whitespace-pre-line">{propAddrLine}</div>
                  {property?.gstin && (
                    <div className="text-xs text-gray-700">
                      GSTIN: <strong>{property.gstin}</strong>
                    </div>
                  )}
                  {property?.phone && (
                    <div className="text-xs text-gray-700">
                      {property.phone}
                      {property?.email ? ` · ${property.email}` : ""}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wider text-gray-500">
                    {isGst ? "Tax Invoice" : "Cash Bill"} · Event
                  </div>
                  <div className="text-2xl font-bold" style={{ color: TEAL }}>
                    {b.banquet_number}
                  </div>
                  <div className="text-xs text-gray-600">Date: {fmtDate(b.event_date)}</div>
                  <div className="text-xs text-gray-600">Status: {b.status.toUpperCase()}</div>
                </div>
              </div>

              {/* Event details */}
              <div className="text-xl font-bold mb-2" style={{ color: TEAL }}>
                {b.event_name ?? b.function_type}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm mb-4 pb-4 border-b">
                <div>
                  <div className="text-xs uppercase text-gray-500 mb-1">Host</div>
                  <div className="font-medium">{b.host_name ?? b.guests?.name ?? "—"}</div>
                  {(b.host_mobile ?? b.guests?.mobile) && (
                    <div className="text-xs text-gray-600">{b.host_mobile ?? b.guests?.mobile}</div>
                  )}
                  {(b.host_email ?? b.guests?.email) && (
                    <div className="text-xs text-gray-600">{b.host_email ?? b.guests?.email}</div>
                  )}
                  {b.guests?.gst_number && (
                    <div className="text-xs text-gray-700">GSTIN: {b.guests.gst_number}</div>
                  )}
                  {b.guests?.company && (
                    <div className="text-xs text-gray-600">{b.guests.company}</div>
                  )}
                </div>
                <div>
                  <div className="text-xs uppercase text-gray-500 mb-1">Event Details</div>
                  <div>
                    <strong>Function:</strong> {b.function_type}
                  </div>
                  <div>
                    <strong>Hall:</strong> {b.halls?.name ?? "—"}
                  </div>
                  <div>
                    <strong>Time:</strong> {b.start_time?.slice(0, 5)}–{b.end_time?.slice(0, 5)} ·{" "}
                    {b.pax} pax
                  </div>
                </div>
              </div>

              {/* Line items grouped */}
              <SectionTitle>Hall & Venue</SectionTitle>
              <DiscLineTable
                rows={[
                  {
                    label: "Hall Rent",
                    amount: lineBase.hall,
                    lineKey: "hall",
                    disc: lineDiscAmt("hall"),
                    discMeta: lineDiscMap?.hall,
                  },
                  ...(packageAmount > 0
                    ? [
                        {
                          label: `Package (${inr(b.package_rate)} per pax × ${b.pax} pax)`,
                          amount: lineBase.package,
                          lineKey: "package",
                          disc: lineDiscAmt("package"),
                          discMeta: lineDiscMap?.package,
                        },
                      ]
                    : []),
                ]}
                onLineClick={(row) => openLineDiscount(row.lineKey, row.amount, row.label)}
              />

              {Number(b.fb_charge) > 0 && (
                <>
                  <SectionTitle>Food & Beverage</SectionTitle>
                  <DiscLineTable
                    rows={[
                      {
                        label: "F&B Charges",
                        amount: lineBase.fb,
                        lineKey: "fb",
                        disc: lineDiscAmt("fb"),
                        discMeta: lineDiscMap?.fb,
                      },
                    ]}
                    onLineClick={(row) => openLineDiscount(row.lineKey, row.amount, row.label)}
                  />
                </>
              )}

              {bulk.length > 0 && (
                <>
                  <SectionTitle>Room Block</SectionTitle>
                  <DiscLineTable
                    rows={bulk.map((r) => ({
                      label: `Room ${r.rooms?.room_number ?? r.room_categories?.name ?? "—"} (${r.nights} night × ${inr(r.rate)})`,
                      amount: Number(r.rate) * Number(r.nights),
                      lineKey: `room:${r.id}`,
                      rowId: r.id,
                      disc: roomDiscAmt(r),
                      discMeta:
                        r.discount_type && Number(r.discount_value) > 0
                          ? {
                              type: r.discount_type,
                              value: Number(r.discount_value),
                              amount: Number(r.discount_amount),
                            }
                          : null,
                    }))}
                    onLineClick={(row) =>
                      row.rowId && openRoomDiscount(row.rowId, row.amount, row.label)
                    }
                    footer={["Room Block Subtotal", roomSubtotalGross]}
                  />
                </>
              )}

              {Number(b.extra_charge) > 0 && (
                <>
                  <SectionTitle>Extras</SectionTitle>
                  <DiscLineTable
                    rows={[
                      {
                        label: "Extra Charges",
                        amount: lineBase.extra,
                        lineKey: "extra",
                        disc: lineDiscAmt("extra"),
                        discMeta: lineDiscMap?.extra,
                      },
                    ]}
                    onLineClick={(row) => openLineDiscount(row.lineKey, row.amount, row.label)}
                  />
                </>
              )}

              {extras.length > 0 && (
                <>
                  <SectionTitle>Extras</SectionTitle>
                  <DiscLineTable
                    rows={extras.map((e) => ({
                      label: e.point_name,
                      amount: Number(e.amount || 0),
                      lineKey: `extra:${e.id}`,
                      rowId: e.id,
                      disc: extraDiscAmt(e),
                      discMeta:
                        e.discount_type && Number(e.discount_value) > 0
                          ? {
                              type: e.discount_type,
                              value: Number(e.discount_value),
                              amount: Number(e.discount_amount),
                            }
                          : null,
                    }))}
                    onLineClick={(row) =>
                      row.rowId && openExtraDiscount(row.rowId, row.amount, row.label)
                    }
                    footer={
                      extras.length > 1 ? ["Extras Subtotal", extrasSubtotalGross] : undefined
                    }
                  />
                </>
              )}

              {/* Summary */}
              <div className="mt-6 ml-auto w-full max-w-sm text-sm">
                <SummaryRow label="Subtotal" value={inr(subtotal)} />
                {discount > 0 && <SummaryRow label="Discount" value={`- ${inr(discount)}`} />}
                <div className="no-print flex justify-end mt-1">
                  <Button size="sm" variant="outline" onClick={openBillDiscount}>
                    <Percent className="h-3.5 w-3.5 mr-1" />
                    {Number(b.discount_value ?? 0) > 0
                      ? "Edit bill discount"
                      : "Apply bill discount"}
                  </Button>
                </div>
                {isGst && (
                  <>
                    {isIgstBill ? (
                      <SummaryRow label="IGST 5%" value={inr(igst)} />
                    ) : (
                      <>
                        <SummaryRow label="CGST 2.5%" value={inr(cgst)} />
                        <SummaryRow label="SGST 2.5%" value={inr(sgst)} />
                      </>
                    )}
                  </>
                )}
                {Math.abs(roundOff) >= 0.01 && (
                  <SummaryRow
                    label="Round Off"
                    value={`${roundOff >= 0 ? "+ " : "- "}${inr(Math.abs(roundOff))}`}
                  />
                )}
                <SummaryRow label="Total" value={inrRound(total)} bold />
                {advance > 0 && <SummaryRow label="Advance Received" value={`- ${inr(advance)}`} />}
                {paidViaEventPayments > 0 && (
                  <SummaryRow label="Payments Received" value={`- ${inr(paidViaEventPayments)}`} />
                )}
                <SummaryRow
                  label="Balance Due"
                  value={inrRound(balance)}
                  bold
                  highlight={balance > 0 ? "red" : undefined}
                />
              </div>

              {b.notes && (
                <div className="mt-6 pt-4 border-t">
                  <div className="text-xs uppercase text-gray-500 mb-1">Notes</div>
                  <div className="text-xs whitespace-pre-line">{b.notes}</div>
                </div>
              )}

              <div className="mt-8 pt-4 border-t text-xs text-gray-500 text-center">
                Thank you for choosing {property?.name ?? "us"}!
              </div>
            </div>
          </CardContent>
        </Card>

        {/* COLLECT PAYMENT */}
        {balance > 0.01 && (
          <Card className="no-print">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold uppercase tracking-wider">
                  Collect Payment
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={splitOn}
                    onChange={(e) => setSplitOn(e.target.checked)}
                  />
                  Split payment
                </label>
              </div>
              {!splitOn ? (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Amount</Label>
                    <Input
                      type="number"
                      value={payAmt}
                      onFocus={() => {
                        if (!payAmt) setPayAmt(String(balance));
                      }}
                      onChange={(e) => setPayAmt(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Mode</Label>
                    <Select value={payMode} onValueChange={setPayMode}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {payMethods.map((m) => (
                          <SelectItem key={m.id} value={m.name}>
                            {formatPaymentMethodLabel(m.name)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Reference</Label>
                    <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} />
                  </div>
                  <div className="flex items-end">
                    <Button
                      className="w-full"
                      onClick={collectPayment}
                      style={{ background: TEAL, color: "#fff" }}
                    >
                      Collect Payment
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {splitRows.map((r, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <Select
                        value={r.mode}
                        onValueChange={(v) =>
                          setSplitRows((arr) =>
                            arr.map((x, idx) => (idx === i ? { ...x, mode: v } : x)),
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {payMethods.map((m) => (
                            <SelectItem key={m.id} value={m.name}>
                              {formatPaymentMethodLabel(m.name)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        placeholder="Amount"
                        value={r.amount}
                        onChange={(e) =>
                          setSplitRows((arr) =>
                            arr.map((x, idx) => (idx === i ? { ...x, amount: e.target.value } : x)),
                          )
                        }
                      />
                      <Input
                        placeholder="Reference"
                        value={r.reference}
                        onChange={(e) =>
                          setSplitRows((arr) =>
                            arr.map((x, idx) =>
                              idx === i ? { ...x, reference: e.target.value } : x,
                            ),
                          )
                        }
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setSplitRows((arr) => arr.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setSplitRows((arr) => [...arr, { mode: "cash", amount: "", reference: "" }])
                      }
                    >
                      <Plus className="h-4 w-4 mr-1" /> Add row
                    </Button>
                    <Button
                      size="sm"
                      onClick={collectPayment}
                      style={{ background: TEAL, color: "#fff" }}
                    >
                      Collect Payment
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* PAYMENT HISTORY */}
        {pays.length > 0 && (
          <Card className="no-print">
            <CardContent className="p-4">
              <div className="text-sm font-semibold uppercase tracking-wider mb-3">
                Payment History
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="text-left py-1">Date</th>
                    <th className="text-left py-1">Mode</th>
                    <th className="text-left py-1">Reference</th>
                    <th className="text-right py-1">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {pays.map((p) => (
                    <tr key={p.id} className="border-b">
                      <td className="py-1">{new Date(p.paid_at).toLocaleString("en-IN")}</td>
                      <td className="py-1 uppercase">{p.payment_mode.replace(/_/g, " ")}</td>
                      <td className="py-1 text-xs text-muted-foreground">{p.reference ?? "—"}</td>
                      <td className="py-1 text-right tabular-nums">{inr(p.amount)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td colSpan={3} className="py-2 text-right">
                      Total Paid
                    </td>
                    <td className="py-2 text-right tabular-nums">{inr(totalPaid)}</td>
                  </tr>
                  <tr>
                    <td
                      colSpan={3}
                      className="py-1 text-right font-semibold"
                      style={{ color: balance > 0.01 ? "#dc2626" : TEAL }}
                    >
                      Balance Due
                    </td>
                    <td
                      className="py-1 text-right font-semibold tabular-nums"
                      style={{ color: balance > 0.01 ? "#dc2626" : TEAL }}
                    >
                      {inr(balance)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <DiscountDialog
          open={discOpen}
          onOpenChange={setDiscOpen}
          kind={discTarget.kind === "bill" ? "bill" : "line"}
          lineDescription={discTarget.kind !== "bill" ? discTarget.description : undefined}
          base={discBase}
          initialType={discInitial.type}
          initialValue={discInitial.value}
          unlimited={unlimitedDisc()}
          maxPct={maxDiscPct}
          limit={discountLimit}
          hasExisting={discHasExisting}
          onSave={saveDiscount}
        />
      </div>
    </AppShell>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mt-4 mb-1 text-xs uppercase tracking-wider font-semibold"
      style={{ color: TEAL }}
    >
      {children}
    </div>
  );
}

interface DiscLineRow {
  label: string;
  amount: number;
  lineKey: string;
  rowId?: string;
  disc: number;
  discMeta?: { type: DiscType; value: number; amount: number } | null;
}

function DiscLineTable({
  rows,
  onLineClick,
  footer,
}: {
  rows: DiscLineRow[];
  onLineClick: (row: DiscLineRow) => void;
  footer?: [string, number];
}) {
  return (
    <table className="w-full text-sm zebra">
      <tbody>
        {rows.map((r) => (
          <tr key={r.lineKey} className="border-b">
            <td className="py-2">
              <div className="flex items-center gap-2">
                <span>{r.label}</span>
                <button
                  type="button"
                  onClick={() => onLineClick(r)}
                  className="no-print inline-flex h-5 w-5 items-center justify-center rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  title="Apply line-item discount"
                >
                  <span className="text-[10px]">%</span>
                </button>
              </div>
              {r.disc > 0 && r.discMeta && (
                <div className="text-[11px] text-emerald-700">
                  Discount{" "}
                  {r.discMeta.type === "percent" ? `${r.discMeta.value}%` : `₹${r.discMeta.value}`}
                  {" — "}-{inr(r.disc)}
                </div>
              )}
            </td>
            <td className="py-2 text-right tabular-nums">
              {r.disc > 0 ? (
                <>
                  <span className="text-muted-foreground line-through mr-2">{inr(r.amount)}</span>
                  {inr(Math.max(0, r.amount - r.disc))}
                </>
              ) : (
                inr(r.amount)
              )}
            </td>
          </tr>
        ))}
        {footer && (
          <tr className="border-b">
            <td className="py-2">{footer[0]}</td>
            <td className="py-2 text-right tabular-nums">{inr(footer[1])}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function ItemTable({ rows }: { rows: [string, number | string][] }) {
  return (
    <table className="w-full text-sm zebra">
      <tbody>
        {rows.map(([label, amt], i) => (
          <tr key={i} className="border-b">
            <td className="py-2">{label}</td>
            <td className="py-2 text-right">{typeof amt === "number" ? inr(amt) : amt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SummaryRow({
  label,
  value,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: "red";
}) {
  return (
    <div className={`flex justify-between py-1 ${bold ? "font-bold border-t pt-2" : ""}`}>
      <span>{label}</span>
      <span style={highlight === "red" ? { color: "#dc2626" } : undefined}>{value}</span>
    </div>
  );
}
