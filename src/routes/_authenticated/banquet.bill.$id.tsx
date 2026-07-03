import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ArrowLeft, Printer, Download, MessageCircle, Plus, Trash2, ArrowRightLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth, hasRole } from "@/hooks/use-auth";
import { userDisplayName } from "@/lib/activityLog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { inr } from "@/lib/billing";
import { fmtDate } from "@/lib/reportExports";
import { fetchPrinterPaperSize, withPrintStyles } from "@/lib/printStyles";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/banquet/bill/$id")({
  head: () => ({ meta: [{ title: "Event Bill — HotelPilot" }] }),
  component: () => (<RequirePermission module="banquet"><BanquetBillPage /></RequirePermission>),
});

interface Bq {
  id: string; property_id: string; banquet_number: string; function_type: string;
  event_date: string; start_time: string; end_time: string; pax: number;
  package_rate: number; hall_charge: number; fb_charge: number; extra_charge: number;
  discount_amount: number; total_amount: number; advance_amount: number; balance_amount: number;
  status: string; notes: string | null; event_name: string | null; bill_type: string;
  halls: { name: string } | null;
  guests: { name: string; mobile: string | null; email: string | null; gst_number: string | null; company: string | null } | null;
}
interface Bulk {
  id: string; rate: number; nights: number; check_in: string; check_out: string;
  rooms: { room_number: string } | null;
  room_categories: { name: string } | null;
}
interface PropertyInfo {
  name: string; gstin: string | null; address: string | null;
  city: string | null; state: string | null; pincode: string | null;
  phone: string | null; email: string | null; wa_number: string | null;
  logo_url: string | null;
}

const TEAL = "#1D9E75";
const PAY_MODES = ["cash","card","upi","bank_transfer","cheque","complimentary"];

interface EventPayment {
  id: string; amount: number; payment_mode: string; reference: string | null;
  paid_at: string; notes: string | null;
}

function BanquetBillPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { user, roles } = useAuth();
  const [b, setB] = useState<Bq | null>(null);
  const [bulk, setBulk] = useState<Bulk[]>([]);
  const [property, setProperty] = useState<PropertyInfo | null>(null);
  const [billType, setBillType] = useState<"gst_invoice" | "cash_bill">("gst_invoice");
  const [loading, setLoading] = useState(true);
  const [pays, setPays] = useState<EventPayment[]>([]);
  // payment-collection state
  const [payMode, setPayMode] = useState("cash");
  const [payAmt, setPayAmt] = useState("");
  const [payRef, setPayRef] = useState("");
  const [splitOn, setSplitOn] = useState(false);
  const [splitRows, setSplitRows] = useState<Array<{ mode: string; amount: string; reference: string }>>([
    { mode: "cash", amount: "", reference: "" },
    { mode: "upi", amount: "", reference: "" },
  ]);
  const [misOpen, setMisOpen] = useState(false);
  const [misBusy, setMisBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("banquet_bookings").select(`
      id,property_id,banquet_number,function_type,event_date,start_time,end_time,pax,event_name,
      package_rate,hall_charge,fb_charge,extra_charge,discount_amount,total_amount,bill_type,
      advance_amount,balance_amount,status,notes,
      halls(name),guests(name,mobile,email,gst_number,company)
    `).eq("id", id).single();
    if (error) { toast.error(error.message); setLoading(false); return; }
    const bq = data as unknown as Bq;
    setB(bq);
    setBillType((bq.bill_type as "gst_invoice" | "cash_bill") ?? "gst_invoice");

    const [{ data: br }, { data: p }] = await Promise.all([
      supabase.from("banquet_bulk_rooms")
        .select("id,rate,nights,check_in,check_out,rooms(room_number),room_categories(name)")
        .eq("banquet_id", id),
      supabase.from("properties")
        .select("name,gstin,address,city,state,pincode,phone,email,wa_number,logo_url")
        .eq("id", bq.property_id).single(),
    ]);
    setBulk(((br ?? []) as unknown) as Bulk[]);
    setProperty((p ?? null) as PropertyInfo | null);
    const { data: pp } = await supabase.from("event_payments" as any)
      .select("id,amount,payment_mode,reference,paid_at,notes")
      .eq("event_id", id).order("paid_at", { ascending: false });
    setPays(((pp as any) ?? []) as EventPayment[]);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function saveBillType(next: "gst_invoice" | "cash_bill") {
    if (!b) return;
    setBillType(next);
    await supabase.from("banquet_bookings").update({ bill_type: next }).eq("id", b.id);
  }

  if (loading) return <AppShell title="Event Bill"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!b) return <AppShell title="Event Bill"><p className="text-sm text-muted-foreground">Not found.</p></AppShell>;

  const isGst = billType === "gst_invoice";
  const packageAmount = Number(b.package_rate || 0) * Number(b.pax || 0);
  const roomSubtotal = bulk.reduce((s, r) => s + Number(r.rate || 0) * Number(r.nights || 0), 0);
  const subtotal =
    Number(b.hall_charge || 0) + packageAmount + Number(b.fb_charge || 0) +
    roomSubtotal + Number(b.extra_charge || 0);
  const discount = Number(b.discount_amount || 0);
  const taxable = Math.max(0, subtotal - discount);
  const gstRate = 0.12;
  const cgst = isGst ? Math.round((taxable * gstRate / 2) * 100) / 100 : 0;
  const sgst = cgst;
  const total = Math.round((taxable + (isGst ? cgst + sgst : 0)) * 100) / 100;
  const advance = Number(b.advance_amount || 0);
  const paidViaEventPayments = pays.reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalPaid = advance + paidViaEventPayments;
  const balance = Math.max(0, total - totalPaid);
  const isSettled = balance < 0.01;
  const canShiftMis = hasRole(roles, "owner") || hasRole(roles, "manager") || hasRole(roles, "superadmin");

  async function handlePrint() {
    if (!b) return;
    const prev = document.title;
    const safe = (b.guests?.name ?? b.event_name ?? b.banquet_number).replace(/[^\w]+/g, "");
    document.title = `INV-${b.banquet_number}-${safe}`;
    const paperSize = await fetchPrinterPaperSize(b.property_id, "bill");
    withPrintStyles(paperSize, () => window.print());
    setTimeout(() => { document.title = prev; }, 500);
  }

  function printDraft() {
    if (!b) return;
    const bk = b;
    const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]!));
    const rows = [
      ["Hall Rent", bk.hall_charge],
      [`Package (${bk.pax} pax × ${inr(bk.package_rate)})`, packageAmount],
      ["F&B Charges", bk.fb_charge],
      ...bulk.map((r) => [
        `Room ${r.rooms?.room_number ?? r.room_categories?.name ?? "—"} (${r.nights} night × ${inr(r.rate)})`,
        Number(r.rate) * Number(r.nights),
      ] as [string, number]),
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
          <div>Host: ${esc(bk.guests?.name ?? "—")}</div>
          <div>${esc(bk.guests?.mobile ?? "")}</div>
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
        ${isGst ? `<tr><td>CGST 6%</td><td class="right">${inr(cgst)}</td></tr>
                   <tr><td>SGST 6%</td><td class="right">${inr(sgst)}</td></tr>` : ""}
        <tr class="grand"><td>Total</td><td class="right">${inr(total)}</td></tr>
        <tr><td>Advance</td><td class="right">- ${inr(advance)}</td></tr>
        <tr><td>Balance Due</td><td class="right">${inr(balance)}</td></tr>
      </table>
      <p style="margin-top:24px;text-align:center;font-size:10px;color:#666">This is a draft for verification only.</p>
      </body></html>`;
    const w = window.open("", "_blank", "width=900,height=900");
    if (!w) return;
    w.document.write(html); w.document.close(); w.focus(); w.print();
  }

  async function collectPayment() {
    if (!b) return;
    const rows = splitOn
      ? splitRows.filter((r) => Number(r.amount) > 0).map((r) => ({
          mode: r.mode, amount: Number(r.amount), reference: r.reference,
        }))
      : [{ mode: payMode, amount: Number(payAmt), reference: payRef }];
    const valid = rows.filter((r) => Number.isFinite(r.amount) && r.amount > 0);
    if (valid.length === 0) return toast.error("Enter a valid amount");
    const inserts = valid.map((r) => ({
      event_id: b.id, property_id: b.property_id,
      amount: r.amount, payment_mode: r.mode, reference: r.reference || null,
      created_by: user?.id ?? null,
    }));
    const { error } = await supabase.from("event_payments" as any).insert(inserts as any);
    if (error) return toast.error(error.message);
    toast.success("Payment recorded");
    setPayAmt(""); setPayRef("");
    setSplitRows([{ mode: "cash", amount: "", reference: "" }, { mode: "upi", amount: "", reference: "" }]);
    load();
  }

  async function confirmShiftMis() {
    if (!b) return;
    setMisBusy(true);
    try {
      const { error } = await supabase.from("mis_ledger" as any).insert({
        property_id: b.property_id,
        source_type: "event",
        source_id: b.id,
        source_bill_number: b.banquet_number,
        source_room_number: b.halls?.name ?? null,
        source_guest_name: b.guests?.name ?? null,
        amount: balance,
        description: `Event: ${b.event_name ?? b.function_type}`,
        line_items: [{ name: `Event ${b.event_name ?? b.function_type}`, amount: balance }],
        shifted_by_name: userDisplayName(user as any),
        shifted_at: new Date().toISOString(),
      } as any);
      if (error) throw error;
      // mark event paid via offsetting payment
      await supabase.from("event_payments" as any).insert({
        event_id: b.id, property_id: b.property_id,
        amount: balance, payment_mode: "mis_shift",
        reference: "Shifted to MIS A/c",
        created_by: user?.id ?? null,
      } as any);
      toast.success("Shifted to MIS");
      setMisOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message ?? "Could not shift to MIS");
    } finally { setMisBusy(false); }
  }

  async function whatsappToHost() {
    if (!b) return;
    const phone = b.guests?.mobile?.replace(/\D/g, "") ?? "";
    const lines = [
      `*${property?.name ?? "Hotel"}*`,
      `${isGst ? "Event Tax Invoice" : "Event Cash Bill"}: ${b.banquet_number}`,
      `Event: ${b.event_name ?? b.function_type}`,
      `Date: ${b.event_date}`,
      ``,
      `Hall: ${inr(b.hall_charge)}`,
      packageAmount > 0 ? `Package: ${inr(packageAmount)}` : "",
      Number(b.fb_charge) > 0 ? `F&B: ${inr(b.fb_charge)}` : "",
      roomSubtotal > 0 ? `Rooms: ${inr(roomSubtotal)}` : "",
      isGst ? `GST: ${inr(cgst + sgst)}` : "",
      `*Total: ${inr(total)}*`,
      `Advance: ${inr(advance)}`,
      `Balance Due: ${inr(balance)}`,
    ].filter(Boolean).join("\n");
    try {
      if (phone) {
        const { sendWhatsApp } = await import("@/lib/whatsapp");
        await sendWhatsApp({
          property_id: b.property_id, phone, message: lines, template_key: "event_bill_share",
        } as any);
      }
    } catch { /* fallback */ }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(lines)}`;
    window.open(url, "_blank");
  }

  const propAddrLine = [property?.address, property?.city, property?.state, property?.pincode].filter(Boolean).join(", ");

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
          <Button variant="outline" size="sm" onClick={() => router.history.back()}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <Badge variant="outline">{b.banquet_number}</Badge>
          <div className="text-sm text-muted-foreground">
            {b.event_name ?? b.function_type} · {fmtDate(b.event_date)}
          </div>
          <div className="ml-4 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Bill Type:</span>
            <ToggleGroup type="single" value={billType} onValueChange={(v) => v && saveBillType(v as any)}>
              <ToggleGroupItem value="cash_bill" size="sm">Cash Bill</ToggleGroupItem>
              <ToggleGroupItem value="gst_invoice" size="sm">GST Invoice</ToggleGroupItem>
            </ToggleGroup>
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
            {balance > 0.01 && canShiftMis && (
              <Button variant="outline" size="sm" onClick={() => setMisOpen(true)}>
                <ArrowRightLeft className="h-4 w-4 mr-1" /> Shift to MIS
              </Button>
            )}
            {isSettled && <Badge style={{ background: "#1D9E75", color: "#fff" }} className="border-0">PAID</Badge>}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div id="invoice-print-area" className="relative p-8 bg-white">
              {isSettled && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                  <div style={{
                    transform: "rotate(-25deg)", border: `8px solid ${TEAL}`, color: TEAL,
                    padding: "12px 48px", fontSize: 64, fontWeight: 900, letterSpacing: 8,
                    opacity: 0.18, borderRadius: 12,
                  }}>SETTLED</div>
                </div>
              )}
              {/* Header */}
              <div className="flex justify-between items-start border-b pb-4 mb-4" style={{ borderColor: TEAL }}>
                <div>
                  {property?.logo_url && <img src={property.logo_url} alt="" className="h-12 mb-2" />}
                  <div className="text-lg font-bold" style={{ color: TEAL }}>{property?.name}</div>
                  <div className="text-xs text-gray-600 whitespace-pre-line">{propAddrLine}</div>
                  {property?.gstin && <div className="text-xs text-gray-700">GSTIN: <strong>{property.gstin}</strong></div>}
                  {property?.phone && <div className="text-xs text-gray-700">{property.phone}{property?.email ? ` · ${property.email}` : ""}</div>}
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wider text-gray-500">
                    {isGst ? "Tax Invoice" : "Cash Bill"} · Event
                  </div>
                  <div className="text-2xl font-bold" style={{ color: TEAL }}>{b.banquet_number}</div>
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
                  <div className="font-medium">{b.guests?.name ?? "—"}</div>
                  {b.guests?.mobile && <div className="text-xs text-gray-600">{b.guests.mobile}</div>}
                  {b.guests?.email && <div className="text-xs text-gray-600">{b.guests.email}</div>}
                  {b.guests?.gst_number && <div className="text-xs text-gray-700">GSTIN: {b.guests.gst_number}</div>}
                  {b.guests?.company && <div className="text-xs text-gray-600">{b.guests.company}</div>}
                </div>
                <div>
                  <div className="text-xs uppercase text-gray-500 mb-1">Event Details</div>
                  <div><strong>Function:</strong> {b.function_type}</div>
                  <div><strong>Hall:</strong> {b.halls?.name ?? "—"}</div>
                  <div><strong>Time:</strong> {b.start_time?.slice(0,5)}–{b.end_time?.slice(0,5)} · {b.pax} pax</div>
                </div>
              </div>

              {/* Line items grouped */}
              <SectionTitle>Hall & Venue</SectionTitle>
              <ItemTable rows={[
                ["Hall Rent", b.hall_charge],
                packageAmount > 0
                  ? [`Package (${inr(b.package_rate)} per pax × ${b.pax} pax)`, packageAmount]
                  : null,
              ].filter(Boolean) as [string, number][]} />

              {Number(b.fb_charge) > 0 && (<>
                <SectionTitle>Food & Beverage</SectionTitle>
                <ItemTable rows={[["F&B Charges", b.fb_charge]]} />
              </>)}

              {bulk.length > 0 && (<>
                <SectionTitle>Room Block</SectionTitle>
                <ItemTable rows={[
                  ...bulk.map((r) => [
                    `Room ${r.rooms?.room_number ?? r.room_categories?.name ?? "—"} (${r.nights} night × ${inr(r.rate)})`,
                    Number(r.rate) * Number(r.nights),
                  ] as [string, number]),
                  ["Room Block Subtotal", roomSubtotal],
                ]} />
              </>)}

              {Number(b.extra_charge) > 0 && (<>
                <SectionTitle>Extras</SectionTitle>
                <ItemTable rows={[["Extra Charges", b.extra_charge]]} />
              </>)}

              {/* Summary */}
              <div className="mt-6 ml-auto w-full max-w-sm text-sm">
                <SummaryRow label="Subtotal" value={inr(subtotal)} />
                {discount > 0 && <SummaryRow label="Discount" value={`- ${inr(discount)}`} />}
                {isGst && (<>
                  <SummaryRow label="CGST 6%" value={inr(cgst)} />
                  <SummaryRow label="SGST 6%" value={inr(sgst)} />
                </>)}
                <SummaryRow label="Total" value={inr(total)} bold />
                {advance > 0 && <SummaryRow label="Advance Received" value={`- ${inr(advance)}`} />}
                {paidViaEventPayments > 0 && (
                  <SummaryRow label="Payments Received" value={`- ${inr(paidViaEventPayments)}`} />
                )}
                <SummaryRow
                  label="Balance Due"
                  value={inr(balance)}
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
                <div className="text-sm font-semibold uppercase tracking-wider">Collect Payment</div>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={splitOn}
                    onChange={(e) => setSplitOn(e.target.checked)} />
                  Split payment
                </label>
              </div>
              {!splitOn ? (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Amount</Label>
                    <Input type="number" value={payAmt}
                      onFocus={() => { if (!payAmt) setPayAmt(String(balance)); }}
                      onChange={(e) => setPayAmt(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Mode</Label>
                    <Select value={payMode} onValueChange={setPayMode}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PAY_MODES.map((m) => <SelectItem key={m} value={m}>{m.toUpperCase().replace(/_/g, " ")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Reference</Label>
                    <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} />
                  </div>
                  <div className="flex items-end">
                    <Button className="w-full" onClick={collectPayment} style={{ background: TEAL, color: "#fff" }}>
                      Collect Payment
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {splitRows.map((r, i) => (
                    <div key={i} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                      <Select value={r.mode} onValueChange={(v) =>
                        setSplitRows((arr) => arr.map((x, idx) => idx === i ? { ...x, mode: v } : x))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PAY_MODES.map((m) => <SelectItem key={m} value={m}>{m.toUpperCase().replace(/_/g, " ")}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Input type="number" placeholder="Amount" value={r.amount}
                        onChange={(e) => setSplitRows((arr) => arr.map((x, idx) => idx === i ? { ...x, amount: e.target.value } : x))} />
                      <Input placeholder="Reference" value={r.reference}
                        onChange={(e) => setSplitRows((arr) => arr.map((x, idx) => idx === i ? { ...x, reference: e.target.value } : x))} />
                      <Button size="icon" variant="ghost"
                        onClick={() => setSplitRows((arr) => arr.filter((_, idx) => idx !== i))}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline"
                      onClick={() => setSplitRows((arr) => [...arr, { mode: "cash", amount: "", reference: "" }])}>
                      <Plus className="h-4 w-4 mr-1" /> Add row
                    </Button>
                    <Button size="sm" onClick={collectPayment} style={{ background: TEAL, color: "#fff" }}>
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
              <div className="text-sm font-semibold uppercase tracking-wider mb-3">Payment History</div>
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
                    <td colSpan={3} className="py-2 text-right">Total Paid</td>
                    <td className="py-2 text-right tabular-nums">{inr(totalPaid)}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="py-1 text-right font-semibold"
                      style={{ color: balance > 0.01 ? "#dc2626" : TEAL }}>Balance Due</td>
                    <td className="py-1 text-right font-semibold tabular-nums"
                      style={{ color: balance > 0.01 ? "#dc2626" : TEAL }}>{inr(balance)}</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* SHIFT TO MIS DIALOG */}
        <Dialog open={misOpen} onOpenChange={setMisOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Shift to MIS Account?</DialogTitle></DialogHeader>
            <div className="text-sm text-muted-foreground">
              Shift <b>{inr(balance)}</b> for event <b>{b.banquet_number}</b> to MIS A/c?
              This marks the event balance as internally absorbed.
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMisOpen(false)}>Cancel</Button>
              <Button onClick={confirmShiftMis} disabled={misBusy}
                style={{ background: TEAL, color: "#fff" }}>
                {misBusy ? "Shifting…" : "Confirm Shift"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 mb-1 text-xs uppercase tracking-wider font-semibold" style={{ color: TEAL }}>
      {children}
    </div>
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

function SummaryRow({ label, value, bold, highlight }: { label: string; value: string; bold?: boolean; highlight?: "red" }) {
  return (
    <div className={`flex justify-between py-1 ${bold ? "font-bold border-t pt-2" : ""}`}>
      <span>{label}</span>
      <span style={highlight === "red" ? { color: "#dc2626" } : undefined}>{value}</span>
    </div>
  );
}