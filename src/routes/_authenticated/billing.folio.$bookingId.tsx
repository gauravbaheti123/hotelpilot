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
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import {
  FOLIO_STATUS_TONE,
  PAYMENT_MODES,
  inr,
  recomputeFolio,
} from "@/lib/billing";
import { ArrowLeft, Plus, Printer, Trash2, Wallet, CheckCircle2, Ban } from "lucide-react";

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
  notes: string | null; property_id: string;
}
interface BookingCtx {
  id: string; booking_number: string; status: string;
  check_in: string; check_out: string; total_amount: number;
  property_id: string;
  guests: { name: string; mobile: string | null; gst_number: string | null; company: string | null } | null;
  booking_rooms: { id: string; rate: number; check_in: string; check_out: string; rooms: { room_number: string } | null; room_categories: { name: string } | null }[];
}
interface PropertyInfo { name: string; gst_number: string | null; address: string | null; }

function FolioPage() {
  const { bookingId } = Route.useParams();
  const router = useRouter();
  const { user } = useAuth();
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

  const load = useCallback(async () => {
    setLoading(true);
    const { data: b, error: be } = await supabase
      .from("bookings")
      .select(`id,booking_number,status,check_in,check_out,total_amount,property_id,
        guests(name,mobile,gst_number,company),
        booking_rooms(id,rate,check_in,check_out,rooms(room_number),room_categories(name))`)
      .eq("id", bookingId).single();
    if (be) { toast.error(be.message); setLoading(false); return; }
    const bk = b as unknown as BookingCtx;
    setBooking(bk);

    const { data: prop } = await supabase.from("properties")
      .select("name,gst_number,address").eq("id", bk.property_id).single();
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
    await persistTotals(charges, payments, { gst_mode: mode });
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
    await supabase.from("folios").update({
      status: "settled", settled_at: new Date().toISOString(),
    }).eq("id", folio.id);
    toast.success("Folio settled");
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
    const isGst = folio.gst_mode === "gst";
    const title = isGst ? "TAX INVOICE" : "BILL";
    const html = `
      <html><head><title>${folio.invoice_number}</title>
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
      <div style="text-align:center"><strong>${property?.name ?? ""}</strong></div>
      <div class="small" style="text-align:center">${property?.address ?? ""}${isGst && property?.gst_number ? ` · GSTIN: ${property.gst_number}` : ""}</div>
      <hr/>
      <div class="meta">
        <div>
          <div><strong>Guest:</strong> ${booking.guests?.name ?? ""}</div>
          <div>${booking.guests?.mobile ?? ""}</div>
          ${isGst && folio.guest_gstin ? `<div>GSTIN: ${folio.guest_gstin}</div>` : ""}
          ${isGst && folio.guest_company ? `<div>${folio.guest_company}</div>` : ""}
        </div>
        <div class="right">
          <div><strong>Invoice:</strong> ${folio.invoice_number}</div>
          <div>Booking: ${booking.booking_number}</div>
          <div>Stay: ${booking.check_in} → ${booking.check_out}</div>
          <div>Date: ${new Date().toLocaleDateString()}</div>
        </div>
      </div>
      <table>
        <thead><tr>
          <th>Description</th><th class="right">Qty</th><th class="right">Rate</th>
          <th class="right">Amount</th>${isGst ? `<th class="right">GST%</th><th class="right">GST</th>` : ""}
        </tr></thead>
        <tbody>
          ${charges.map((c) => `<tr>
            <td>${c.description}</td>
            <td class="right">${Number(c.qty).toLocaleString("en-IN")}</td>
            <td class="right">${inr(c.rate)}</td>
            <td class="right">${inr(c.amount)}</td>
            ${isGst ? `<td class="right">${Number(c.gst_rate)}%</td><td class="right">${inr(c.gst_amount)}</td>` : ""}
          </tr>`).join("")}
        </tbody>
      </table>
      <table class="totals">
        <tr><td>Sub-total</td><td class="right">${inr(folio.sub_total)}</td></tr>
        ${Number(folio.discount_amount) > 0 ? `<tr><td>Discount</td><td class="right">- ${inr(folio.discount_amount)}</td></tr>` : ""}
        ${isGst ? `<tr><td>GST</td><td class="right">${inr(folio.gst_amount)}</td></tr>` : ""}
        <tr class="grand"><td>Total</td><td class="right">${inr(folio.total_amount)}</td></tr>
        <tr><td>Paid</td><td class="right">${inr(folio.paid_amount)}</td></tr>
        <tr><td>Balance</td><td class="right">${inr(folio.balance_amount)}</td></tr>
      </table>
      ${payments.length > 0 ? `<h2 style="margin-top:16px">Payments</h2>
        <table><thead><tr><th>Date</th><th>Mode</th><th>Ref</th><th class="right">Amount</th></tr></thead>
        <tbody>${payments.map((p) => `<tr>
          <td>${new Date(p.paid_at).toLocaleString()}</td>
          <td>${p.mode.toUpperCase()}</td>
          <td>${p.reference_no ?? ""}</td>
          <td class="right">${inr(p.amount)}</td>
        </tr>`).join("")}</tbody></table>` : ""}
      <p class="small" style="margin-top:24px;text-align:center">Thank you for staying with ${property?.name ?? "us"}.</p>
      </body></html>`;
    const w = window.open("", "_blank", "width=900,height=900");
    if (!w) return;
    w.document.write(html); w.document.close(); w.focus(); w.print();
  }

  if (loading) return <AppShell title="Folio"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!folio || !booking) return <AppShell title="Folio"><p className="text-sm text-muted-foreground">Not found.</p></AppShell>;

  const isOpen = folio.status === "open";

  return (
    <AppShell title={`Folio ${folio.invoice_number}`}>
      <div className="max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.history.back()}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          <Badge variant="outline" className={FOLIO_STATUS_TONE[folio.status]}>{folio.status.toUpperCase()}</Badge>
          <div className="text-sm text-muted-foreground">
            Booking {booking.booking_number} · {booking.guests?.name ?? "—"}
          </div>
          <div className="flex-1" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={printInvoice}><Printer className="h-4 w-4 mr-1" /> Print</Button>
            {isOpen && Number(folio.balance_amount) < 0.01 && (
              <Button size="sm" onClick={settle}><CheckCircle2 className="h-4 w-4 mr-1" /> Settle</Button>
            )}
            {isOpen && (
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => setVoidOpen(true)}>
                <Ban className="h-4 w-4 mr-1" /> Void
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Charges</CardTitle>
              {isOpen && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={pullFoodCharges}>Pull food KOTs</Button>
                  <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add</Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {charges.length === 0 ? (
                <p className="text-sm text-muted-foreground">No charges yet.</p>
              ) : (
                <div className="text-sm divide-y">
                  {charges.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 py-2">
                      <Badge variant="outline" className="capitalize text-[10px]">{c.charge_type}</Badge>
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{c.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {Number(c.qty)} × {inr(c.rate)}
                          {folio.gst_mode === "gst" && c.charge_type !== "discount" ? ` · GST ${Number(c.gst_rate)}%` : ""}
                        </div>
                      </div>
                      <div className={`w-28 text-right ${c.charge_type === "discount" ? "text-emerald-700" : ""}`}>
                        {inr(c.amount)}
                      </div>
                      {isOpen && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeCharge(c.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Mode</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Button variant={folio.gst_mode === "cash" ? "default" : "outline"} size="sm"
                    disabled={!isOpen} onClick={() => toggleMode("cash")}>Cash bill</Button>
                  <Button variant={folio.gst_mode === "gst" ? "default" : "outline"} size="sm"
                    disabled={!isOpen} onClick={() => toggleMode("gst")}>GST invoice</Button>
                </div>
                {folio.gst_mode === "gst" && (
                  <div className="space-y-2">
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

            <Card>
              <CardHeader><CardTitle className="text-base">Totals</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1">
                <Row k="Sub-total" v={inr(folio.sub_total)} />
                {Number(folio.discount_amount) > 0 && <Row k="Discount" v={`- ${inr(folio.discount_amount)}`} />}
                {folio.gst_mode === "gst" && <Row k="GST" v={inr(folio.gst_amount)} />}
                <div className="border-t pt-1 mt-1">
                  <Row k="Total" v={inr(folio.total_amount)} bold />
                </div>
                <Row k="Paid" v={inr(folio.paid_amount)} />
                <Row k="Balance" v={inr(folio.balance_amount)} bold highlight={Number(folio.balance_amount) > 0} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Payments</CardTitle>
                {isOpen && <Button size="sm" onClick={() => setPayOpen(true)}><Wallet className="h-4 w-4 mr-1" /> Add</Button>}
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {payments.length === 0 && <p className="text-xs text-muted-foreground">No payments yet.</p>}
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between border-b last:border-0 pb-1">
                    <div>
                      <div className="font-medium">{inr(p.amount)} <span className="text-xs text-muted-foreground uppercase">{p.mode}</span></div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(p.paid_at).toLocaleString()}{p.reference_no ? ` · ${p.reference_no}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
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
      </div>
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